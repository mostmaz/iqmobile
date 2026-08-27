import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { uploadLimiter } from '../limits.js';
import { notify } from '../notify.js';
import { pushToAdmins } from '../adminPush.js';

const r = Router();

const UP = path.resolve('./uploads');
fs.mkdirSync(UP, { recursive: true });

// Same image hygiene as routes/listings.js — see the long comment there.
// Blocks the SVG-mimetype-renamed-to-image/jpeg → stored XSS path.
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
function pickSafeExt(originalname, mimetype) {
  const ext = (path.extname(originalname || '') || '').toLowerCase();
  if (ALLOWED_IMAGE_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    const ext = pickSafeExt(file.originalname, file.mimetype);
    cb(null, 'msg_' + crypto.randomBytes(12).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) return cb(new Error('not_image'));
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (ext && !ALLOWED_IMAGE_EXT.has(ext)) return cb(new Error('not_image'));
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
// Guests are now allowed to chat — the previous `rejectGuest` gate was
// removed because forcing buyers through AuthGate before they could even
// ask "is it available?" added too much friction. Guests have a real
// user row (auto-provisioned at app launch), so chats they start are
// tied to that row; when they later upgrade via phoneLogin → the same
// row is promoted in-place and their existing chats carry over.
r.post('/listings/:id(\\d+)/chat', requireAuth(), (req, res) => {
  // Spec §9 data & privacy: a shop that blocked this buyer stops receiving
  // new threads from them, and no buyer may open more than 20 threads a
  // day — the cheap way to spam every shop in a governorate.
  {
    const target = db.prepare('SELECT seller_id FROM phone_listings WHERE id=?').get(req.params.id);
    if (target) {
      const blocked = db.prepare('SELECT 1 FROM chat_blocks WHERE shop_id=? AND buyer_id=?')
        .get(target.seller_id, req.user.id);
      if (blocked) return res.status(403).json({ error: 'blocked_by_shop' });
    }
    const dayAgo = Date.now() - 86400000;
    const opened = db.prepare('SELECT COUNT(*) AS n FROM chats WHERE buyer_id=? AND created_at > ?')
      .get(req.user.id, dayAgo).n;
    if (opened >= 20) return res.status(429).json({ error: 'too_many_threads' });
  }

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

// Shops this user operates from their personal account (users.shop_manager_id
// points from the shop row at the manager). Nearly always empty; the price
// aggregator shop is the reason it exists — its own login is never signed in,
// so its chats have to surface in the operator's account instead.
function managedShopIds(userId) {
  return db.prepare('SELECT id FROM users WHERE shop_manager_id=?')
    .all(userId).map((r) => r.id);
}

// Is this user a party to the chat? Buyer, seller, or manager of the selling
// shop. All chat access goes through this one predicate.
function isChatMember(chat, userId) {
  if (chat.buyer_id === userId || chat.seller_id === userId) return true;
  return managedShopIds(userId).includes(chat.seller_id);
}

function loadChatForUser(req, res) {
  const row = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!row) { res.status(404).json({ error: 'not_found' }); return null; }
  if (!isChatMember(row, req.user.id)) {
    res.status(403).json({ error: 'forbidden' }); return null;
  }
  return row;
}

// Middleware version of the chat ownership check — runs BEFORE multer so
// a non-participant can't fill our disk by spamming POSTs to chat IDs
// they don't own (multer was happily writing 5MB files to ./uploads
// before the auth check ran). Caches the loaded row on req.chat so
// the handler doesn't redo the SELECT.
function chatGuard(req, res, next) {
  const row = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (!isChatMember(row, req.user.id)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.chat = row;
  next();
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
  const isBuyer = viewerId === chat.buyer_id;

  // The list showed only a pseudonym and a listing — no preview, no time,
  // no unread state — so two threads with the same guest name were
  // indistinguishable. All three come from data we already store.
  const last = db.prepare(
    `SELECT sender_id, body, image_path, created_at FROM chat_messages
      WHERE chat_id=? ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(chat.id);
  const since = (isBuyer ? chat.buyer_last_read_at : chat.seller_last_read_at) || 0;
  const unread = db.prepare(
    `SELECT COUNT(*) AS n FROM chat_messages
      WHERE chat_id=? AND created_at > ? AND sender_id != ?`,
  ).get(chat.id, since, viewerId).n;

  return {
    ...chat,
    role: isBuyer ? 'buyer' : 'seller',
    last_message: last
      ? {
          // Body is truncated server-side: the list renders one line and
          // there is no reason to ship a 2,000-character message for it.
          preview: last.body ? String(last.body).slice(0, 120) : (last.image_path ? '📷 صورة' : ''),
          created_at: last.created_at,
          mine: last.sender_id === viewerId,
        }
      : null,
    unread_count: unread,
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
// Optional ?listing_id=N filter narrows the result to chats for a single
// listing — used by sellers viewing "incoming buyer chats for THIS
// listing" from the listing detail screen. The user's role is still
// enforced by the buyer_id/seller_id filter so a buyer querying their
// OWN listing_id only sees their side of it.
r.get('/chats', requireAuth(), (req, res) => {
  const role = req.query.role; // 'buyer' | 'seller' | undefined
  const listingId = Number(req.query.listing_id);
  // The seller side includes shops this user manages, so the price shop's
  // buyer chats appear in the operator's own chat list with no app change.
  const sellerIds = [req.user.id, ...managedShopIds(req.user.id)];
  const sellerIn = `seller_id IN (${sellerIds.map(() => '?').join(',')})`;
  let sql = `SELECT * FROM chats WHERE (buyer_id=? OR ${sellerIn})`;
  const params = [req.user.id, ...sellerIds];
  if (role === 'buyer') { sql = 'SELECT * FROM chats WHERE buyer_id=?'; params.length = 0; params.push(req.user.id); }
  else if (role === 'seller') { sql = `SELECT * FROM chats WHERE ${sellerIn}`; params.length = 0; params.push(...sellerIds); }
  if (Number.isInteger(listingId) && listingId > 0) {
    sql += ' AND listing_id=?';
    params.push(listingId);
  }
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

  // Opening the thread IS reading it. Stamped on whichever side the viewer
  // is, so the other party's unread count is unaffected.
  const col = req.user.id === chat.buyer_id ? 'buyer_last_read_at' : 'seller_last_read_at';
  db.prepare(`UPDATE chats SET ${col}=? WHERE id=?`).run(Date.now(), chat.id);

  res.json(rows);
});

// Send a message — text and/or image. Phone numbers are blocked unless the
// chat already has a confirmed deal.
// chatGuard runs BEFORE multer so unauthorized callers never write a file.
// (Guest-block middleware removed — guests can now send chat messages;
// see the rationale on POST /listings/:id/chat above.)
r.post('/chats/:id(\\d+)/messages', requireAuth(), uploadLimiter, chatGuard, upload.single('image'), (req, res) => {
  const chat = req.chat;

  // Trim THEN cap so a 2000-char run of spaces doesn't sneak past the
  // empty-message check below. `.slice(0, 2000) || null` previously
  // accepted "                 " (all whitespace) — visible only as an
  // empty bubble on both sides, useful only for spam-bumping the chat.
  const rawBody = (req.body?.body || '').toString().trim().slice(0, 2000);
  const body = rawBody || null;
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

  // A buyer writing to the STOREFRONT is a sales lead, and the storefront's
  // own login is never signed in — its chats are read from the operator app.
  // Wake the operators the same way an order does. Buyer-side only: the
  // operator replying to himself is not news.
  if (otherId === chat.seller_id) {
    // The storefront AND the hidden price book — both are answered from the
    // operator app, neither login is ever signed in.
    const isStorefront = db.prepare(
      `SELECT 1 FROM users WHERE id=? AND seller_type='shop'
        AND (COALESCE(shop_orders_enabled,0)=1 OR COALESCE(shop_hidden,0)=1)`,
    ).get(chat.seller_id);
    if (isStorefront) {
      pushToAdmins('store.chat', 'رسالة لمتجر iQ Mobile 💬',
        body ? body.slice(0, 120) : '📷 صورة',
        { screen: 'store_chats', chat_id: chat.id },
      ).catch(() => { /* best-effort */ });
    }
  }
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
      AND (c.buyer_id = ? OR c.seller_id IN (SELECT ? UNION SELECT id FROM users WHERE shop_manager_id=?))
    ORDER BY m.created_at DESC LIMIT 20
  `).all(since, req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(rows);
});

export default r;
