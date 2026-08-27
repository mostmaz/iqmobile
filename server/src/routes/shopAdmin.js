// Per-shop merchant panel API (dormant until the multi_shop_orders switch
// is on — login itself works regardless so credentials can be handed out
// ahead of the launch). Each shop gets its own username/password (set by
// the admin from the shops page); the token is scoped to that one shop and
// every query here filters by it. Deliberately small: see your orders,
// move them through the linear lifecycle, glance at your stock.

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, now, getSetting } from '../db.js';
import { authLimiter, uploadLimiter } from '../limits.js';
import { notify } from '../notify.js';
import { applyStatusToStock } from '../stock.js';
import { ORDER_STATUSES, ORDER_NEXT, orderStatusNotification } from '../orderFlow.js';
import { parseSheet, planImport, applyImport } from '../storeImport.js';

// Same upload conventions as the app: disk storage under ./uploads, image
// mime/ext allow-list, 5MB cap. lst_/shp_ prefixes match existing files.
const UP = path.resolve('./uploads');
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const imgStorage = (prefix) => multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    let ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) ext = '.jpg';
    if (ext === '.jpeg') ext = '.jpg';
    cb(null, prefix + crypto.randomBytes(12).toString('hex') + ext);
  },
});
const imgUpload = (prefix) => multer({
  storage: imgStorage(prefix),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('not_image'));
    cb(null, true);
  },
});
const listingImg = imgUpload('lst_');
const shopImg = imgUpload('shp_');
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const r = Router();
const SECRET = process.env.JWT_SECRET;

function requireShopAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  let payload = null;
  try { payload = token && jwt.verify(token, SECRET); } catch {}
  if (!payload || payload.kind !== 'shop_admin' || !payload.shop_id) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const shop = db.prepare(
    "SELECT * FROM users WHERE id=? AND seller_type='shop'",
  ).get(payload.shop_id);
  if (!shop) return res.status(401).json({ error: 'unauthorized' });
  req.shop = shop;
  next();
}

r.post('/shop-admin/login', authLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const shop = db.prepare(
    "SELECT * FROM users WHERE shop_dash_username=? AND seller_type='shop'",
  ).get(username);
  if (!shop || !shop.shop_dash_password_hash
      || !bcrypt.compareSync(password, shop.shop_dash_password_hash)) {
    return res.status(401).json({ error: 'bad_credentials' });
  }
  const token = jwt.sign({ shop_id: shop.id, kind: 'shop_admin' }, SECRET, { expiresIn: '7d' });
  res.json({
    token,
    shop: { id: shop.id, name: shop.shop_name || shop.display_name },
  });
});

r.get('/shop-admin/me', requireShopAdmin, (req, res) => {
  const u = req.shop;
  const counts = Object.fromEntries(ORDER_STATUSES.map((st) => [
    st,
    db.prepare('SELECT COUNT(*) AS n FROM orders WHERE shop_id=? AND status=?').get(u.id, st).n,
  ]));

  // ── "الشيفت" summary (design 1a): money reality + today's decisions ──
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const ds = dayStart.getTime();
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const delivered = one(
    'SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS t FROM orders WHERE shop_id=? AND delivered_at >= ?',
    u.id, ds,
  );
  const recorded = one(
    'SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS t FROM orders WHERE shop_id=? AND created_at >= ?',
    u.id, ds,
  );
  const cancelledToday = one(
    "SELECT COUNT(*) AS n FROM orders WHERE shop_id=? AND status='cancelled' AND updated_at >= ?",
    u.id, ds,
  );
  const inflight = one(
    "SELECT COUNT(*) AS n FROM orders WHERE shop_id=? AND status IN ('confirmed','shipped')",
    u.id,
  );

  // Oldest un-actioned order — the "اتصل بالأول" target.
  const oldestPending = one(
    `SELECT id, code, customer_phone, governorate, created_at
       FROM orders WHERE shop_id=? AND status='pending'
       ORDER BY created_at ASC LIMIT 1`,
    u.id,
  );

  // Out of stock with the listing still live: paying attention (or promotion)
  // for merchandise that cannot be sold.
  const oos = db.prepare(
    `SELECT brand, model FROM phone_listings
      WHERE seller_id=? AND status='active' AND stock_qty = 0
      ORDER BY updated_at DESC LIMIT 12`,
  ).all(u.id);

  // Chats whose last message is the buyer's — the shop owes a reply.
  let unanswered = 0;
  let unansweredOldestMin = null;
  {
    const chats = db.prepare(
      'SELECT id, buyer_id, last_message_at FROM chats WHERE seller_id=? ORDER BY last_message_at DESC LIMIT 100',
    ).all(u.id);
    const lastSender = db.prepare(
      'SELECT sender_id, created_at FROM chat_messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 1',
    );
    const nowTs = Date.now();
    for (const c of chats) {
      const m = lastSender.get(c.id);
      if (m && m.sender_id !== u.id) {
        unanswered++;
        const age = Math.round((nowTs - m.created_at) / 60000);
        if (unansweredOldestMin == null || age > unansweredOldestMin) unansweredOldestMin = age;
      }
    }
  }

  res.json({
    id: u.id,
    name: u.shop_name || u.display_name,
    logo: u.shop_image_path || u.profile_image_path || null,
    orders_enabled: !!u.shop_orders_enabled,
    active_listings: db.prepare(
      "SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND status='active'",
    ).get(u.id).n,
    order_counts: counts,
    today: {
      delivered_total: delivered.t,
      delivered_count: delivered.n,
      recorded_total: recorded.t,
      recorded_count: recorded.n,
      cancelled_count: cancelledToday.n,
      inflight_count: inflight.n,
    },
    pending_calls: oldestPending ? {
      count: counts.pending,
      oldest_order_id: oldestPending.id,
      oldest_code: oldestPending.code,
      oldest_phone: oldestPending.customer_phone,
      oldest_governorate: oldestPending.governorate,
      oldest_created_at: oldestPending.created_at,
    } : { count: 0 },
    out_of_stock: { count: oos.length, models: oos.slice(0, 3).map((r2) => `${r2.brand} ${r2.model}`) },
    unanswered_chats: { count: unanswered, oldest_minutes: unansweredOldestMin },
  });
});

r.get('/shop-admin/orders', requireShopAdmin, (req, res) => {
  const status = ORDER_STATUSES.includes(req.query.status) ? req.query.status : '';
  let sql = 'SELECT * FROM orders WHERE shop_id=?';
  const params = [req.shop.id];
  if (status) { sql += ' AND status=?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id=?');
  res.json(rows.map((o) => ({ ...o, items: itemsStmt.all(o.id) })));
});

r.patch('/shop-admin/orders/:id(\\d+)', requireShopAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND shop_id=?')
    .get(req.params.id, req.shop.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const next = String(req.body?.status || '');
  if (!ORDER_STATUSES.includes(next)) return res.status(400).json({ error: 'bad_status' });
  if (next === o.status) return res.json({ ok: true, order: o });
  if (!ORDER_NEXT[o.status].includes(next)) {
    return res.status(409).json({ error: 'bad_transition', from: o.status, to: next });
  }
  const reason = next === 'cancelled'
    ? (String(req.body?.cancel_reason || '').trim().slice(0, 200) || 'cancelled_by_shop')
    : null;
  const t = now();
  applyStatusToStock(o, next);
  db.prepare('UPDATE orders SET status=?, cancel_reason=?, updated_at=? WHERE id=?')
    .run(next, reason, t, o.id);
  if (next === 'delivered') {
    db.prepare('UPDATE orders SET delivered_at=? WHERE id=? AND delivered_at IS NULL').run(t, o.id);
  }
  if (o.user_id) {
    const msg = orderStatusNotification(o, next);
    if (msg) notify(o.user_id, 'order.' + next, { order_id: o.id, code: o.code, status: next }, msg);
  }
  res.json({ ok: true, order: db.prepare('SELECT * FROM orders WHERE id=?').get(o.id) });
});

r.get('/shop-admin/listings', requireShopAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT l.id, l.brand, l.model, l.storage, l.color, l.asking_price, l.status,
            l.price_on_request, l.stock_qty, l.created_at,
            (SELECT i.image_path FROM listing_images i
              WHERE i.listing_id = l.id ORDER BY i.position, i.id LIMIT 1) AS cover
       FROM phone_listings l WHERE l.seller_id=? AND l.status != 'removed'
       ORDER BY l.created_at DESC LIMIT 500`,
  ).all(req.shop.id);
  res.json(rows);
});


// ─── devices ──────────────────────────────────────────────────────────
// The shop's inventory is its marketplace listings. Create, price/stock
// edit, photo upload, and off-shelf all live here, scoped to the token's
// shop. A device without a price is legal — it imports/creates as
// price_on_request ("اتصل للسعر") until it gets one.

r.post('/shop-admin/listings', requireShopAdmin, (req, res) => {
  const b = req.body || {};
  const brand = String(b.brand || '').trim();
  const model = String(b.model || '').trim();
  if (!brand || !model) return res.status(400).json({ error: 'missing_fields' });
  const priceRaw = Number(b.asking_price);
  const hasPrice = Number.isFinite(priceRaw) && priceRaw > 0;
  const price = hasPrice ? (priceRaw < 10000 ? priceRaw * 1000 : Math.round(priceRaw)) : 1;
  const condition = ['new', 'used', 'refurbished', 'repaired'].includes(b.condition) ? b.condition : 'new';
  const stock = Number.isFinite(Number(b.stock_qty)) && Number(b.stock_qty) >= 0 ? Number(b.stock_qty) : null;
  const t = now();
  const TTL_MS = (Number(getSetting('listing_ttl_days')) || 30) * 24 * 60 * 60 * 1000;
  const id = db.prepare(`
    INSERT INTO phone_listings(
      seller_id, brand, model, storage, color, condition,
      battery_health, warranty_status, accessories_json, asking_price,
      governorate, city, description, status,
      contact_phone, contact_whatsapp, price_on_request, stock_qty,
      created_at, expires_at, updated_at
    ) VALUES(?,?,?,?,?,?,NULL,NULL,'[]',?,?,NULL,?, 'active', NULL, NULL, ?, ?, ?, ?, ?)
  `).run(
    req.shop.id, brand, model,
    String(b.storage || '').trim() || null,
    String(b.color || '').trim() || null,
    condition, price,
    req.shop.governorate || 'Baghdad',
    String(b.description || '').trim() || null,
    hasPrice ? 0 : 1, stock,
    t, t + TTL_MS, t,
  ).lastInsertRowid;
  res.json({ ok: true, id });
});

r.patch('/shop-admin/listings/:id(\\d+)', requireShopAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM phone_listings WHERE id=? AND seller_id=?')
    .get(req.params.id, req.shop.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const fields = []; const params = [];
  if (b.asking_price !== undefined) {
    const n = Number(b.asking_price);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'bad_price' });
    const price = n < 10000 ? n * 1000 : Math.round(n);
    if (price < 100000) return res.status(400).json({ error: 'price_too_low' });
    fields.push('asking_price=?', 'price_on_request=0'); params.push(price);
  }
  if (b.stock_qty !== undefined) {
    const n = Number(b.stock_qty);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'bad_stock' });
    fields.push('stock_qty=?'); params.push(n);
  }
  if (b.status !== undefined) {
    if (!['active', 'removed'].includes(b.status)) return res.status(400).json({ error: 'bad_status' });
    fields.push('status=?'); params.push(b.status);
  }
  if (!fields.length) return res.status(400).json({ error: 'nothing_to_update' });
  fields.push('updated_at=?'); params.push(now());
  db.prepare(`UPDATE phone_listings SET ${fields.join(', ')} WHERE id=?`).run(...params, row.id);
  res.json({ ok: true });
});

r.post('/shop-admin/listings/:id(\\d+)/images', requireShopAdmin, uploadLimiter, listingImg.single('image'), (req, res) => {
  const row = db.prepare('SELECT id FROM phone_listings WHERE id=? AND seller_id=?')
    .get(req.params.id, req.shop.id);
  if (!row) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(404).json({ error: 'not_found' });
  }
  if (!req.file) return res.status(400).json({ error: 'missing_file' });
  const hash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
  const maxPos = db.prepare('SELECT COALESCE(MAX(position),0) AS p FROM listing_images WHERE listing_id=?').get(row.id).p;
  db.prepare('INSERT INTO listing_images(listing_id, image_path, position, created_at, image_hash) VALUES(?,?,?,?,?)')
    .run(row.id, `/uploads/${req.file.filename}`, maxPos + 1, now(), hash);
  res.json({ ok: true, image_path: `/uploads/${req.file.filename}` });
});

// ─── price-list images (shop gallery) ────────────────────────────────
r.get('/shop-admin/shop-images', requireShopAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, image_path, position FROM shop_images WHERE shop_id=? ORDER BY position, id')
    .all(req.shop.id));
});
r.post('/shop-admin/shop-images', requireShopAdmin, uploadLimiter, shopImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' });
  const maxPos = db.prepare('SELECT COALESCE(MAX(position),0) AS p FROM shop_images WHERE shop_id=?').get(req.shop.id).p;
  const id = db.prepare('INSERT INTO shop_images(shop_id, image_path, position, created_at) VALUES(?,?,?,?)')
    .run(req.shop.id, `/uploads/${req.file.filename}`, maxPos + 1, now()).lastInsertRowid;
  res.json({ ok: true, id, image_path: `/uploads/${req.file.filename}` });
});
r.delete('/shop-admin/shop-images/:id(\\d+)', requireShopAdmin, (req, res) => {
  const del = db.prepare('DELETE FROM shop_images WHERE id=? AND shop_id=?').run(req.params.id, req.shop.id);
  if (!del.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ─── Excel import — same engine as the admin store import, scoped ────
r.post('/shop-admin/import-excel', requireShopAdmin, sheetUpload.single('file'), (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: 'missing_file' });
  let parsed;
  try { parsed = parseSheet(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'bad_file', detail: String(e?.message || e) }); }
  const planned = planImport(parsed.rows, {
    pricesOnly: req.query.prices_only === '1',
    shopId: req.shop.id,
  });
  if (planned.error) return res.status(400).json({ error: planned.error });
  const counts = {};
  for (const pl of planned.plan) counts[pl.action] = (counts[pl.action] || 0) + 1;
  if (req.query.dry === '1') {
    return res.json({ ok: true, dry: true, counts, errors: parsed.errors, rows: planned.plan });
  }
  const result = applyImport(planned.plan, planned.shopId);
  res.json({ ok: true, counts, errors: parsed.errors, ...result });
});

// ─── order fulfilment details (courier / tracking note) ─────────────
r.patch('/shop-admin/orders/:id(\\d+)/fulfilment', requireShopAdmin, (req, res) => {
  const o = db.prepare('SELECT id FROM orders WHERE id=? AND shop_id=?').get(req.params.id, req.shop.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const courier = req.body?.courier !== undefined ? String(req.body.courier).trim().slice(0, 80) || null : undefined;
  const note = req.body?.tracking_note !== undefined ? String(req.body.tracking_note).trim().slice(0, 200) || null : undefined;
  const fields = []; const params = [];
  if (courier !== undefined) { fields.push('courier=?'); params.push(courier); }
  if (note !== undefined) { fields.push('tracking_note=?'); params.push(note); }
  if (!fields.length) return res.status(400).json({ error: 'nothing_to_update' });
  fields.push('updated_at=?'); params.push(now());
  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id=?`).run(...params, o.id);
  res.json({ ok: true });
});

// ─── chats — the app's own pipeline, shop side ───────────────────────
// Messages insert with sender_id = the shop's user id, so in the buyer's
// app they appear exactly like any seller reply, with the shop's name.

r.get('/shop-admin/chats', requireShopAdmin, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM chats WHERE seller_id=? ORDER BY last_message_at DESC LIMIT 100',
  ).all(req.shop.id);
  const lastMsg = db.prepare(
    'SELECT sender_id, body, image_path, created_at FROM chat_messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 1',
  );
  const buyer = db.prepare('SELECT display_name FROM users WHERE id=?');
  const listing = db.prepare('SELECT brand, model FROM phone_listings WHERE id=?');
  res.json(rows.map((c) => {
    const m = lastMsg.get(c.id);
    const l = listing.get(c.listing_id);
    return {
      id: c.id,
      buyer_name: buyer.get(c.buyer_id)?.display_name || 'زبون',
      listing_label: l ? `${l.brand} ${l.model}` : null,
      last_message: m ? (m.body || '📷 صورة') : null,
      last_message_at: c.last_message_at,
      unread: !!(m && m.sender_id !== req.shop.id
        && (!c.seller_last_read_at || m.created_at > c.seller_last_read_at)),
    };
  }));
});

r.get('/shop-admin/chats/:id(\\d+)/messages', requireShopAdmin, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=? AND seller_id=?').get(req.params.id, req.shop.id);
  if (!chat) return res.status(404).json({ error: 'not_found' });
  const rows = db.prepare(
    `SELECT m.id, m.chat_id, m.sender_id, m.body, m.image_path, m.created_at,
            u.display_name AS sender_name
     FROM chat_messages m JOIN users u ON u.id = m.sender_id
     WHERE m.chat_id=? ORDER BY m.created_at ASC LIMIT 500`,
  ).all(chat.id);
  db.prepare('UPDATE chats SET seller_last_read_at=? WHERE id=?').run(Date.now(), chat.id);
  res.json(rows);
});

r.post('/shop-admin/chats/:id(\\d+)/messages', requireShopAdmin, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=? AND seller_id=?').get(req.params.id, req.shop.id);
  if (!chat) return res.status(404).json({ error: 'not_found' });
  const body = (req.body?.body || '').toString().trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'empty_message' });
  const t = now();
  const ins = db.prepare(
    'INSERT INTO chat_messages(chat_id, sender_id, body, image_path, masked, created_at) VALUES(?,?,?,NULL,0,?)',
  ).run(chat.id, req.shop.id, body, t);
  db.prepare('UPDATE chats SET last_message_at=?, seller_last_read_at=? WHERE id=?').run(t, t, chat.id);
  const msg = db.prepare(
    `SELECT m.id, m.chat_id, m.sender_id, m.body, m.image_path, m.created_at,
            u.display_name AS sender_name
     FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id=?`,
  ).get(ins.lastInsertRowid);
  notify(chat.buyer_id, 'chat.message', { chat_id: chat.id, message: msg }, {
    title: 'رسالة جديدة',
    body: body.slice(0, 80),
  });
  res.json(msg);
});

export default r;
