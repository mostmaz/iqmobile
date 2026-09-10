// Smart Boost — where a boost should put a listing, given where it already is.
//
// The problem this solves: a seller posts a phone, sees it at the top, and
// immediately watches an ad to "boost" it. Bumping it from rank 2 to rank 1
// spends the reward on nothing, and the seller learns the feature is
// worthless. So a listing already near the top gets the visual treatment now
// and its bump LATER, when the treatment ends and it has drifted down. Same
// reward, delivered where it is worth something.
//
// Pure. `listingRankPosition` takes `db` and returns a number; `decideBoost`
// takes that number and returns timestamps. Neither reads the clock.

const HOUR = 3600000;

/**
 * How many live listings sit above this one in the default feed. 0 = top.
 *
 * One COUNT against the expression index (idx_listings_rank), not an ORDER BY
 * over the table — the feed is ~3,000 rows today and this runs on every boost
 * attempt, so it must not become a sort. The filter mirrors the browse
 * route's own `available_only` clause: a boost competes with what a buyer can
 * actually buy, and counting sold and expired rows as "above" you would
 * inflate every rank and push every listing into the immediate-bump branch.
 */
export function listingRankPosition(db, listingId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS ahead
         FROM phone_listings l
        WHERE l.status IN ('active','reserved')
          AND COALESCE(l.is_draft,0) = 0
          AND COALESCE(l.stale_since, 0) = 0
          AND COALESCE(l.bumped_at, l.created_at) >
              (SELECT COALESCE(bumped_at, created_at) FROM phone_listings WHERE id=?)`,
    )
    .get(listingId);
  return Number(row?.ahead ?? 0);
}

/**
 * @returns `{ type, bumpedAt, highlightUntil, scheduledBumpAt }` — `bumpedAt`
 *          null means "do not touch the ranking timestamp yet".
 */
export function decideBoost(rank, cfg, now) {
  const highlightUntil = now + cfg.highlightHours * HOUR;

  // Already near the top: highlight now, bump when the highlight ends.
  if (rank < cfg.topThreshold) {
    return {
      type: 'delayed_bump',
      bumpedAt: null,
      highlightUntil,
      scheduledBumpAt: highlightUntil,
    };
  }

  // Fallen down the feed: the bump is the whole point, so do it now and
  // schedule nothing. A second bump four hours later would be a second
  // reward for one ad.
  return {
    type: 'immediate_bump',
    bumpedAt: now,
    highlightUntil,
    scheduledBumpAt: null,
  };
}
