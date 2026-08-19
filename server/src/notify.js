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

function deliver(userId, kind, payload, push) {
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

export function notify(userId, kind, payload, push) {
  deliver(userId, kind, payload, push);
  // Shop delegation: a shop operated from a personal account forwards every
  // notification to that account, each as the manager's OWN row — their app
  // polls their own inbox, not the shop's. The shop row keeps its copy too,
  // so removing a manager later loses nothing. Self-guard covers a row
  // pointing at itself; a manager chatting with their own shop as a buyer
  // will see a self-echo, which is harmless and only affects test chats.
  const row = db.prepare('SELECT shop_manager_id FROM users WHERE id=?').get(userId);
  const managerId = row?.shop_manager_id;
  if (managerId && managerId !== userId) deliver(managerId, kind, payload, push);
}

// ─── shop review ──────────────────────────────────────────────────────
//
// Tell a shop owner where his review stands, on whatever build he happens
// to be running.
//
// The inbox row is VERSION GATED. The notifications screen renders
// `KIND_LABEL[kind] || kind`, so a build that predates these kinds shows the
// literal string "shop.review.approved" in the user's inbox — precisely the
// bug the UI audit caught with order.placed. Every shop owner is on 0.2.1
// today, so without this gate the first thing the review system would ship
// is a screenful of raw keys.
//
// The PUSH always goes, because its title and body are server text and
// render correctly on any build. For the current population it is the only
// channel that works, which is why callers put the whole message in it
// rather than a "open the app to see" teaser.
const REVIEW_UI_MIN_VERSION = '0.3.0';

/** "0.2.1" <= "0.3.0". Missing/unparseable sorts as oldest. */
export function versionAtLeast(v, min) {
  if (!v) return false;
  const a = String(v).split('.').map((x) => parseInt(x, 10) || 0);
  const b = String(min).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return true;
}

export function notifyShopReview(shopId, status, title, body) {
  const seen = db.prepare(
    `SELECT app_version FROM user_active_days
      WHERE user_id=? ORDER BY day DESC LIMIT 1`,
  ).get(shopId)?.app_version;

  if (versionAtLeast(seen, REVIEW_UI_MIN_VERSION)) {
    // New enough to label the row and open the thread.
    notify(shopId, `shop.review.${status}`, { status }, { title, body });
    return;
  }
  // Older build: push only. deliver() would also write the inbox row, so go
  // straight to the push layer instead.
  pushTo([shopId], title, body, { kind: `shop.review.${status}` })
    .catch(() => { /* best-effort */ });
}
