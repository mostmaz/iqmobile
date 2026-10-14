import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import 'dotenv/config';
import { db } from './db.js';

// No public fallback constant: a committed default is a signing-key leak.
// Production requires JWT_SECRET (enforced at boot in index.js); when it is
// genuinely absent (local dev) we mint a random per-process secret — tokens
// simply don't survive a restart, which is the correct dev behaviour.
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// How long a session lasts. App accounts, guests included, keep theirs for
// a year from when the token was issued, and /auth/me hands out a fresh one
// on the way (see renewedToken), so someone who opens the app is never
// signed out by the calendar.
//
// Until 15 Oct 2026 every token died after JWT_TTL=7d, and the app answers
// an expired token by provisioning a NEW guest. So every guest became a
// stranger on day 8 — retention measured 0.0% from day 8 in every cohort —
// and lost its chats, saved searches, alerts and favourites; half the
// registered users still around on day 7 were signed out on day 8, and the
// buyers chatting to them waited for a seller who no longer had the inbox.
// App tokens are therefore judged by their age, not their exp claim, so the
// 7-day tokens already in people's phones are honoured for the full year.
//
// Admin tokens keep the short life (JWT_TTL, default 7d): the dashboard has
// a login screen, and an admin token is worth stealing.
const DAY_MS = 24 * 60 * 60 * 1000;
export const APP_SESSION_DAYS = Number(process.env.APP_SESSION_DAYS) || 365;
const ADMIN_TTL = process.env.JWT_TTL || '7d';
// /auth/me renews a token once it is this old.
const RENEW_AFTER_DAYS = 7;

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

export function issueToken(payload) {
  const expiresIn = payload?.kind === 'admin' ? ADMIN_TTL : `${APP_SESSION_DAYS}d`;
  return jwt.sign(payload, SECRET, { expiresIn });
}

export function verifyToken(token, at = Date.now()) {
  try {
    const p = jwt.verify(token, SECRET, { ignoreExpiration: true });
    if (p.kind === 'admin') return p.exp && p.exp * 1000 > at ? p : null;
    if (!p.iat || at - p.iat * 1000 > APP_SESSION_DAYS * DAY_MS) return null;
    return p;
  } catch {
    return null;
  }
}

/** A fresh app token for this payload once it is a week old, else null. */
export function renewedToken(payload, at = Date.now()) {
  if (!payload?.id || payload.kind === 'admin' || !payload.iat) return null;
  if (at - payload.iat * 1000 < RENEW_AFTER_DAYS * DAY_MS) return null;
  return issueToken({ id: payload.id });
}

// Single-user model — every user can be both buyer and seller depending on
// what they're doing. We just need a valid logged-in user; per-action
// authorization (am I the seller of this listing? the buyer of this chat?)
// is enforced in each route.
//
// Suspension check: users.suspended_at is set by the admin dashboard. A
// suspended user's existing JWT continues to be cryptographically valid,
// but we reject it here with 403 `user_suspended` so the mobile client
// can surface the explanation screen.
export function requireAuth() {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token && verifyToken(token);
    if (!payload || !payload.id || payload.kind === 'admin')
      return res.status(401).json({ error: 'unauthorized' });
    const u = db.prepare('SELECT suspended_at FROM users WHERE id=?').get(payload.id);
    if (u?.suspended_at) return res.status(403).json({ error: 'user_suspended' });
    req.user = payload;
    next();
  };
}

// Like requireAuth but doesn't 401 when the caller is unauthenticated —
// just leaves req.user = null. Used by the public browse endpoints so
// anonymous visitors can see listings before they sign up.
export function optionalAuth() {
  return (req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token && verifyToken(token);
    req.user = payload && payload.id && payload.kind !== 'admin' ? payload : null;
    next();
  };
}

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload || payload.kind !== 'admin') return res.status(401).json({ error: 'unauthorized' });
  req.admin = payload;
  next();
}
