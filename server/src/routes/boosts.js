// The rewarded-ad boost: watch one video, come back to the top of «الأحدث».
//
// Three routes, and the split between them is the whole security design:
//
//   POST /listings/:id/boost/start   the seller asks. Checks ownership and
//                                    the allowance, mints a nonce, and
//                                    SPENDS NOTHING. An ad that fails to
//                                    load, or is closed early, leaves a
//                                    `pending` row that never becomes a
//                                    boost — the seller loses nothing.
//   GET  /admob/ssv                  Google tells us, server to server, that
//                                    the video was watched. This is the ONLY
//                                    path that grants. Public and unauthed
//                                    because Google is the caller, and safe
//                                    because every request is signature-
//                                    verified against Google's own keys.
//   GET  /listings/:id/boost         what the app polls afterwards. The app's
//                                    own reward callback is a hint to start
//                                    polling, never a grant — a rooted phone
//                                    can fake it, and Google's signature
//                                    cannot be faked.
//
// The seller must never lose a boost to a backend hiccup, so the grant is
// idempotent on Google's transaction_id: a retried callback finds the UNIQUE
// index, does nothing, and returns 200 so Google stops retrying.

import { Router } from 'express';
import crypto from 'node:crypto';
import { db, now, getSetting } from '../db.js';
import { requireAuth } from '../auth.js';
import { createLimiter } from '../limits.js';
import { logEvent } from '../eventLog.js';
import { boostConfig, boostAllowance, boostStreak } from '../boostLimits.js';
import { listingRankPosition, decideBoost } from '../smartBoost.js';
import { verifyCallback } from '../admobSsv.js';

const r = Router();

/** Google's official test unit. Works with no AdMob account at all. */
const TEST_UNIT_ANDROID = 'ca-app-pub-3940256099942544/5224354917';
const TEST_UNIT_IOS = 'ca-app-pub-3940256099942544/1712485313';

function cfg() { return boostConfig(getSetting); }

function adUnitFor(platform, c) {
  if (String(platform).toLowerCase() === 'ios') return c.adUnitIos || TEST_UNIT_IOS;
  return c.adUnitAndroid || TEST_UNIT_ANDROID;
}

/** The listing plus the reason it cannot be boosted, if any. */
function boostableListing(id, userId) {
  const row = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(id);
  if (!row || row.status === 'removed') return { error: 'not_found', status: 404 };
  if (row.seller_id !== userId) return { error: 'forbidden', status: 403 };
  // Sold, expired and draft listings are not promotable. Bumping a sold phone
  // to the top of the feed spends a real ad impression on a dead end and
  // annoys every buyer who taps it.
  if (!['active', 'reserved'].includes(row.status)) return { error: 'listing_not_active', status: 400 };
  if (row.is_draft) return { error: 'listing_not_active', status: 400 };
  return { row };
}

/** Everything the boost UI needs, in one shape both routes return. */
function boostState(listingRow, userId, c, t) {
  const allowance = boostAllowance(db, userId, c, t);
  const streak = boostStreak(db, userId, t);
  return {
    enabled: c.enabled,
    max_per_24h: c.maxPer24h,
    used: allowance.used,
    remaining: allowance.remaining,
    allowed: allowance.allowed,
    reason: allowance.reason,
    next_available_at: allowance.nextAvailableAt,
    streak: streak.streak,
    streak_used_today: streak.usedToday,
    day_ends_at: streak.dayEndsAt,
    listing: listingRow ? {
      id: listingRow.id,
      is_boosted: !!(listingRow.boost_highlight_until && listingRow.boost_highlight_until > t),
      boost_highlight_until: listingRow.boost_highlight_until ?? null,
      scheduled_bump_at: listingRow.boost_scheduled_bump_done_at ? null : (listingRow.boost_scheduled_bump_at ?? null),
      bumped_at: listingRow.bumped_at ?? null,
    } : null,
  };
}

// ─── the seller asks ─────────────────────────────────────────────────
r.post('/listings/:id(\\d+)/boost/start', requireAuth(), createLimiter, (req, res) => {
  const c = cfg();
  if (!c.enabled) return res.status(403).json({ error: 'boost_disabled' });

  const found = boostableListing(req.params.id, req.user.id);
  if (found.error) return res.status(found.status).json({ error: found.error });

  const t = now();
  const allowance = boostAllowance(db, req.user.id, c, t);
  if (!allowance.allowed) {
    return res.status(429).json({
      error: allowance.reason === 'cooldown' ? 'boost_cooldown' : 'boost_limit_reached',
      next_available_at: allowance.nextAvailableAt,
      ...boostState(found.row, req.user.id, c, t),
    });
  }

  // Measured NOW, not at reward time: it is the rank the seller was looking
  // at when they chose to watch, and four minutes of other people's posts
  // should not change which branch their reward takes.
  const rank = listingRankPosition(db, found.row.id);
  const nonce = crypto.randomUUID();

  db.prepare(
    `INSERT INTO listing_boosts(user_id, listing_id, nonce, status, rank_at_request, requested_at)
     VALUES(?,?,?,'pending',?,?)`,
  ).run(req.user.id, found.row.id, nonce, rank, t);

  logEvent({ type: 'boost_ad_requested', listing_id: found.row.id, user_id: req.user.id, brand: found.row.brand });

  res.json({
    nonce,
    ad_unit_id: adUnitFor(req.headers['x-app-platform'], c),
    ...boostState(found.row, req.user.id, c, t),
  });
});

// ─── what the app polls ──────────────────────────────────────────────
r.get('/listings/:id(\\d+)/boost', requireAuth(), (req, res) => {
  const c = cfg();
  const found = boostableListing(req.params.id, req.user.id);
  // A sold listing still reports state — the screen has to explain itself
  // rather than 400 at a seller who marked something sold mid-flow.
  const row = found.row
    || db.prepare('SELECT * FROM phone_listings WHERE id=?').get(req.params.id);
  if (!row || row.seller_id !== req.user.id) {
    return res.status(found.status || 404).json({ error: found.error || 'not_found' });
  }
  const t = now();
  const state = boostState(row, req.user.id, c, t);
  state.eligible = !found.error;
  state.ineligible_reason = found.error || null;

  // The most recent attempt on this listing, so the app can tell "your
  // reward is still landing" from "nothing happened".
  const attempt = db.prepare(
    `SELECT nonce, status, boost_type, requested_at, granted_at
       FROM listing_boosts WHERE listing_id=? AND user_id=?
      ORDER BY requested_at DESC LIMIT 1`,
  ).get(row.id, req.user.id);
  state.last_attempt = attempt || null;
  res.json(state);
});

// ─── Google tells us ─────────────────────────────────────────────────
//
// Always answers 200 unless we genuinely want a retry. AdMob retries on a
// non-2xx, and retrying a callback we have already rejected as forged, or
// already granted, achieves nothing but load.
r.get('/admob/ssv', async (req, res) => {
  const verified = await verifyCallback(req.originalUrl);
  if (!verified.ok) {
    // 'unknown_key' is the one failure worth retrying: a key rotation we have
    // not caught up with yet. Everything else is malformed or forged.
    if (verified.reason === 'unknown_key') return res.status(503).end();
    console.warn('[admob] rejected callback:', verified.reason);
    return res.status(200).end();
  }

  const { transactionId, customData } = verified.data;
  const t = now();

  try {
    grantBoost({ nonce: customData, transactionId, t });
  } catch (e) {
    // A real failure (disk, lock) — let Google retry. The transaction-id
    // index makes a duplicate harmless.
    console.error('[admob] grant failed:', e?.message || e);
    return res.status(500).end();
  }
  res.status(200).end();
});

/**
 * The only place a boost is written. Runs in one transaction so two callbacks
 * arriving together cannot both pass the allowance check.
 */
export function grantBoost({ nonce, transactionId, t = now() }) {
  return db.transaction(() => {
    const attempt = db.prepare('SELECT * FROM listing_boosts WHERE nonce=?').get(String(nonce || ''));
    // An unknown nonce will never become known. Swallow it.
    if (!attempt) return { ok: false, reason: 'unknown_nonce' };
    // Already granted — a duplicate callback, which is normal and must be a
    // no-op rather than a second boost.
    if (attempt.ad_transaction_id) return { ok: false, reason: 'already_granted' };

    const c = cfg();
    const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(attempt.listing_id);
    const gone = !listing
      || listing.seller_id !== attempt.user_id
      || !['active', 'reserved'].includes(listing.status);
    if (gone) {
      db.prepare("UPDATE listing_boosts SET status='failed', failure_reason='listing_gone' WHERE id=?")
        .run(attempt.id);
      return { ok: false, reason: 'listing_gone' };
    }

    // Re-checked here, not trusted from /start: minutes passed while the ad
    // played, and two ads watched in parallel would both have passed there.
    const allowance = boostAllowance(db, attempt.user_id, c, t);
    if (!allowance.allowed) {
      db.prepare("UPDATE listing_boosts SET status='failed', failure_reason=? WHERE id=?")
        .run(allowance.reason || 'not_allowed', attempt.id);
      return { ok: false, reason: allowance.reason };
    }

    const decision = decideBoost(Number(attempt.rank_at_request ?? 0), c, t);

    // Extend, never truncate: a seller boosting a listing that is still
    // highlighted keeps the longer of the two windows, the same rule
    // applyFeature() uses for paid time.
    const currentHighlight = Number(listing.boost_highlight_until || 0);
    const highlightUntil = Math.max(currentHighlight, decision.highlightUntil);

    db.prepare(
      `UPDATE phone_listings
          SET bumped_at = COALESCE(?, bumped_at),
              boost_highlight_until = ?,
              boost_scheduled_bump_at = ?,
              boost_scheduled_bump_done_at = NULL
        WHERE id = ?`,
    ).run(decision.bumpedAt, highlightUntil, decision.scheduledBumpAt, listing.id);

    db.prepare(
      `UPDATE listing_boosts
          SET ad_transaction_id=?, status=?, boost_type=?, reward_earned_at=?, granted_at=?
        WHERE id=?`,
    ).run(
      String(transactionId),
      decision.type === 'delayed_bump' ? 'scheduled' : 'boosted',
      decision.type,
      t, t, attempt.id,
    );

    logEvent({
      type: decision.type === 'delayed_bump' ? 'boost_delayed' : 'boost_immediate',
      listing_id: listing.id, user_id: attempt.user_id, brand: listing.brand,
    });
    return { ok: true, type: decision.type };
  })();
}

export default r;
