import { sendSellerSummaries } from './sellerSummaries.js';
import { db, getSetting } from './db.js';
import { emitTo } from './sse.js';
import { nudgeStalePromotions } from './featureNudge.js';
import { logEvent } from './eventLog.js';

// Listings auto-expire after their TTL elapses; sellers can renew via PATCH.
// Deals time out after 24h in any non-terminal state (so phone numbers aren't
// permanently exposed because of a stale "seller_confirmed" record on a
// listing the seller forgot about).
const DEAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// A "last known price" listing is auto-removed once it's been stale this long
// (~6 months). Long enough that a still-relevant model that briefly vanishes
// from the lists survives, short enough that truly-dead models don't linger.
const STALE_MAX_MS = 182 * 24 * 60 * 60 * 1000;

// Per-tick cap on rows we touch. After downtime/sleep the SELECT can match
// thousands of overdue rows; processing them in a single tight loop locks
// the DB for seconds and stalls every concurrent request. 500 per 30s is
// plenty to drain a backlog while staying interactive.
const TICK_LIMIT = 500;

function tick() {
  const now = Date.now();

  // "Never expire" mode (default on for now): skip the listing-expiry sweep
  // entirely so nothing lapses. Deals still time out below (unrelated to the
  // listing TTL). Flip listings_never_expire=0 to resume expiring.
  const expL = getSetting('listings_never_expire') === '0'
    ? db
      .prepare(
        `SELECT id, seller_id FROM phone_listings
         WHERE status='active' AND expires_at <= ?
         LIMIT ?`,
      )
      .all(now, TICK_LIMIT)
    : [];
  for (const l of expL) {
    // Guard against the SELECT-then-UPDATE race: another request (renew,
    // seller-confirm flipping to 'sold', moderation 'removed') could have
    // mutated the row between our SELECT and UPDATE. Only flip rows that
    // are STILL active so we never clobber a fresh state transition into
    // 'expired'. .changes lets us skip the SSE emit if the UPDATE didn't
    // actually fire — avoids false "your listing expired" pings.
    const r = db
      .prepare(
        `UPDATE phone_listings SET status='expired', updated_at=?
         WHERE id=? AND status='active' AND expires_at <= ?`,
      )
      .run(now, l.id, now);
    if (r.changes > 0) emitTo(l.seller_id, 'listing.expired', { id: l.id });
  }

  const stale = db
    .prepare(
      `SELECT id, buyer_id, seller_id FROM deals
       WHERE status IN ('proposed','buyer_accepted') AND updated_at <= ?
       LIMIT ?`,
    )
    .all(now - DEAL_TIMEOUT_MS, TICK_LIMIT);
  for (const d of stale) {
    // Same race protection — narrow the UPDATE to the exact pre-state.
    const r = db
      .prepare(
        `UPDATE deals SET status='expired', updated_at=?
         WHERE id=? AND status IN ('proposed','buyer_accepted')`,
      )
      .run(now, d.id);
    if (r.changes > 0) {
      emitTo(d.buyer_id, 'deal.expired', { id: d.id });
      emitTo(d.seller_id, 'deal.expired', { id: d.id });
    }
  }

  // ─── featured listings ───────────────────────────────────────────────
  // Expire featured windows that have elapsed (clears the pin so the listing
  // sorts by recency again).
  db.prepare(
    `UPDATE phone_listings
     SET featured_until=NULL, feature_tier=NULL, next_boost_at=NULL, boost_interval_ms=NULL
     WHERE featured_until IS NOT NULL AND featured_until <= ?`,
  ).run(now);

  // Re-bump still-active featured listings that are due for their next
  // scheduled boost — re-stamping boosted_at floats them back to the top of
  // the featured band. next_boost_at moves forward by the tier's interval.
  const dueBoost = db
    .prepare(
      `SELECT id, boost_interval_ms FROM phone_listings
       WHERE featured_until > ? AND next_boost_at IS NOT NULL AND next_boost_at <= ?
       LIMIT ?`,
    )
    .all(now, now, TICK_LIMIT);
  for (const l of dueBoost) {
    const interval = l.boost_interval_ms || 12 * 60 * 60 * 1000;
    db.prepare('UPDATE phone_listings SET boosted_at=?, next_boost_at=? WHERE id=?')
      .run(now, now + interval, l.id);
  }

  // ─── rewarded-ad boosts ──────────────────────────────────────────────
  //
  // Smart Boost's delayed half. A listing that was already near the top got
  // its highlight immediately and its bump deferred to now, so the reward
  // lands when it is worth something instead of moving it from rank 3 to
  // rank 1. This MUST run server-side: the seller has long since closed the
  // app, and a client timer would simply never fire.
  const dueBumps = db
    .prepare(
      `SELECT id FROM phone_listings
        WHERE boost_scheduled_bump_at IS NOT NULL
          AND boost_scheduled_bump_done_at IS NULL
          AND boost_scheduled_bump_at <= ?
        LIMIT ?`,
    )
    .all(now, TICK_LIMIT);
  for (const l of dueBumps) {
    // Narrowed to the exact pre-state, so two ticks overlapping cannot bump
    // twice — the same guard the deal-timeout sweep above uses. A listing
    // sold or removed while it waited is stamped done WITHOUT being bumped:
    // the seller already had their four hours of highlight, and floating a
    // sold phone to the top of the feed is worse than not floating it.
    const res = db
      .prepare(
        `UPDATE phone_listings
            SET bumped_at=?, boost_scheduled_bump_done_at=?
          WHERE id=? AND boost_scheduled_bump_done_at IS NULL
            AND status IN ('active','reserved') AND COALESCE(is_draft,0)=0`,
      )
      .run(now, now, l.id);
    if (res.changes === 0) {
      db.prepare(
        `UPDATE phone_listings SET boost_scheduled_bump_done_at=?
          WHERE id=? AND boost_scheduled_bump_done_at IS NULL`,
      ).run(now, l.id);
      db.prepare(
        `UPDATE listing_boosts SET status='failed', failure_reason='listing_gone'
          WHERE listing_id=? AND status='scheduled'`,
      ).run(l.id);
      continue;
    }
    db.prepare(
      "UPDATE listing_boosts SET status='completed' WHERE listing_id=? AND status='scheduled'",
    ).run(l.id);
    logEvent({ type: 'boost_scheduled_bump_done', listing_id: l.id });
  }

  // Highlight windows that have elapsed. Clearing the column is what returns
  // the card to its normal style — `is_boosted` is computed from it on every
  // response, so nothing else has to be told.
  const doneHighlights = db
    .prepare(
      'SELECT id FROM phone_listings WHERE boost_highlight_until IS NOT NULL AND boost_highlight_until <= ? LIMIT ?',
    )
    .all(now, TICK_LIMIT);
  for (const l of doneHighlights) {
    db.prepare('UPDATE phone_listings SET boost_highlight_until=NULL WHERE id=?').run(l.id);
    // Only an immediate boost completes here. A scheduled one is still owed
    // its bump and is completed by the loop above.
    db.prepare(
      "UPDATE listing_boosts SET status='completed' WHERE listing_id=? AND status='boosted'",
    ).run(l.id);
  }

  // ─── stale "last known price" cleanup ────────────────────────────────
  // A price-aggregator device marked stale_since (dropped off every source's
  // price list) shows as "آخر سعر معروف · غير متوفر حالياً" for a grace
  // window, then is soft-removed so the market view doesn't carry phones that
  // have been unavailable for half a year.
  db.prepare(
    `UPDATE phone_listings SET status='removed', updated_at=?
     WHERE status='active' AND stale_since IS NOT NULL AND stale_since <= ?`,
  ).run(now, now - STALE_MAX_MS);
}

// The promotion reminder rides here rather than in its own scheduler: it is
// the same shape as the deal timeout above — a record that has sat in one
// state for 24 hours — and one sweeper is easier to reason about than two.
//
// Kept OUT of tick() because it is async and tick() is deliberately
// synchronous: awaiting a push inside it would let the 30-second interval
// stack a second run on top of a slow first one.
let nudging = false;
async function nudgeTick() {
  if (nudging) return;
  nudging = true;
  try { await nudgeStalePromotions(); } catch (e) {
    console.error('[expirer] promotion nudge failed', e?.message);
  } finally { nudging = false; }
}

export function startExpirer() {
  // Run once on boot so a long-offline server doesn't wait 30s before
  // catching up on its backlog.
  try { tick(); } catch (e) { console.error('[expirer] initial tick failed', e); }
  setInterval(() => {
    try { tick(); } catch (e) { console.error('[expirer] tick failed', e); }
  }, 30 * 1000);

  // Every 15 minutes, not every 30 seconds: the threshold is a day, so
  // quarter-hour granularity is already far finer than the question needs,
  // and each pass may send push notifications.
  const summaryTick = () => { try { sendSellerSummaries(); } catch(e) { console.error('[retention] summary failed', e?.message); } };
  setTimeout(summaryTick, 90 * 1000);
  setInterval(summaryTick, 60 * 60 * 1000);
  setTimeout(nudgeTick, 60 * 1000);
  setInterval(nudgeTick, 15 * 60 * 1000);
}
