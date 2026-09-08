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
// Their responses are HTTP 200 for almost everything, and come in TWO
// shapes — reading only one of them is what broke the first live sign-in:
//
//   business outcome   { success: true,  messageId, status, cost, channel }
//                      { success: false, message: 'Invalid OTP code' }
//                      { success: false, message: 'Invalid message ID' }
//   input validation   { error: 'OTP code must be exactly 6 digits',
//                        code: 'INVALID_OTP_FORMAT' }
//
// So `success` is the verdict and `message` is the reason, EXCEPT when the
// request never got as far as being a verdict, where it is `code`. There is
// no `verified` field anywhere; an earlier version of this file looked for
// one, matched nothing on a CORRECT code, and reported "we couldn't send the
// code" on the verify step.
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
import { toE164 as toE164Strict, normalizeIraqiMobile } from './iraqiPhone.js';
import {
  createSendLogTable, checkSendAllowed, recordSend, sendsInLastHour, ALERT_PER_HOUR,
} from './otpRate.js';

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

// ARQAM rejects anything but six digits with INVALID_OTP_FORMAT. Checking it
// here turns a confusing round trip into an immediate, accurate answer.
const CODE_RE = /^\d{6}$/;

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
createSendLogTable(db);

// Was: `startsWith('0')` and nothing else, so any 10-12 digit string reached
// the paid provider as +964…. iraqiPhone.js checks it is an actual mobile.
const toE164 = toE164Strict;

export function otpConfigured() { return !!API_KEY; }
export function otpRequired() { return process.env.OTP_REQUIRED === 'true'; }

/**
 * Their failure vocabulary → ours, so routes and the app keep one.
 *
 * Takes both fields because they use both: `code` on a validation error and
 * `message` on a business one. The message strings are prose and could be
 * reworded by them at any time, so they are matched loosely and every
 * unrecognised answer falls through to a generic failure — never to success.
 */
function mapError({ code, message, httpStatus }) {
  switch (code) {
    case 'INVALID_PHONE': return 'bad_phone';
    case 'RATE_LIMIT_PHONE':
    case 'RATE_LIMIT_IP': return 'otp_rate_limited';
    case 'INSUFFICIENT_CREDITS': return 'otp_unavailable';
    case 'INVALID_CODE': return 'bad_code';
    case 'EXPIRED_CODE': return 'otp_expired';
    case 'MESSAGE_NOT_FOUND': return 'otp_expired';
    case 'INVALID_OTP_FORMAT': return 'bad_code';
    case 'UNKNOWN_AUTH_TEMPLATE': return 'otp_send_failed';
  }
  const m = String(message || '').toLowerCase();
  if (m.includes('invalid otp') || m.includes('incorrect')) return 'bad_code';
  // "Invalid message ID" means the id we hold is unknown to them — spent,
  // aged out, or never theirs. From the caller's side that is an expired
  // code, and telling them to request a new one is the useful answer.
  if (m.includes('message id') || m.includes('expired') || m.includes('not found')) return 'otp_expired';
  if (m.includes('credit') || m.includes('balance')) return 'otp_unavailable';
  if (m.includes('rate limit') || m.includes('too many')) return 'otp_rate_limited';
  if (m.includes('phone')) return 'bad_phone';
  return httpStatus === 401 || httpStatus === 403
    ? 'otp_not_configured'
    : 'otp_send_failed';
}

/** Pull the reason out of whichever shape came back. */
function reasonOf(data) {
  return { code: data?.code || data?.error || null, message: data?.message || null };
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
export async function sendCode(iraqiPhone, opts = {}) {
  if (!API_KEY) return { ok: false, error: 'otp_not_configured' };
  const to = toE164(iraqiPhone);
  if (!to) return { ok: false, error: 'bad_phone' };

  // Key everything on the CANONICAL form, never on the string we were handed.
  // The rate limit and the pending row are both keyed by phone, so if
  // '+9647701234567' and '07701234567' produced two keys they would get two
  // separate budgets — the same number buying double the sends. The route
  // normalises before calling us today, but a limit that depends on every
  // caller remembering to normalise is a limit waiting to be bypassed.
  const phone = normalizeIraqiMobile(iraqiPhone);

  // Checked BEFORE the network call — the whole point is not to spend the
  // money. A refusal is logged too, so the admin view shows attack pressure
  // and not just the sends that got through.
  const gate = checkSendAllowed(db, phone, { now: opts.now });
  if (!gate.allowed) {
    recordSend(db, { phone: phone, ip: opts.ip, outcome: `blocked_${gate.rule}`, now: opts.now });
    return { ok: false, error: gate.error, retryAfterMs: gate.retryAfterMs };
  }

  // Let ARQAM generate the code. Passing our own would mean holding a live
  // secret in our logs and memory for no gain — `otpCode` exists for callers
  // who must control the value, and we are not one.
  const r = await arqam('/sms/otp', { phoneNumber: to, templateName: TEMPLATE });

  if (!r.ok || r.data?.success !== true || !r.data?.messageId) {
    if (r.transport) {
      console.warn('[otp] send transport failure:', r.transport);
      return { ok: false, error: 'otp_send_failed' };
    }
    const { code, message } = reasonOf(r.data);
    console.warn('[otp] send rejected:', r.httpStatus, code, message);
    return { ok: false, error: mapError({ code, message, httpStatus: r.httpStatus }) };
  }

  // One pending code per phone. A second request replaces the first, which
  // matches what the user expects from tapping "resend" — the newest code is
  // the one that works.
  db.prepare(
    `INSERT INTO otp_pending(phone, message_id, attempts, created_at)
     VALUES(?,?,0,?)
     ON CONFLICT(phone) DO UPDATE SET
       message_id=excluded.message_id, attempts=0, created_at=excluded.created_at`,
  ).run(phone, String(r.data.messageId), now());

  // They choose the channel (SMS fallback for a number with no WhatsApp), so
  // report the one they actually used. Saying «واتساب» over an SMS sends the
  // user hunting through the wrong app for a code that is already in their
  // inbox.
  const channel = r.data.channel === 'sms' ? 'sms' : 'whatsapp';
  recordSend(db, { phone: phone, ip: opts.ip, channel, outcome: 'sent', now: opts.now });

  // The only signal that a distributed flood is happening. Per-phone limits
  // cannot see it — each number stays under its own cap while the total
  // climbs. console.error rather than Sentry because a 400 is not a throw and
  // Sentry only captures throws.
  const lastHour = sendsInLastHour(db, { now: opts.now });
  if (lastHour >= ALERT_PER_HOUR) {
    console.error(`[otp][ALERT] ${lastHour} codes sent in the last hour (threshold ${ALERT_PER_HOUR}) — check /admin/otp-activity`);
  }

  return { ok: true, channel, status: r.data.status || 'sent' };
}

export async function checkCode(rawPhone, code) {
  // Same canonicalisation as sendCode, or a verify would miss the row a send
  // wrote under a differently-spelled version of the same number.
  const iraqiPhone = normalizeIraqiMobile(rawPhone) ?? rawPhone;
  if (!API_KEY) return { ok: false, error: 'otp_not_configured' };
  if (typeof code !== 'string' || !CODE_RE.test(code)) {
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

  if (r.ok && r.data?.success === true) {
    // Consume it. Without this a code stays valid for its full window and can
    // be replayed to mint a second session.
    db.prepare('DELETE FROM otp_pending WHERE phone=?').run(iraqiPhone);
    return { ok: true, approved: true };
  }

  const { code: errCode, message } = reasonOf(r.data);
  const mapped = mapError({ code: errCode, message, httpStatus: r.httpStatus });

  // A wrong code is a normal answer, not a provider failure: report it as
  // "not approved" so the route replies 401 rather than 502. The row stays,
  // so the attempt counter above still governs how many guesses they get.
  if (mapped === 'bad_code') return { ok: true, approved: false };

  if (mapped === 'otp_expired') {
    db.prepare('DELETE FROM otp_pending WHERE phone=?').run(iraqiPhone);
    return { ok: false, error: 'otp_expired' };
  }
  // Log the body's own words, not just our translation of them — the first
  // failure of this integration was invisible precisely because the log said
  // `null` where the answer was sitting in a field nobody read.
  console.warn('[otp] verify rejected:', r.httpStatus, errCode, message);
  return { ok: false, error: mapped };
}
