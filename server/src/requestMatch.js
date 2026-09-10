// Does this listing answer that request?
//
// The rule lived inline in two places that have to agree: the push a seller
// gets when their new listing answers an open request, and the list the app
// shows them on the post-publish screen. If those two ever disagree, the
// seller is told "a buyer wants this" by a notification and then shown an
// empty screen when they tap it — so the rule lives here, once.
//
// Deliberately NOT a "score". A request states a brand, a model and a
// ceiling; a listing either satisfies those or it does not. Ranking near
// misses would put the seller in front of buyers who asked for something
// else, which is how a board full of ignored offers starts.

/** Same slack the outgoing broadcast uses — see phoneRequests.js. */
export const CEILING_SLACK = 1.2;

/**
 * Open requests that this listing answers, newest first.
 *
 * @param db
 * @param listing  `{ id, seller_id, brand, model, asking_price, governorate,
 *                  status, is_draft }`
 * @param norm     the shared model normalizer (savedSearches.norm), passed
 *                 in rather than imported so this module stays free of the
 *                 route layer.
 * @param opts.now
 * @param opts.sameGovernorateOnly
 *   The post-publish screen sets this. A request is a lead there only if the
 *   buyer is somewhere the seller can actually meet them — the screen's
 *   whole promise is "these people are near you and want this today".
 *   The push does NOT set it: a notification costs the buyer nothing and a
 *   phone worth travelling for is the seller's call, not ours.
 * @param opts.limit
 */
export function requestsAnsweredBy(db, listing, norm, {
  now = Date.now(), sameGovernorateOnly = false, limit = 20,
} = {}) {
  if (!listing || listing.status !== 'active' || listing.is_draft) return [];
  const price = Number(listing.asking_price);
  // A call-for-price listing carries the sentinel asking_price = 1. Compared
  // against a ceiling it satisfies EVERY request ever written, which would
  // hand the seller the whole board.
  if (!Number.isFinite(price) || price <= 1) return [];

  const params = [now, listing.brand, CEILING_SLACK, price];
  let sql = `SELECT * FROM phone_requests
              WHERE status='open' AND expires_at > ?
                AND brand=? AND (max_price * ?) >= ?`;
  if (sameGovernorateOnly) { sql += ' AND governorate=?'; params.push(listing.governorate); }
  sql += ' ORDER BY created_at DESC LIMIT 200';

  const wanted = norm(listing.model);
  const out = [];
  for (const request of db.prepare(sql).all(...params)) {
    // Never sell to yourself.
    if (request.buyer_id === listing.seller_id) continue;
    // The model comparison is the fold, not the raw string: "iPhone 13" and
    // "ايفون ١٣" are the same phone, and "iPhone 13 Pro Max" is not.
    if (norm(request.model) !== wanted) continue;
    out.push({
      ...request,
      // Say the gap out loud rather than hiding it. A seller who opens this
      // expecting a clean match and finds their price is over the buyer's
      // ceiling learns we wasted their time; one who is told can decide to
      // negotiate.
      above_budget: price > Number(request.max_price),
    });
    if (out.length >= limit) break;
  }
  return out;
}
