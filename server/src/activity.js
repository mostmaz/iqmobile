// Daily-active-user tracking.
//
// Two different questions get asked about "active users", and they have
// genuinely different answers, so we record both rather than picking one:
//
//   opened   — the app made an authenticated request that day. Reach: how
//              many people the app is in front of at all.
//   engaged  — the user did something with intent (search, view a listing,
//              tap call/WhatsApp). That comes from the existing `events`
//              table and needs nothing new.
//
// Only `opened` needs new plumbing, and it must be nearly free: it runs on
// every authenticated request. Two things keep it cheap —
//   1. one row per user per day (PRIMARY KEY(user_id, day)), so the table
//      grows with users×days, not with requests, and
//   2. an in-process cache so a user who is hammering the API touches SQLite
//      about once every 10 minutes instead of on every call.
//
// Days are Baghdad days (UTC+3, no DST), not UTC — otherwise "today" on the
// dashboard would roll over at 3am local and the numbers would look wrong to
// the person reading them.

import { db, now } from './db.js';
import { verifyToken } from './auth.js';

const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 10 * 60 * 1000;

/** 'YYYY-MM-DD' for a timestamp, in Baghdad local time. */
export function baghdadDay(ts = Date.now()) {
  return new Date(ts + BAGHDAD_OFFSET_MS).toISOString().slice(0, 10);
}

// user_id -> last timestamp we wrote a row for. Bounded by clearing entries
// that fall out of the window, so a long-running process can't leak memory
// across a large user base.
const lastTouch = new Map();
function shouldTouch(userId, ts) {
  const prev = lastTouch.get(userId);
  if (prev && ts - prev < TOUCH_EVERY_MS) return false;
  lastTouch.set(userId, ts);
  if (lastTouch.size > 5000) {
    for (const [k, v] of lastTouch) if (ts - v > TOUCH_EVERY_MS) lastTouch.delete(k);
  }
  return true;
}

const upsert = db.prepare(
  `INSERT INTO user_active_days(user_id, day, requests, first_seen, last_seen, platform, app_version)
   VALUES(?,?,1,?,?,?,?)
   ON CONFLICT(user_id, day) DO UPDATE SET
     requests = requests + 1,
     last_seen = excluded.last_seen,
     platform = COALESCE(excluded.platform, platform),
     app_version = COALESCE(excluded.app_version, app_version)`,
);

/**
 * Record that a user was active today. Safe to call on any request —
 * unauthenticated calls are ignored and every failure is swallowed, because
 * analytics must never break a user-facing response.
 */
export function touchActive(userId, meta = {}) {
  if (!userId) return;
  const ts = now();
  if (!shouldTouch(userId, ts)) return;
  try {
    upsert.run(userId, baghdadDay(ts), ts, ts, meta.platform || null, meta.appVersion || null);
  } catch (e) {
    console.warn('[activity] touch failed:', e?.message);
  }
}

/**
 * Express middleware, mounted globally BEFORE the routes.
 *
 * It decodes the bearer token itself rather than reading req.user, because
 * auth in this app is per-route (requireAuth/optionalAuth), so req.user does
 * not exist yet at the app level. Admin tokens are skipped — dashboard
 * traffic is not app usage and would inflate the numbers with our own.
 *
 * Platform/version come from the app's own headers when present, so the
 * dashboard can show the version spread without a separate ping endpoint.
 */
export function activityTracker() {
  return (req, _res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      const payload = token && verifyToken(token);
      if (payload?.id && payload.kind !== 'admin') {
        touchActive(payload.id, {
          platform: req.get('x-app-platform') || null,
          appVersion: req.get('x-app-version') || null,
        });
      }
    } catch { /* never let tracking break a request */ }
    next();
  };
}
