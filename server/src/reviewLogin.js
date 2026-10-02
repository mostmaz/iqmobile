// App Review sign-in.
//
// Apple and Google reviewers sign in with a demo phone number we hand them,
// and with OTP on, the WhatsApp code goes to whoever owns that number — not
// to them. Apple rejected 1.0.0 (2.1(a)) for exactly that and asked for a
// fixed code on the demo account instead.
//
// So one configured number gets one fixed code:
//   REVIEW_DEMO_PHONE — the demo number given in the review notes. Use a
//                       number on an unallocated prefix (073…) so no real
//                       person can own it and be locked out of their account.
//   REVIEW_DEMO_CODE  — six digits, given in the review notes.
// Both unset (or either malformed) → off; every number takes the real path.
//
// That number never reaches ARQAM: nothing is sent and nothing is billed.
// Every other number is untouched. Read on each call so the pair can be
// rotated with a restart and tests can set it per case.
import crypto from 'node:crypto';
import { normalizeIraqiMobile } from './iraqiPhone.js';

function config() {
  const phone = normalizeIraqiMobile(process.env.REVIEW_DEMO_PHONE || '');
  const code = String(process.env.REVIEW_DEMO_CODE || '').trim();
  if (!phone || !/^\d{6}$/.test(code)) return null;
  return { phone, code };
}

/** Is this canonical phone the review demo number? */
export function isReviewPhone(phone) {
  const c = config();
  return !!c && c.phone === phone;
}

/** Does `code` open the review demo account? Constant-time compare. */
export function reviewCodeMatches(phone, code) {
  const c = config();
  if (!c || c.phone !== phone || typeof code !== 'string' || code.length !== c.code.length) return false;
  return crypto.timingSafeEqual(Buffer.from(code), Buffer.from(c.code));
}
