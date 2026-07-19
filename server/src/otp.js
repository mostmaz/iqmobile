// Twilio Verify wrapper for phone-OTP sign-in.
//
// Config (env):
//   TWILIO_ACCOUNT_SID          — non-secret account identifier (AC...)
//   TWILIO_AUTH_TOKEN           — secret, never log
//   TWILIO_VERIFY_SERVICE_SID   — Verify Service SID (VA...)
//   OTP_REQUIRED                — 'true' to gate /auth/phone-login behind OTP
//
// The Twilio client is created lazily at boot: if creds are missing the
// module still loads so the server can run in "OTP off" mode without
// crashing. Any OTP call while unconfigured returns { ok:false } so the
// route can 500 with a clean error.

import twilio from 'twilio';

// Iraqi mobile stored as 07XXXXXXXXX → Twilio needs E.164 (+9647XXXXXXXXX).
function toE164(iraqiPhone) {
  if (typeof iraqiPhone !== 'string' || !iraqiPhone.startsWith('0')) return null;
  return '+964' + iraqiPhone.slice(1);
}

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || '';

let client = null;
if (ACCOUNT_SID && AUTH_TOKEN && SERVICE_SID) {
  try { client = twilio(ACCOUNT_SID, AUTH_TOKEN); }
  catch (e) { console.warn('[otp] twilio init failed:', e?.message); }
}

export function otpConfigured() { return !!client && !!SERVICE_SID; }
export function otpRequired() { return process.env.OTP_REQUIRED === 'true'; }

export async function sendCode(iraqiPhone, channel) {
  if (!client) return { ok: false, error: 'otp_not_configured' };
  const to = toE164(iraqiPhone);
  if (!to) return { ok: false, error: 'bad_phone' };
  const ch = channel === 'whatsapp' ? 'whatsapp' : 'sms';
  try {
    const v = await client.verify.v2
      .services(SERVICE_SID)
      .verifications.create({ to, channel: ch });
    return { ok: true, sid: v.sid, status: v.status, channel: ch };
  } catch (e) {
    // 60200 = invalid phone; 60203 = max send attempts reached
    if (e?.code === 60200) return { ok: false, error: 'bad_phone' };
    if (e?.code === 60203) return { ok: false, error: 'otp_rate_limited' };
    console.warn('[otp] send failed', e?.code, e?.message);
    return { ok: false, error: 'otp_send_failed' };
  }
}

export async function checkCode(iraqiPhone, code) {
  if (!client) return { ok: false, error: 'otp_not_configured' };
  const to = toE164(iraqiPhone);
  if (!to) return { ok: false, error: 'bad_phone' };
  if (typeof code !== 'string' || !/^\d{4,10}$/.test(code)) {
    return { ok: false, error: 'bad_code' };
  }
  try {
    const c = await client.verify.v2
      .services(SERVICE_SID)
      .verificationChecks.create({ to, code });
    return { ok: true, approved: c.status === 'approved' };
  } catch (e) {
    // 20404 = verification expired or already consumed → treat as "not approved"
    if (e?.code === 20404) return { ok: true, approved: false };
    console.warn('[otp] check failed', e?.code, e?.message);
    return { ok: false, error: 'otp_check_failed' };
  }
}
