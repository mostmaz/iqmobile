import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { notify } from '../notify.js';

const r = Router();

const UP = path.resolve('./uploads');
fs.mkdirSync(UP, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 6) || '.jpg';
    cb(null, 'msg_' + crypto.randomBytes(12).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('not_image'));
    cb(null, true);
  },
});

const QUICK_MESSAGES = [
  'هل المنتج متوفر؟',
  'ما هو سعرك النهائي؟',
  'هل يمكنني فحص الجهاز؟',
  'أين الموقع؟',
];
r.get('/quick-messages', requireAuth(), (_req, res) => res.json(QUICK_MESSAGES));

// Buyer opens (or reuses) a chat for a listing.
r.post('/listings/:id(\\d+)/chat', requireAuth(), (req, res) => {
  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(req.params.id);
  if (!listing || listing.status === 'removed') return res.status(404).json({ error: 'not_found' });
  if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'cannot_chat_self' });

  let row = db.prepare('SELECT * FROM chats WHERE listing_id=? AND buyer_id=?').get(listing.id, req.user.id);
  if (!row) {
    const t = now();
    const ins = db.prepare(
      'INSERT INTO chats(listing_id, buyer_id, seller_id, created_at, last_message_at) VALUES(?,?,?,?,?)',
    ).run(listing.id, req.user.id, listing.seller_id, t, t);
    row = db.prepare('SELECT * FROM chats WHERE id=?').get(ins.lastInsertRowid);
  }
  res.json(row);
});

function loadChatForUser(req, res) {
  const row = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!row) { res.status(404).json({ error: 'not_found' }); return null; }
  if (row.buyer_id !== req.user.id && row.seller_id !== req.user.id) {
    res.status(403).json({ error: 'forbidden' }); return null;
  }
  return row;
}

function activeDealFor(chatId) {
  return db
    .prepare(
      `SELECT * FROM deals WHERE chat_id=? AND status IN ('proposed','buyer_accepted','seller_confirmed')
       ORDER BY id DESC LIMIT 1`,
    )
    .get(chatId);
}

// Augment a chat row with the listing summary, counterparty info, and the
// active deal — clients render the chat header from this.
function enrichChat(chat, viewerId) {
  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(chat.listing_id);
  const buyer = db.prepare('SELECT id, display_name, profile_image_path, rating_avg, rating_count, verified, seller_type FROM users WHERE id=?').get(chat.buyer_id);
  const seller = db.prepare('SELECT id, display_name, profile_image_path, rating_avg, rating_count, verified, seller_type, shop_years, phone FROM users WHERE id=?').get(chat.seller_id);
  const deal = activeDealFor(chat.id);
  const phoneVisible = !!deal && deal.status === 'seller_confirmed';
  return {
    ...chat,
    role: viewerId === chat.buyer_id ? 'buyer' : 'seller',
    listing: listing
      ? {
          id: listing.id, brand: listing.brand, model: listing.model,
          asking_price: listing.asking_price, status: listing.status,
          governorate: listing.governorate, city: listing.city,
        }
      : null,
    buyer: buyer ? { ...buyer, verified: !!buyer.verified } : null,
    seller: seller
      ? {
          id: seller.id,
          display_name: seller.display_name,
          profile_image_path: seller.profile_image_path,
          rating_avg: seller.rating_avg,
          rating_count: seller.rating_count,
          verified: !!seller.verified,
          seller_type: seller.seller_type || 'individual',
          shop_years: seller.shop_years,
          phone: phoneVisible ? seller.phone : null,
        }
      : null,
    active_deal: deal || null,
    phone_visible: phoneVisible,
  };
}

// List my chats.
r.get('/chats', requireAuth(), (req, res) => {
  const role = req.query.role; // 'buyer' | 'seller' | undefined
  let sql = 'SELECT * FROM chats WHERE (buyer_id=? OR seller_id=?)';
  const params = [req.user.id, req.user.id];
  if (role === 'buyer') { sql = 'SELECT * FROM chats WHERE buyer_id=?'; params.length = 0; params.push(req.user.id); }
  else if (role === 'seller') { sql = 'SELECT * FROM chats WHERE seller_id=?'; params.length = 0; params.push(req.user.id); }
  sql += ' ORDER BY last_message_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((row) => enrichChat(row, req.user.id)));
});

// Single chat detail.
r.get('/chats/:id(\\d+)', requireAuth(), (req, res) => {
  const row = loadChatForUser(req, res);
  if (!row) return;
  res.json(enrichChat(row, req.user.id));
});

// List messages.
r.get('/chats/:id(\\d+)/messages', requireAuth(), (req, res) => {
  const chat = loadChatForUser(req, res);
  if (!chat) return;
  const rows = db.prepare(
    `SELECT m.id, m.chat_id, m.sender_id, m.body, m.image_path, m.masked, m.created_at,
            u.display_name AS sender_name
     FROM chat_messages m JOIN users u ON u.id = m.sender_id
     WHERE m.chat_id=? ORDER BY m.created_at ASC LIMIT 500`,
  ).all(chat.id);
  res.json(rows);
});

// Send a message — text and/or image. Phone numbers are blocked unless the
// chat already has a confirmed deal.
r.post('/chats/:id(\\d+)/messages', requireAuth(), upload.single('image'), (req, res) => {
  const chat = loadChatForUser(req, res);
  if (!chat) return;

  let body = (req.body?.body || '').toString().slice(0, 2000) || null;
  if (req.file && req.file.size <= 0) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'empty_image' });
  }
  const image_path = req.file ? `/uploads/${req.file.filename}` : null;
  if (!body && !image_path) return res.status(400).json({ error: 'empty_message' });

  // Phone numbers in chat are public now — listings expose contact_phone
  // directly, so masking adds no protection. We still write `masked: 0`
  // for schema compatibility with the existing column.
  const masked = 0;

  const t = now();
  const ins = db.prepare(
    'INSERT INTO chat_messages(chat_id, sender_id, body, image_path, masked, created_at) VALUES(?,?,?,?,?,?)',
  ).run(chat.id, req.user.id, body, image_path, masked, t);
  db.prepare('UPDATE chats SET last_message_at=? WHERE id=?').run(t, chat.id);

  const msg = db.prepare(
    `SELECT m.id, m.chat_id, m.sender_id, m.body, m.image_path, m.masked, m.created_at,
            u.display_name AS sender_name
     FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id=?`,
  ).get(ins.lastInsertRowid);

  const otherId = req.user.id === chat.buyer_id ? chat.seller_id : chat.buyer_id;
  notify(otherId, 'chat.message', { chat_id: chat.id, message: msg }, {
    title: 'رسالة جديدة',
    body: body ? body.slice(0, 80) : '📷 صورة',
  });
  // echo to sender's other devices via SSE
  // (no notification row for the sender itself)
  // emitTo done by notify only on otherId; sender already has the response.

  res.json({ ...msg, blocked: !!masked });
});

// Inbox poll for the global notification banner.
r.get('/messages/inbox', requireAuth(), (req, res) => {
  const since = Number(req.query.since) || 0;
  const rows = db.prepare(`
    SELECT m.id, m.chat_id, m.sender_id, m.body, m.image_path, m.masked, m.created_at,
           u.display_name AS sender_name
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    JOIN chats c ON c.id = m.chat_id
    WHERE m.created_at > ?
      AND m.sender_id != ?
      AND (c.buyer_id = ? OR c.seller_id = ?)
    ORDER BY m.created_at DESC LIMIT 20
  `).all(since, req.user.id, req.user.id, req.user.id);
  res.json(rows);
});

export default r;
