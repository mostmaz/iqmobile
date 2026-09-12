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

// A seller holding the exact device, priced a little over the buyer's
// ceiling, is still the best lead this request has — a stated budget is an
// opening position, not a wall, and "800k when he asked for ≤700k" is a
// conversation. Below the ceiling stays the clean match; up to 20% above it
// gets the same alert, flagged so the copy can say so rather than pretend
// the price fits. Past that the two of them genuinely want different things.
//
// Both directions of the match below use it, and so does the dashboard's
// supply count — one slack, or the console reports matches the broadcast
// never sent.
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

/**
 * The same rule read from the other end: listings that satisfy THIS request.
 *
 * `requestsAnsweredBy` above asks "which buyers wanted this phone" and is
 * driven by a new listing. This asks "who is already selling what this buyer
 * asked for" and is driven by a request. The broadcast needs it to find the
 * sellers worth telling first; the dashboard needs it to say whether a
 * request went unanswered because nobody has the phone, or because the
 * sellers who do have it ignored it. Those are opposite problems and the
 * operator can only tell them apart if both ends use one rule.
 *
 * `reserved` counts as supply, unlike `requestsAnsweredBy` (which runs on the
 * seller's own freshly-published listing and so only ever sees `active`): a
 * reserved phone is a deal that has not closed, and its seller is still a
 * lead worth showing.
 *
 * @param db
 * @param request `{ id, buyer_id, brand, model, max_price }`
 * @param norm    the shared model normalizer (savedSearches.norm)
 * @param opts.limit  cap on rows returned — counting callers pass Infinity
 * @returns rows ordered cheapest first, each carrying `above_budget` (over
 *          the buyer's stated ceiling but inside the slack) and
 *          `call_for_price` (the `asking_price = 1` sentinel — a real device,
 *          but never a price reference).
 */
export function listingsAnsweringRequest(db, request, norm, { limit = 50 } = {}) {
  if (!request || !request.brand) return [];
  const ceiling = Math.round(Number(request.max_price) * CEILING_SLACK);
  if (!Number.isFinite(ceiling)) return [];

  const rows = db.prepare(
    `SELECT l.id, l.seller_id, l.brand, l.model, l.storage, l.color, l.condition,
            l.asking_price, l.governorate, l.status, l.created_at
       FROM phone_listings l
      WHERE l.brand=? AND l.asking_price<=? AND l.status IN ('active','reserved')
        AND COALESCE(l.is_draft,0)=0
      ORDER BY l.asking_price ASC`,
  ).all(request.brand, ceiling);

  const wanted = norm(request.model);
  const out = [];
  for (const row of rows) {
    // Never sell to yourself — the buyer's own listing is not supply.
    if (row.seller_id === request.buyer_id) continue;
    if (norm(row.model) !== wanted) continue;
    out.push({
      ...row,
      above_budget: row.asking_price > Number(request.max_price),
      call_for_price: Number(row.asking_price) <= 1,
    });
    if (out.length >= limit) break;
  }
  return out;
}
