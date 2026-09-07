// Phone-OTP sign-in over WhatsApp, via ARQAM (otp.arqam.tech).
//
// Config (env):
//   ARQAM_API_KEY   — secret project key (otplive_…). Never log it.
//   ARQAM_BASE_URL  — override for testing; defaults to the live API.
//   ARQAM_TEMPLATE  — Meta-approved template key; defaults to 'otp'.
//   OTP_REQUIRED    — 'true' to gate /auth/phone-login behind OTP.
//
// Replaces the Twilio Verify wrapper that used to live here. The two
// services differ in one way that shapes this whole file:
//
//   Twilio Verify is keyed by PHONE. You send to +9647…, and later check
//   (+9647…, code) — the service remembers what it sent.
//   ARQAM is keyed by MESSAGE. Sending returns a `messageId`, and verifying
//   takes (messageId, code). Nothing on their side maps a phone back to its
//   pending code.
//
// Our own two-step flow (POST /auth/phone-login, then POST /auth/otp/verify)
// only ever carries the phone — the app never sees a messageId, and it should
// not: handing the client an opaque id to echo back adds a way to get it
// wrong and nothing else. So the phone→messageId link is held here, in
// `otp_pending`, for the couple of minutes between the two calls.
//
// The module still loads with no credentials so the server runs in "OTP off"
// mode; every call then answers { ok:false, error:'otp_not_configured' }.

import { db, now } from './db.js';

const API_KEY = process.env.ARQAM_API_KEY || '';
const BASE_URL = (process.env.ARQAM_BASE_URL || 'https://otp.arqam.tech/api').replace(/\/+$/, '');
const TEMPLATE = process.env.ARQAM_TEMPLATE || 'otp';

// ARQAM expires a code after five minutes (EXPIRED_CODE in their docs). We
// drop our row a little later so an expired-but-present row produces their
// real error rather than our vaguer "no pending code".
const PENDING_TTL_MS = 10 * 60 * 1000;

// Their platform rate-limits per phone and per IP, but a wrong code is free
// to retry, so cap attempts ourselves before their INVALID_CODE budget is the
// only thing standing between an attacker and a six-digit space.
const MAX_ATTEMPTS = 5;

// Network deadline. A hung provider must not hold a signup request open.
const TIMEOUT_MS = 15000;

db.exec(`
CREATE TABLE IF NOT EXISTS otp_pending (
  phone TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

/** Iraqi 07XXXXXXXXX → E.164 +9647XXXXXXXXX. */
function toE164(iraqiPhone) {
  if (typeof iraqiPhone !== 'string' || !iraqiPhone.startsWith('0')) return null;
  return '+964' + iraqiPhone.slice(1);
}

export function otpConfigured() { return !!API_KEY; }
export function otpRequired() { return process.env.OTP_REQUIRED === 'true'; }

/** Their error codes → ours, so routes and the app keep one vocabulary. */
function mapError(code, httpStatus) {
  switch (code) {
    case 'INVALID_PHONE': return 'bad_phone';
    case 'RATE_LIMIT_PHONE':
    case 'RATE_LIMIT_IP': return 'otp_rate_limited';
    case 'INSUFFICIENT_CREDITS': return 'otp_unavailable';
    case 'INVALID_CODE': return 'bad_code';
    case 'EXPIRED_CODE': return 'otp_expired';
    case 'MESSAGE_NOT_FOUND': return 'otp_expired';
    case 'UNKNOWN_AUTH_TEMPLATE': return 'otp_send_failed';
    default: return httpStatus === 401 || httpStatus === 403
      ? 'otp_not_configured'
      : 'otp_send_failed';
  }
}

async function arqam(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { httpStatus: res.status, ok: res.ok, data };
  } catch (e) {
    // Abort or transport failure. Never surface the exception text — it can
    // carry the URL and headers.
    return { httpStatus: 0, ok: false, data: null, transport: e?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a code. `channel` is accepted and ignored: this platform is WhatsApp
 * first and decides for itself whether a number without WhatsApp needs an SMS
 * instead. We do not offer the caller a choice we cannot honour.
 */
export async function sendCode(iraqiPhone) {
  if (!API_KEY) return { ok: false, error: 'otp_not_configured' };
  const to = toE164(iraqiPhone);
  if (!to) return { ok: false, error: 'bad_phone' };

  // Let ARQAM generate the code. Passing our own would mean holding a live
  // secret in our logs and memory for no gain — `otpCode` exists for callers
  // who must control the value, and we are not one.
  const r = await arqam('/sms/otp', { phoneNumber: to, templateName: TEMPLATE });

  if (!r.ok || !r.data?.success || !r.data?.messageId) {
    if (r.transport) {
      console.warn('[otp] send transport failure:', r.transport);
      return { ok: false, error: 'otp_send_failed' };
    }
    const code = r.data?.error || r.data?.code || null;
    console.warn('[otp] send rejected:', r.httpStatus, code);
    return { ok: false, error: mapError(code, r.httpStatus) };
  }

  // One pending code per phone. A second request replaces the first, which
  // matches what the user expects from tapping "resend" — the newest code is
  // the one that works.
  db.prepare(
    `INSERT INTO otp_pending(phone, message_id, attempts, created_at)
     VALUES(?,?,0,?)
     ON CONFLICT(phone) DO UPDATE SET
       message_id=excluded.message_id, attempts=0, created_at=excluded.created_at`,
  ).run(iraqiPhone, String(r.data.messageId), now());

  return { ok: true, channel: 'whatsapp', status: r.data.status || 'sent' };
}

export async function checkCode(iraqiPhone, code) {
  if (!API_KEY) return { ok: false, error: 'otp_not_configured' };
  if (typeof code !== 'string' || !/^\d{4,10}$/.test(code)) {
    return { ok: false, error: 'bad_code' };
  }

  // Sweep first, so an expired row can't be retried against.
  db.prepare('DELETE FROM otp_pending WHERE created_at < ?').run(now() - PENDING_TTL_MS);

  const pending = db.prepare('SELECT * FROM otp_pending WHERE phone=?').get(iraqiPhone);
  // No row means we never sent, or it aged out. Either way there is nothing
  // to check — and saying "expired" rather than "wrong" is both true and the
  // more useful thing to read.
  if (!pending) return { ok: false, error: 'otp_expired' };

  if (pending.attempts >= MAX_ATTEMPTS) {
    db.prepare('DELETE FROM otp_pending WHERE phone=?').run(iraqiPhone);
    return { ok: false, error: 'otp_rate_limited' };
  }
  db.prepare('UPDATE otp_pending SET attempts=attempts+1 WHERE phone=?').run(iraqiPhone);

  const r = await arqam('/sms/verify', { messageId: pending.message_id, code });

  if (r.transport) {
    console.warn('[otp] verify transport failure:', r.transport);
    return { ok: false, error: 'otp_check_failed' };
  }

  if (r.ok && r.data?.verified === true) {
    // Consume it. Without this a code stays valid for its full window and can
    // be replayed to mint a second session.
    db.prepare('DELETE FROM otp_pending WHERE phone=?').run(iraqiPhone);
    return { ok: true, approved: true };
  }

  const errCode = r.data?.error || r.data?.code || null;
  // A wrong code is a normal answer, not a provider failure: report it as
  // "not approved" so the route replies 401 rather than 502.
  if (errCode === 'INVALID_CODE' || r.data?.verified === false) {
    return { ok: true, approved: false };
  }
  if (errCode === 'EXPIRED_CODE' || errCode === 'MESSAGE_NOT_FOUND') {
    db.prepare('DELETE FROM otp_pending WHERE phone=?').run(iraqiPhone);
    return { ok: false, error: 'otp_expired' };
  }
  console.warn('[otp] verify rejected:', r.httpStatus, errCode);
  return { ok: false, error: mapError(errCode, r.httpStatus) };
}
