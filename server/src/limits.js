// Per-route rate limits.
//
// All limiters are keyed on the requester's IP (express trusts the X-Forwarded-For
// header set by the nginx upstream — see index.js's app.set('trust proxy', 1)).
// Responses on rate-limit return { error: 'rate_limited' } so the mobile
// client's ar.errors map can render a localized message.
//
// Numbers are tuned for an Iraqi marketplace launching to a small initial
// audience — generous enough that real users never see a 429, tight enough
// to block credential-stuffing and disk-fill attacks.

import rateLimit from 'express-rate-limit';

const json429 = (req, res /* opts */) => {
  res.status(429).json({ error: 'rate_limited' });
};

const baseOpts = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
};

// Login + phone-login + register. Five attempts per minute is enough for
// a real user typo'ing their phone three times; anything north of that
// looks like a script.
export const authLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  max: 5,
});

// Guest provisioning. Without this, an attacker can loop /auth/guest and
// fill the users table since every call mints a new row + JWT. 20/hr per
// IP is plenty for legitimate first-launches behind a shared NAT.
export const guestLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 60 * 1000,
  max: 20,
});

// Image upload. Each call can carry up to 10 × 5MB. 30 multipart requests
// per minute per IP caps disk-fill at ~1.5GB/min before the limiter kicks
// in — well above what a real user uploads, well below what an abuser
// needs to be a problem.
export const uploadLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  max: 30,
});

// Reports endpoint. Five per minute is fine for a real user flagging a
// few listings; spammers go to a thousand and hit this immediately.
export const reportLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  max: 5,
});

// Listing creation. Eight per minute per IP — accommodates a shop posting
// inventory in bursts without enabling spam-listing automation.
export const createLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  max: 8,
});
