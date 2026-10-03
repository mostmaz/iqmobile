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

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db, getSetting } from './db.js';
import { verifyToken } from './auth.js';

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

// Listing creation. Eight per minute per IP for individuals — accommodates
// a normal seller posting a few phones without enabling spam automation.
//
// Shops are exempt (unlimited) while the `shops_unlimited_listings` setting
// is on (the default): they post whole catalogues in bulk, so the per-IP cap
// would block legitimate use. Flip that setting off from the admin dashboard
// (PATCH /admin/settings) to re-cap shops at the 8/min limit — no deploy
// needed. requireAuth() runs before this limiter, so req.user is set; we look
// up the account's seller_type (cheap primary-key lookup) and skip limiting
// for shops. Unauthenticated or individual callers always get the 8/min cap.
const isShopAccount = (req) => {
  const uid = req.user?.id;
  if (!uid) return false;
  if (getSetting('shops_unlimited_listings') === '0') return false;
  try {
    // Self-promotion to shop is blocked in PATCH /me, so seller_type='shop'
    // now means the account really went through shop registration.
    const u = db.prepare('SELECT seller_type FROM users WHERE id=?').get(uid);
    return u?.seller_type === 'shop';
  } catch {
    return false;
  }
};

export const createLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  max: 8,
  skip: isShopAccount,
});

// Order creation. Each call inserts an order + items and pushes to every
// operator device, so an unthrottled loop both bloats the table and spams
// staff. 12/min per IP is far above a real shopper's pace.
export const orderLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  max: 12,
});

// ─── reads ─────────────────────────────────────────────────────────────
// Marketplace reads (listings, shops, the request board, ratings) had no
// limit at all: thirty requests a second were all served (3 Oct 2026).
// Two limiters, both per minute, both on GET only (index.js):
//
//   • per caller — the account behind the token, or the network for a call
//     with no token. Every app install carries a token, so a tokenless
//     caller is not our app and gets the small number.
//   • per network for everyone, loose. Iraqi carriers put many phones behind
//     one address (CGNAT), so this is a flood ceiling, not a budget.
//
// In memory, so a restart forgets them; nginx's limit_req is the layer that
// survives one, and the phone budget in scrapeGuard.js lives in the DB.
function tokenOf(req) {
  if (req._readToken !== undefined) return req._readToken;
  const h = req.headers.authorization || '';
  const p = h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  req._readToken = p && p.id ? p : null;
  return req._readToken;
}
const network = (req) => ipKeyGenerator(req.ip || '', 64);

export const READ_LIMITS = Object.freeze({ account: 120, admin: 600, tokenless: 40, network: 600 });

export const readCallerLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  limit: (req) => {
    const t = tokenOf(req);
    if (!t) return READ_LIMITS.tokenless;
    return t.kind === 'admin' ? READ_LIMITS.admin : READ_LIMITS.account;
  },
  keyGenerator: (req) => {
    const t = tokenOf(req);
    if (!t) return `t:${network(req)}`;
    return t.kind === 'admin' ? `a:${t.id}` : `u:${t.id}`;
  },
});

export const readNetworkLimiter = rateLimit({
  ...baseOpts,
  windowMs: 60 * 1000,
  limit: READ_LIMITS.network,
  keyGenerator: network,
});

/** Both read limiters, GET only. Everything else passes straight through. */
export function readLimits(req, res, next) {
  if (req.method !== 'GET') return next();
  readNetworkLimiter(req, res, (err) => (err ? next(err) : readCallerLimiter(req, res, next)));
}
