import { db, now } from './db.js';
import { emitTo } from './sse.js';
import { pushTo } from './push.js';

// Persist a notification + emit live SSE + send a push, in one place.
//   kind: 'chat.message' | 'deal.proposed' | 'deal.buyer_accepted'
//       | 'deal.seller_confirmed' | 'phone.unlocked' | 'rating.reminder'
//       | 'listing.expired'
export function notify(userId, kind, payload, push) {
  db.prepare(
    'INSERT INTO notifications(user_id, kind, payload_json, read, created_at) VALUES(?,?,?,?,?)',
  ).run(userId, kind, JSON.stringify(payload || {}), 0, now());
  emitTo(userId, kind, payload || {});
  if (push) pushTo([userId], push.title, push.body, { kind, ...(payload || {}) });
}
