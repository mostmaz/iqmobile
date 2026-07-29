import { db, now } from './db.js';
import { emitTo } from './sse.js';
import { pushTo } from './push.js';

// Persist a notification + emit live SSE + send a push, in one place.
//   kind: 'chat.message' | 'deal.proposed' | 'deal.buyer_accepted'
//       | 'deal.seller_confirmed' | 'phone.unlocked' | 'rating.reminder'
//       | 'listing.expired'
// Has this user already received a notification of this kind about this
// listing? Used by the price-drop alert paths to make alerts once-per-
// listing: without it, a seller bouncing the price across someone's
// threshold (460→445→460→445…) would re-alert on every downward crossing.
// Matches on the JSON text of the payload — our own serialization always
// renders listing_id as `"listing_id":N` followed by ',' or '}'.
export function hasNotified(userId, kind, listingId) {
  return !!db.prepare(
    `SELECT 1 FROM notifications
      WHERE user_id=? AND kind=? AND (payload_json LIKE ? OR payload_json LIKE ?)
      LIMIT 1`,
  ).get(userId, kind, `%"listing_id":${Number(listingId)},%`, `%"listing_id":${Number(listingId)}}%`);
}

export function notify(userId, kind, payload, push) {
  db.prepare(
    'INSERT INTO notifications(user_id, kind, payload_json, read, created_at) VALUES(?,?,?,?,?)',
  ).run(userId, kind, JSON.stringify(payload || {}), 0, now());
  emitTo(userId, kind, payload || {});
  if (push) {
    // pushTo is async and we deliberately don't await it (we want notify
    // to return immediately so the route handler can respond). But
    // letting the promise fire-and-forget creates an unhandled rejection
    // on push errors — fatal under Node ≥15's default
    // unhandledRejection=throw mode. Wrap with .catch so a single
    // failed push never takes the whole process down.
    pushTo([userId], push.title, push.body, { kind, ...(payload || {}) })
      .catch((err) => console.error('[notify] pushTo failed', err));
  }
}
