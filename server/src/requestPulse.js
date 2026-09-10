// «١٨ طلب بآخر ٢٤ ساعة · بغداد» — the one number the request feature shows
// about itself.
//
// It appears in three places that must agree: the badge on the الطلبات tab,
// the line under the feed's title, and the invite card's "let N shops see
// it". A badge saying 18 above a feed saying 12 is worse than no badge, so
// all three read this module.
//
// Deliberately NOT personalised by taste. The count is "requests posted near
// you", identical for a buyer and a shop, because the design's whole claim is
// that it measures the city's demand rather than your own history. The only
// per-viewer part is `since` — what you have already looked at.

/** The window every count in here is measured over. */
export const PULSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * @param db
 * @param opts.governorate  canonical English name, or null for the whole country
 * @param opts.since        ms timestamp of the viewer's last visit to the feed
 * @param opts.now
 * @param opts.maxReach     the broadcast cap — see MAX_BROADCAST
 */
export function requestPulse(db, { governorate = null, since = 0, now = Date.now(), maxReach = 40 } = {}) {
  const from = now - PULSE_WINDOW_MS;
  const gov = governorate || null;

  // `expires_at > now` rather than `status='open'`: the expirer is a lazy
  // sweep, so a request whose window has passed can still be sitting at
  // 'open'. Counting it would put a badge on something the feed will not show.
  const where = `status='open' AND expires_at > ? AND created_at > ?${gov ? ' AND governorate=?' : ''}`;
  const args = (extraFrom) => (gov ? [now, extraFrom, gov] : [now, extraFrom]);

  const count24h = db.prepare(`SELECT COUNT(*) AS n FROM phone_requests WHERE ${where}`)
    .get(...args(from)).n;

  // Clamped INTO the window on purpose. A client that has never opened the
  // feed sends since=0, and without the clamp the badge would promise more
  // than the feed's own headline — the two numbers have to be reconcilable.
  const seenFrom = Math.max(from, Number(since) || 0);
  const countNew = db.prepare(`SELECT COUNT(*) AS n FROM phone_requests WHERE ${where}`)
    .get(...args(seenFrom)).n;

  return { count_24h: count24h, count_new: countNew, governorate: gov, seller_reach: sellerReach(db, gov, maxReach) };
}

/**
 * How many shops a request posted from here is GUARANTEED to reach.
 *
 * Shops only, and only in this governorate. An individual reaches the
 * broadcast by having sold the brand, and a distant shop by the same — but
 * the brand is not chosen yet when this number is shown, so counting either
 * would be a guess. A shop in your governorate qualifies on location alone,
 * which makes this a floor rather than an estimate: the real broadcast is
 * this many or more.
 *
 * Capped at the broadcast cap for the same reason. Telling a buyer 124 shops
 * will see it when the push stops at 40 is the kind of copy
 * HowFeaturingWorks.tsx exists to apologise for.
 */
function sellerReach(db, governorate, maxReach) {
  if (!governorate) return 0;
  const n = db.prepare(
    `SELECT COUNT(*) AS n FROM users
      WHERE COALESCE(is_guest,0)=0
        AND seller_type='shop'
        AND governorate=?
        -- The same four guards sellersToBroadcast uses. A hidden,
        -- unapproved, contactless or admin-created shop answers nobody.
        AND COALESCE(shop_hidden,0)=0
        AND COALESCE(shop_status,'approved')='approved'
        AND COALESCE(shop_no_contact,0)=0
        AND COALESCE(shop_origin,'') <> 'admin'`,
  ).get(governorate).n;
  return Math.min(n, maxReach);
}
