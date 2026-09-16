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
export function requestPulse(db, { governorate = null, since = 0, now = Date.now(), maxReach = 100 } = {}) {
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

  return { count_24h: count24h, count_new: countNew, governorate: gov, seller_reach: 0 };
}

// Recipient count depends on the selected device, condition, and budget.
// A governorate alone cannot guarantee any notification recipients.
