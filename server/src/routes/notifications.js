import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const r = Router();

// Enrich a notifications row with the counterparty display name + the
// listing brand/model when the payload carries a chat_id (or
// listing_id). This is what the in-app Notifications screen renders
// underneath the kind label — without it the row reads as just
// "رسالة جديدة" with a timestamp and no indication who or what it was.
//
// Two DB hops per row that has a chat_id (chat → listing). Notifications
// list is capped at 100 rows so the worst-case is 200 indexed lookups —
// SQLite handles this in well under a millisecond. If this ever becomes
// a hotspot, batch the lookups with `WHERE id IN (...)` instead.
function enrich(row, viewerId) {
  const payload = row.payload || {};
  let chat_summary = null;
  let listing_summary = null;

  if (payload.chat_id) {
    const chat = db.prepare('SELECT buyer_id, seller_id, listing_id FROM chats WHERE id=?').get(payload.chat_id);
    if (chat) {
      const otherId = viewerId === chat.buyer_id ? chat.seller_id : chat.buyer_id;
      const other = db.prepare('SELECT display_name FROM users WHERE id=?').get(otherId);
      const listing = db.prepare('SELECT brand, model FROM phone_listings WHERE id=?').get(chat.listing_id);
      chat_summary = {
        chat_id: payload.chat_id,
        other_name: other?.display_name || null,
        listing_label: listing ? `${listing.brand} ${listing.model}` : null,
      };
    }
  }

  // Some notification kinds (e.g. listing.expired, rating.received) ship
  // a listing_id directly without a chat_id — surface the brand/model
  // for those too so the row is still readable.
  if (!chat_summary && payload.listing_id) {
    const listing = db.prepare('SELECT brand, model FROM phone_listings WHERE id=?').get(payload.listing_id);
    if (listing) listing_summary = { brand: listing.brand, model: listing.model };
  }

  return { ...row, chat_summary, listing_summary };
}

r.get('/', requireAuth(), (req, res) => {
  const rows = db.prepare(
    'SELECT id, kind, payload_json, read, created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
  ).all(req.user.id);
  const parsed = rows.map((row) => ({
    ...row,
    payload: JSON.parse(row.payload_json || '{}'),
    read: !!row.read,
  }));
  res.json(parsed.map((row) => enrich(row, req.user.id)));
});

r.post('/read-all', requireAuth(), (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=? AND read=0').run(req.user.id);
  res.json({ ok: true });
});

r.post('/:id(\\d+)/read', requireAuth(), (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default r;
