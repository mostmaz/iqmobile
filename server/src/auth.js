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
const TTL = process.env.JWT_TTL || '30d';

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

export function issueToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: TTL });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
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
