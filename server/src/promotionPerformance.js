// What happened while a listing was promoted — and, more importantly, what
// that does and does not tell you.
//
// The window is derivable but not from the listing. There is no
// `featured_from`, and `boosted_at` is re-stamped on every boost so it marks
// the last bump rather than the start. `feature_requests.reviewed_at` of the
// approved row is stamped in the same tick as applyFeature(), which makes it
// the real start — and it is already on the client via GET /features/mine.
//
// ── The honesty problem, which is the whole point of this module ──────
//
// The default feed is `ORDER BY (stale_since IS NOT NULL) ASC, created_at
// DESC`. A listing's view rate therefore DECAYS with age no matter what the
// seller does. Comparing "the week after" against "the week before" will
// usually look like a win for promotion even when the promotion did nothing,
// and would look like a win for a listing that was never promoted at all.
//
// So this reports what happened DURING a window. It never subtracts, never
// computes a lift, and never says "because". The label is the deliverable:
// a seller who is told a true number and a fair caveat can decide for
// themselves; one who is told a fabricated lift will buy again once and never
// trust the screen after.

const DAY = 86400000;

/**
 * Views and contacts inside [from, to), excluding the seller's own.
 *
 * The exclusion is the same one sellerSummaries.js has always applied and
 * /listings/mine never did.
 */
export function windowStats(db, { listingId, sellerId, from, to }) {
  const row = db.prepare(
    `SELECT
       SUM(CASE WHEN type='view' THEN 1 ELSE 0 END) AS views,
       SUM(CASE WHEN type IN ('contact_call','contact_whatsapp') THEN 1 ELSE 0 END) AS contacts
     FROM events
     WHERE listing_id=? AND created_at >= ? AND created_at < ?
       AND (user_id IS NULL OR user_id <> ?)`,
  ).get(listingId, from, to, sellerId);
  return { views: row?.views || 0, contacts: row?.contacts || 0 };
}

/**
 * The promotion window for a listing, or null.
 *
 * A listing can carry several stacked approved requests. FeatureListingScreen
 * uses `.find()` and takes the first, which is exact for ONE request and wrong
 * for a run of them — so take MIN(reviewed_at) over the contiguous approved
 * run and report the whole promoted period rather than its last segment.
 */
export function promotionWindow(db, listingId, nowTs = Date.now()) {
  const row = db.prepare(
    `SELECT MIN(reviewed_at) AS started FROM feature_requests
      WHERE listing_id=? AND status='approved' AND reviewed_at IS NOT NULL`,
  ).get(listingId);
  if (!row?.started) return null;
  const listing = db.prepare(
    'SELECT featured_until FROM phone_listings WHERE id=?',
  ).get(listingId);
  const until = listing?.featured_until || null;
  if (!until) return null;
  return { from: row.started, to: Math.min(until, nowTs), until, active: until > nowTs };
}

/**
 * What to show a seller about a promotion.
 *
 * Returns `during` and — only when there is a comparable stretch of the same
 * length before it — `before`. `before` is provided for context, explicitly
 * NOT as a baseline the promotion beat: `caveats` carries the reasons, and
 * the client is expected to print them.
 */
export function promotionPerformance(db, listing, nowTs = Date.now()) {
  const w = promotionWindow(db, listing.id, nowTs);
  if (!w) return null;

  // A window shorter than a day has nothing stable to report; hours of data
  // read as noise and invite exactly the over-reading this module avoids.
  const elapsed = w.to - w.from;
  if (elapsed < DAY) return { pending: true, from: w.from, until: w.until, active: w.active };

  const during = windowStats(db, {
    listingId: listing.id, sellerId: listing.seller_id, from: w.from, to: w.to,
  });

  // Only when the listing existed for a full comparable stretch beforehand.
  // Half a window compared against a whole one is not a comparison.
  const priorFrom = w.from - elapsed;
  const before = priorFrom >= listing.created_at
    ? windowStats(db, {
      listingId: listing.id, sellerId: listing.seller_id, from: priorFrom, to: w.from,
    })
    : null;

  const caveats = ['decay'];
  // saved_listings rows are DELETED on unsave, so saves during a window
  // undercount anyone who later changed their mind. Better to say so than to
  // print a number that quietly drifts down over time.
  caveats.push('saves_undercount');

  return {
    pending: false,
    from: w.from,
    until: w.until,
    active: w.active,
    days: Math.max(1, Math.round(elapsed / DAY)),
    during,
    before,
    caveats,
  };
}
