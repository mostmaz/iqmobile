// Per-shop merchant panel API (dormant until the multi_shop_orders switch
// is on — login itself works regardless so credentials can be handed out
// ahead of the launch). Each shop gets its own username/password (set by
// the admin from the shops page); the token is scoped to that one shop and
// every query here filters by it. Deliberately small: see your orders,
// move them through the linear lifecycle, glance at your stock.

import { Router } from 'express';
import { createTierRequest } from '../shopTier.js';
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
import { SHOP_FEATURE_TIERS, CARRIERS, TRANSFER_NUMBERS, USSD_TEMPLATES, QI_CARD, CARRIER_PREFIXES } from '../featureTiers.js';
import { pushToAdmins } from '../adminPush.js';
import { audit } from '../auditLog.js';
import { getShopSignals, computeShopSignals } from '../shopSignals.js';
import { refreshShopDiagnostics, demandForShop } from '../shopDiagnostics.js';

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

// Advanced-tier gate. Everything the simple dashboard already had stays
// reachable without it — this only guards the additive surfaces (spec §12).
function requireAdvanced(req, res, next) {
  if (req.shop?.shop_tier !== 'advanced') {
    return res.status(403).json({ error: 'advanced_required' });
  }
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
    // Verification + featuring state for the panel's shop-level cards.
    verified: !!u.verified,
    featured_until: u.shop_featured_until || null,
    verification: {
      has_logo: !!(u.shop_image_path || u.profile_image_path),
      gallery_count: db.prepare('SELECT COUNT(*) AS n FROM shop_images WHERE shop_id=?').get(u.id).n,
      has_location: !!(u.shop_lat && u.shop_lng),
      request_status: db.prepare(
        'SELECT status FROM shop_verification_requests WHERE shop_id=? ORDER BY id DESC LIMIT 1',
      ).get(u.id)?.status || null,
    },
    feature_request_status: db.prepare(
      "SELECT status, tier, created_at FROM shop_feature_requests WHERE shop_id=? ORDER BY id DESC LIMIT 1",
    ).get(u.id) || null,

    // ── Tier + upgrade offer (spec §1, §2) ──────────────────────────
    tier: u.shop_tier || 'simple',
    tier_state: u.shop_tier_state || null,
    sells_new: !!u.shop_sells_new,
    signals: (() => {
      const sig = getShopSignals(u.id);
      return sig ? {
        active_listings: sig.active_listings,
        listings_30d: sig.listings_30d,
        contacts_30d: sig.contacts_30d,
        whatsapp_30d: sig.whatsapp_30d,
        chat_30d: sig.chat_30d,
        call_30d: sig.call_30d,
        qualifies: !!sig.qualifies,
      } : null;
    })(),
    // The offer is only ever surfaced in-context: the panel asks for it at
    // the moment of friction and the SERVER decides whether it is due, so
    // the 7-day cadence and the 14-day dismissal can't be bypassed by a
    // client that forgets its own state.
    upgrade_offer: (() => {
      if ((u.shop_tier || 'simple') === 'advanced') return null;
      if (u.shop_tier_state === 'requested' || u.shop_tier_state === 'pending_review') {
        return { state: 'pending' };
      }
      const t2 = now();
      if (u.shop_offer_dismissed_until && u.shop_offer_dismissed_until > t2) return null;
      if (u.shop_offer_last_at && t2 - u.shop_offer_last_at < 7 * 86400000) return null;
      const sig = getShopSignals(u.id);
      if (!sig?.qualifies) return null;
      // 30-day cool-off after a rejection (spec §3).
      if (u.shop_tier_rejected_at && t2 - u.shop_tier_rejected_at < 30 * 86400000) return null;
      return { state: 'available', reason: sig.active_listings >= 10 ? 'listings' : 'activity' };
    })(),
    channels: {
      call: (u.shop_ch_call ?? 1) ? true : false,
      whatsapp: (u.shop_ch_whatsapp ?? 1) ? true : false,
      chat: (u.shop_ch_chat ?? 1) ? true : false,
    },
    // Reply performance, private view (spec §9): the exact figure and the
    // distance to the next badge. The buyer UI never sees a slow signal.
    reply: (() => {
      const chats = db.prepare(
        'SELECT id, buyer_id FROM chats WHERE seller_id=? ORDER BY created_at DESC LIMIT 60',
      ).all(u.id);
      const firstBuyer = db.prepare('SELECT MIN(created_at) AS t FROM chat_messages WHERE chat_id=? AND sender_id=?');
      const firstReply = db.prepare('SELECT MIN(created_at) AS t FROM chat_messages WHERE chat_id=? AND sender_id=? AND created_at > ?');
      const deltas = [];
      for (const c of chats) {
        const t0 = firstBuyer.get(c.id, c.buyer_id)?.t;
        if (!t0) continue;
        const t1 = firstReply.get(c.id, u.id, t0)?.t;
        if (t1) deltas.push(t1 - t0);
      }
      if (deltas.length < 5) {
        return { conversations: deltas.length, median_minutes: null, badge: null, needed: 5 - deltas.length };
      }
      deltas.sort((a, b) => a - b);
      const med = Math.round(deltas[Math.floor(deltas.length / 2)] / 60000);
      return {
        conversations: deltas.length,
        median_minutes: med,
        badge: med <= 60 ? 'fast' : med <= 240 ? 'same_day' : null,
        next_badge: med <= 60 ? null : med <= 240 ? 'fast' : 'same_day',
      };
    })(),
    unread_threads: db.prepare(`
      SELECT COUNT(*) AS n FROM chats c
       WHERE c.seller_id=? AND c.closed_at IS NULL
         AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.chat_id=c.id
                       AND m.sender_id != ? AND m.created_at > COALESCE(c.seller_last_read_at, 0))
    `).get(u.id, u.id).n,
  });
});

// ─── tier request (spec §3) ──────────────────────────────────────────
r.post('/shop-admin/offer-dismiss', requireShopAdmin, (req, res) => {
  db.prepare('UPDATE users SET shop_offer_dismissed_until=? WHERE id=?')
    .run(now() + 14 * 86400000, req.shop.id);
  res.json({ ok: true });
});

r.post('/shop-admin/offer-seen', requireShopAdmin, (req, res) => {
  db.prepare('UPDATE users SET shop_offer_last_at=? WHERE id=?').run(now(), req.shop.id);
  res.json({ ok: true });
});

r.post('/shop-admin/tier-request', requireShopAdmin, (req, res) => {
  // Rules live in shopTier.js — the app's home-feed card asks through the
  // same helper, and two copies would drift the first time one changed.
  const r2 = createTierRequest(req.shop.id, req.body || {}, 'shop');
  if (r2.error) return res.status(r2.status).json(r2);
  res.json({ ok: true, id: r2.id });
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
            l.price_on_request, l.stock_qty, l.is_draft, l.created_at,
            (SELECT i.image_path FROM listing_images i
              WHERE i.listing_id = l.id ORDER BY i.position, i.id LIMIT 1) AS cover
       FROM phone_listings l
      WHERE l.seller_id=? AND (l.status != 'removed' OR COALESCE(l.is_draft,0)=1)
      ORDER BY COALESCE(l.is_draft,0) DESC, l.created_at DESC LIMIT 500`,
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

// ─── bulk operations (spec §4) ───────────────────────────────────────
// One transaction per call: better-sqlite3 is synchronous, so 100+ rows is
// a single sub-second write with no timeout surface at all. The BEFORE
// values go to bulk_undo so undo is a restore rather than an inverse — a
// -7% price change cannot be un-applied arithmetically without drift.
const UNDO_MS = 30000;

r.post('/shop-admin/bulk', requireShopAdmin, requireAdvanced, (req, res) => {
  const action = String(req.body?.action || '');
  const ids = Array.isArray(req.body?.listing_ids)
    ? req.body.listing_ids.map(Number).filter(Number.isFinite).slice(0, 500)
    : [];
  if (!ids.length) return res.status(400).json({ error: 'no_selection' });

  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, asking_price, price_on_request, status, stock_qty, is_draft
       FROM phone_listings WHERE id IN (${ph}) AND seller_id=?`,
  ).all(...ids, req.shop.id);
  if (!rows.length) return res.status(404).json({ error: 'not_found' });

  const t = now();
  const before = rows.map((r2) => ({
    id: r2.id, asking_price: r2.asking_price, price_on_request: r2.price_on_request,
    status: r2.status, stock_qty: r2.stock_qty, is_draft: r2.is_draft,
  }));

  const setPrice = db.prepare('UPDATE phone_listings SET asking_price=?, price_on_request=0, updated_at=? WHERE id=?');
  const setStatus = db.prepare('UPDATE phone_listings SET status=?, updated_at=? WHERE id=?');
  const setStock = db.prepare('UPDATE phone_listings SET stock_qty=?, updated_at=? WHERE id=?');
  let affected = 0;

  try {
    db.transaction(() => {
      for (const r2 of rows) {
        switch (action) {
          case 'price_fixed': {
            const n = Number(req.body?.amount);
            if (!Number.isFinite(n)) throw new Error('bad_amount');
            const v = n < 10000 ? n * 1000 : Math.round(n);
            if (v < 100000) throw new Error('price_too_low');
            setPrice.run(v, t, r2.id); affected++;
            break;
          }
          case 'price_percent': {
            const pct = Number(req.body?.percent);
            if (!Number.isFinite(pct) || pct < -90 || pct > 200) throw new Error('bad_percent');
            // Price-on-request rows have a placeholder price; a percentage
            // of a placeholder is nonsense, so they are skipped, not
            // silently corrupted.
            if (r2.price_on_request) break;
            const v = Math.max(0, Math.round((r2.asking_price * (100 + pct)) / 100 / 1000) * 1000);
            if (v < 100000) throw new Error('price_too_low');
            setPrice.run(v, t, r2.id); affected++;
            break;
          }
          case 'activate': setStatus.run('active', t, r2.id); affected++; break;
          case 'deactivate': setStatus.run('expired', t, r2.id); affected++; break;
          case 'delete': setStatus.run('removed', t, r2.id); affected++; break;
          case 'stock_set': {
            const q = Number(req.body?.stock_qty);
            if (!Number.isFinite(q) || q < 0) throw new Error('bad_stock');
            setStock.run(q, t, r2.id); affected++;
            break;
          }
          default: throw new Error('bad_action');
        }
      }
    })();
  } catch (err) {
    const known = ['bad_amount', 'bad_percent', 'bad_action', 'bad_stock', 'price_too_low'];
    const code = known.includes(err.message) ? err.message : 'bulk_failed';
    return res.status(400).json({ error: code });
  }

  const undoId = db.prepare(`
    INSERT INTO bulk_undo(shop_id, action, payload_json, affected, created_at, expires_at)
    VALUES(?,?,?,?,?,?)
  `).run(req.shop.id, action, JSON.stringify(before), affected, t, t + UNDO_MS).lastInsertRowid;
  audit('shop', req.shop.id, `bulk.${action}`, { kind: 'shop', id: req.shop.id },
    { affected, ids: ids.slice(0, 50) });
  res.json({ ok: true, affected, undo_id: undoId, undo_ms: UNDO_MS });
});

r.post('/shop-admin/bulk/:id(\\d+)/undo', requireShopAdmin, requireAdvanced, (req, res) => {
  const u = db.prepare('SELECT * FROM bulk_undo WHERE id=? AND shop_id=?')
    .get(req.params.id, req.shop.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (u.undone_at) return res.status(409).json({ error: 'already_undone' });
  if (now() > u.expires_at) return res.status(409).json({ error: 'undo_expired' });

  const before = JSON.parse(u.payload_json);
  const restore = db.prepare(`
    UPDATE phone_listings SET asking_price=?, price_on_request=?, status=?, stock_qty=?, is_draft=?, updated_at=?
     WHERE id=? AND seller_id=?
  `);
  const t = now();
  db.transaction(() => {
    for (const b of before) {
      restore.run(b.asking_price, b.price_on_request, b.status, b.stock_qty, b.is_draft, t, b.id, req.shop.id);
    }
    db.prepare('UPDATE bulk_undo SET undone_at=? WHERE id=?').run(t, u.id);
  })();
  audit('shop', req.shop.id, 'bulk.undo', { kind: 'shop', id: req.shop.id }, { undo_id: u.id, affected: before.length });
  res.json({ ok: true, restored: before.length });
});

// Multi-row keyboard entry from the desktop table (spec §5). Rows without
// a price are legal — they land as price_on_request, same rule as import.
r.post('/shop-admin/listings/bulk-add', requireShopAdmin, requireAdvanced, (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 200) : [];
  if (!rows.length) return res.status(400).json({ error: 'no_rows' });
  const asDraft = !!req.body?.draft;
  const t = now();
  const TTL_MS = (Number(getSetting('listing_ttl_days')) || 30) * 24 * 60 * 60 * 1000;
  const ins = db.prepare(`
    INSERT INTO phone_listings(
      seller_id, brand, model, storage, color, condition,
      battery_health, warranty_status, accessories_json, asking_price,
      governorate, city, description, status,
      contact_phone, contact_whatsapp, price_on_request, stock_qty, is_draft,
      created_at, expires_at, updated_at
    ) VALUES(?,?,?,?,?,?,NULL,NULL,'[]',?,?,NULL,?,?,NULL,NULL,?,?,?,?,?,?)
  `);
  const created = [];
  const errors = [];
  db.transaction(() => {
    rows.forEach((row, i) => {
      const brand = String(row.brand || '').trim();
      const model = String(row.model || '').trim();
      if (!brand || !model) { errors.push({ row: i + 1, error: 'missing_fields' }); return; }
      const raw = Number(row.asking_price);
      const hasPrice = Number.isFinite(raw) && raw > 0;
      const price = hasPrice ? (raw < 10000 ? raw * 1000 : Math.round(raw)) : 1;
      if (hasPrice && price < 100000) { errors.push({ row: i + 1, error: 'price_too_low' }); return; }
      const stock = Number.isFinite(Number(row.stock_qty)) && Number(row.stock_qty) >= 0 ? Number(row.stock_qty) : null;
      const id = ins.run(
        req.shop.id, brand, model,
        String(row.storage || '').trim() || null,
        String(row.color || '').trim() || null,
        ['new', 'used', 'refurbished', 'repaired'].includes(row.condition) ? row.condition : 'new',
        price, req.shop.governorate || 'Baghdad',
        String(row.description || '').trim() || null,
        asDraft ? 'removed' : 'active',
        hasPrice ? 0 : 1, stock, asDraft ? 1 : 0,
        t, t + TTL_MS, t,
      ).lastInsertRowid;
      created.push(id);
    });
  })();
  audit('shop', req.shop.id, 'bulk.add', { kind: 'shop', id: req.shop.id }, { created: created.length });
  res.json({ ok: true, created: created.length, ids: created, errors });
});

// Duplicate a device — same model, different storage/colour (spec §4).
r.post('/shop-admin/listings/:id(\\d+)/duplicate', requireShopAdmin, requireAdvanced, (req, res) => {
  const src = db.prepare('SELECT * FROM phone_listings WHERE id=? AND seller_id=?')
    .get(req.params.id, req.shop.id);
  if (!src) return res.status(404).json({ error: 'not_found' });
  const t = now();
  const TTL_MS = (Number(getSetting('listing_ttl_days')) || 30) * 24 * 60 * 60 * 1000;
  const id = db.prepare(`
    INSERT INTO phone_listings(
      seller_id, brand, model, storage, color, condition, battery_health,
      warranty_status, accessories_json, asking_price, governorate, city,
      description, status, contact_phone, contact_whatsapp, price_on_request,
      stock_qty, is_draft, created_at, expires_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,0,?,?,?)
  `).run(
    src.seller_id, src.brand, src.model,
    req.body?.storage !== undefined ? (String(req.body.storage).trim() || null) : src.storage,
    req.body?.color !== undefined ? (String(req.body.color).trim() || null) : src.color,
    src.condition, src.battery_health, src.warranty_status, src.accessories_json,
    Number.isFinite(Number(req.body?.asking_price)) && Number(req.body.asking_price) > 0
      ? (Number(req.body.asking_price) < 10000 ? Number(req.body.asking_price) * 1000 : Math.round(Number(req.body.asking_price)))
      : src.asking_price,
    src.governorate, src.city, src.description,
    src.contact_phone, src.contact_whatsapp, src.price_on_request,
    src.stock_qty, t, t + TTL_MS, t,
  ).lastInsertRowid;
  res.json({ ok: true, id });
});

// Publish a draft (spec §4 "add photos now, publish later").
r.post('/shop-admin/listings/:id(\\d+)/publish', requireShopAdmin, (req, res) => {
  const l = db.prepare('SELECT * FROM phone_listings WHERE id=? AND seller_id=?')
    .get(req.params.id, req.shop.id);
  if (!l) return res.status(404).json({ error: 'not_found' });
  if (!l.is_draft) return res.status(409).json({ error: 'not_a_draft' });
  if (!l.price_on_request && l.asking_price < 100000) return res.status(400).json({ error: 'price_too_low' });
  const photos = db.prepare('SELECT COUNT(*) AS n FROM listing_images WHERE listing_id=?').get(l.id).n;
  if (!photos) return res.status(400).json({ error: 'needs_photo' });
  const t = now();
  const TTL_MS = (Number(getSetting('listing_ttl_days')) || 30) * 24 * 60 * 60 * 1000;
  db.prepare("UPDATE phone_listings SET status='active', is_draft=0, created_at=?, expires_at=?, updated_at=? WHERE id=?")
    .run(t, t + TTL_MS, t, l.id);
  res.json({ ok: true });
});

// ─── sold prompt (spec §10) ──────────────────────────────────────────
// The transaction price is the point: contacts have always been countable,
// what a device actually SOLD for never has been.
r.get('/shop-admin/sold-prompt', requireShopAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, l.brand, l.model, l.storage, l.color, l.asking_price, l.created_at,
           (SELECT i.image_path FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.position, i.id LIMIT 1) AS cover
      FROM phone_listings l
     WHERE l.seller_id=? AND l.status='active' AND COALESCE(l.is_draft,0)=0
     ORDER BY l.created_at ASC LIMIT 12
  `).all(req.shop.id);
  res.json(rows);
});

r.post('/shop-admin/listings/:id(\\d+)/sold', requireShopAdmin, (req, res) => {
  const l = db.prepare('SELECT id FROM phone_listings WHERE id=? AND seller_id=?')
    .get(req.params.id, req.shop.id);
  if (!l) return res.status(404).json({ error: 'not_found' });
  const raw = Number(req.body?.sale_price);
  const price = Number.isFinite(raw) && raw > 0
    ? (raw < 10000 ? raw * 1000 : Math.round(raw))
    : null;
  const t = now();
  db.prepare("UPDATE phone_listings SET status='sold', sold_at=?, sale_price=?, updated_at=? WHERE id=?")
    .run(t, price, t, l.id);
  res.json({ ok: true });
});

// Explicit "still available" — resets the prompt clock without changing the
// listing, so the same device isn't asked about again tomorrow.
r.post('/shop-admin/listings/:id(\\d+)/still-available', requireShopAdmin, (req, res) => {
  const t = now();
  const upd = db.prepare('UPDATE phone_listings SET updated_at=? WHERE id=? AND seller_id=?')
    .run(t, req.params.id, req.shop.id);
  if (!upd.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ─── diagnostics + demand (spec §7, §8) ──────────────────────────────
r.get('/shop-admin/diagnostics', requireShopAdmin, requireAdvanced, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, l.brand, l.model, l.storage, l.asking_price, l.price_on_request
      FROM listing_diagnostics d JOIN phone_listings l ON l.id = d.listing_id
     WHERE d.seller_id=? AND l.status='active' AND COALESCE(l.is_draft,0)=0
     ORDER BY CASE d.reason_code WHEN 'price_high' THEN 0 WHEN 'few_photos' THEN 1
                                 WHEN 'stale' THEN 2 ELSE 3 END, d.views_30d DESC
     LIMIT 300
  `).all(req.shop.id);
  res.json(rows);
});

r.post('/shop-admin/diagnostics/refresh', requireShopAdmin, requireAdvanced, (req, res) => {
  const n = refreshShopDiagnostics(req.shop.id);
  res.json({ ok: true, listings: n });
});

r.get('/shop-admin/demand', requireShopAdmin, requireAdvanced, (req, res) => {
  res.json(demandForShop(req.shop.id, 10));
});

// ─── contact channels (spec §11) ─────────────────────────────────────
r.patch('/shop-admin/channels', requireShopAdmin, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT shop_ch_call, shop_ch_whatsapp, shop_ch_chat FROM users WHERE id=?')
    .get(req.shop.id);
  const next = {
    call: b.call !== undefined ? !!b.call : (cur.shop_ch_call ?? 1) === 1,
    whatsapp: b.whatsapp !== undefined ? !!b.whatsapp : (cur.shop_ch_whatsapp ?? 1) === 1,
    chat: b.chat !== undefined ? !!b.chat : (cur.shop_ch_chat ?? 1) === 1,
  };
  // A shop with no way to reach it is a dead listing — refuse the last one.
  if (!next.call && !next.whatsapp && !next.chat) {
    return res.status(400).json({ error: 'need_one_channel' });
  }
  db.prepare('UPDATE users SET shop_ch_call=?, shop_ch_whatsapp=?, shop_ch_chat=? WHERE id=?')
    .run(next.call ? 1 : 0, next.whatsapp ? 1 : 0, next.chat ? 1 : 0, req.shop.id);
  audit('shop', req.shop.id, 'channels.update', { kind: 'shop', id: req.shop.id }, next);
  res.json({ ok: true, channels: next });
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
  // Filters and search are advanced-only (spec §12); a simple shop gets the
  // plain thread list by ignoring the params rather than by a second route.
  const adv = req.shop.shop_tier === 'advanced';
  const filter = adv ? String(req.query.filter || 'all') : 'all';
  const q = adv ? String(req.query.q || '').trim().toLowerCase() : '';
  let sql = 'SELECT * FROM chats WHERE seller_id=?';
  if (filter === 'closed') sql += ' AND closed_at IS NOT NULL';
  else sql += ' AND closed_at IS NULL';
  sql += ' ORDER BY last_message_at DESC LIMIT 200';
  const rows = db.prepare(sql).all(req.shop.id);
  const lastMsg = db.prepare(
    'SELECT sender_id, body, image_path, created_at FROM chat_messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 1',
  );
  const buyer = db.prepare('SELECT display_name FROM users WHERE id=?');
  const listing = db.prepare(`
    SELECT l.brand, l.model, l.status, l.asking_price,
           (SELECT i.image_path FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.position, i.id LIMIT 1) AS cover
      FROM phone_listings l WHERE l.id=?`);
  let out = rows.map((c) => {
    const m = lastMsg.get(c.id);
    const l = listing.get(c.listing_id);
    return {
      id: c.id,
      buyer_id: c.buyer_id,
      buyer_name: buyer.get(c.buyer_id)?.display_name || 'زبون',
      listing_id: c.listing_id,
      listing_label: l ? `${l.brand} ${l.model}` : null,
      listing_cover: l?.cover || null,
      listing_status: l?.status || null,
      listing_price: l?.asking_price ?? null,
      last_message: m ? (m.body || '📷 صورة') : null,
      last_message_at: c.last_message_at,
      closed: !!c.closed_at,
      unread: !!(m && m.sender_id !== req.shop.id
        && (!c.seller_last_read_at || m.created_at > c.seller_last_read_at)),
    };
  });
  if (filter === 'unread') out = out.filter((c) => c.unread);
  if (q) out = out.filter((c) =>
    (c.listing_label || '').toLowerCase().includes(q) || (c.buyer_name || '').toLowerCase().includes(q));
  res.json(out);
});

// ─── thread actions + quick replies (spec §9) ────────────────────────
r.post('/shop-admin/chats/:id(\\d+)/close', requireShopAdmin, requireAdvanced, (req, res) => {
  const upd = db.prepare('UPDATE chats SET closed_at=? WHERE id=? AND seller_id=?')
    .run(now(), req.params.id, req.shop.id);
  if (!upd.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

r.post('/shop-admin/chats/:id(\\d+)/reopen', requireShopAdmin, requireAdvanced, (req, res) => {
  const upd = db.prepare('UPDATE chats SET closed_at=NULL WHERE id=? AND seller_id=?')
    .run(req.params.id, req.shop.id);
  if (!upd.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// Block / report. Both are logged for admin review (spec §9 data & privacy).
r.post('/shop-admin/chats/:id(\\d+)/block', requireShopAdmin, requireAdvanced, (req, res) => {
  const c = db.prepare('SELECT * FROM chats WHERE id=? AND seller_id=?').get(req.params.id, req.shop.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  db.prepare('INSERT OR IGNORE INTO chat_blocks(shop_id, buyer_id, created_at) VALUES(?,?,?)')
    .run(req.shop.id, c.buyer_id, now());
  db.prepare('UPDATE chats SET closed_at=? WHERE id=?').run(now(), c.id);
  audit('shop', req.shop.id, 'chat.block', { kind: 'user', id: c.buyer_id }, { chat_id: c.id });
  res.json({ ok: true });
});

r.post('/shop-admin/chats/:id(\\d+)/report', requireShopAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM chats WHERE id=? AND seller_id=?').get(req.params.id, req.shop.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  audit('shop', req.shop.id, 'chat.report', { kind: 'user', id: c.buyer_id }, { chat_id: c.id, reason });
  pushToAdmins('report.new', 'بلاغ من متجر',
    `${req.shop.shop_name || req.shop.display_name}: ${reason || 'بدون سبب'}`,
    { screen: 'reports' }).catch(() => {});
  res.json({ ok: true });
});

const SEED_QUICK_REPLIES = [
  'الجهاز متوفر',
  'السعر نهائي',
  'الجهاز انباع',
  'تفضل زورنا بالمحل، الموقع بالصفحة',
];

r.get('/shop-admin/quick-replies', requireShopAdmin, requireAdvanced, (req, res) => {
  let rows = db.prepare('SELECT id, text, position FROM shop_quick_replies WHERE shop_id=? ORDER BY position, id')
    .all(req.shop.id);
  // Seeded on first read rather than at approval time, so a shop upgraded
  // before this shipped still gets them.
  if (!rows.length) {
    const ins = db.prepare('INSERT INTO shop_quick_replies(shop_id, text, position) VALUES(?,?,?)');
    db.transaction(() => SEED_QUICK_REPLIES.forEach((t2, i) => ins.run(req.shop.id, t2, i)))();
    rows = db.prepare('SELECT id, text, position FROM shop_quick_replies WHERE shop_id=? ORDER BY position, id')
      .all(req.shop.id);
  }
  res.json(rows);
});

r.post('/shop-admin/quick-replies', requireShopAdmin, requireAdvanced, (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 200);
  if (!text) return res.status(400).json({ error: 'empty' });
  const n = db.prepare('SELECT COUNT(*) AS n FROM shop_quick_replies WHERE shop_id=?').get(req.shop.id).n;
  if (n >= 10) return res.status(409).json({ error: 'limit_reached' });
  const id = db.prepare('INSERT INTO shop_quick_replies(shop_id, text, position) VALUES(?,?,?)')
    .run(req.shop.id, text, n).lastInsertRowid;
  res.json({ ok: true, id });
});

r.delete('/shop-admin/quick-replies/:id(\\d+)', requireShopAdmin, requireAdvanced, (req, res) => {
  const del = db.prepare('DELETE FROM shop_quick_replies WHERE id=? AND shop_id=?')
    .run(req.params.id, req.shop.id);
  if (!del.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ─── new-device catalog (spec §6) ────────────────────────────────────
// One product = brand+model; variants are the shop's own listings, one per
// storage×colour, each with its own stock. Zero stock disables a variant —
// it never hides the product.
r.get('/shop-admin/catalog', requireShopAdmin, requireAdvanced, (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, l.brand, l.model, l.storage, l.color, l.asking_price,
           l.price_on_request, l.stock_qty, l.status,
           (SELECT i.image_path FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.position, i.id LIMIT 1) AS cover
      FROM phone_listings l
     WHERE l.seller_id=? AND l.status IN ('active','reserved') AND COALESCE(l.is_draft,0)=0
     ORDER BY l.brand, l.model, l.storage
  `).all(req.shop.id);
  const products = new Map();
  for (const l of rows) {
    const key = `${l.brand}|${l.model}`;
    if (!products.has(key)) {
      products.set(key, { brand: l.brand, model: l.model, cover: l.cover, variants: [] });
    }
    const p = products.get(key);
    if (!p.cover && l.cover) p.cover = l.cover;
    p.variants.push({
      id: l.id, storage: l.storage, color: l.color,
      asking_price: l.asking_price, price_on_request: !!l.price_on_request,
      stock_qty: l.stock_qty, in_stock: l.stock_qty == null || l.stock_qty > 0,
    });
  }
  res.json([...products.values()]);
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


// ─── market intelligence: top-10 demanded devices across the app ─────
// Contact taps (call/WhatsApp) weigh 5× a view — intent beats curiosity.
// 30-day window over EVERY listing in the marketplace, so a merchant sees
// what Iraq is actually asking for, not just their own shelf.
r.get('/shop-admin/top-devices', requireShopAdmin, (_req, res) => {
  const since = Date.now() - 30 * 86400000;
  const rows = db.prepare(`
    SELECT l.brand, l.model,
           SUM(CASE WHEN e.type='view' THEN 1 ELSE 0 END) AS views,
           SUM(CASE WHEN e.type IN ('contact_call','contact_whatsapp') THEN 1 ELSE 0 END) AS contacts
      FROM events e JOIN phone_listings l ON l.id = e.listing_id
     WHERE e.created_at > ? AND e.type IN ('view','contact_call','contact_whatsapp')
       AND l.brand IS NOT NULL AND l.brand != ''
     GROUP BY l.brand, l.model
     ORDER BY (SUM(CASE WHEN e.type IN ('contact_call','contact_whatsapp') THEN 1 ELSE 0 END) * 5
             + SUM(CASE WHEN e.type='view' THEN 1 ELSE 0 END)) DESC
     LIMIT 10
  `).all(since);
  res.json(rows);
});

// ─── shop logo + location (verification prerequisites) ───────────────
r.post('/shop-admin/logo', requireShopAdmin, uploadLimiter, shopImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' });
  db.prepare('UPDATE users SET shop_image_path=? WHERE id=?')
    .run(`/uploads/${req.file.filename}`, req.shop.id);
  res.json({ ok: true, image_path: `/uploads/${req.file.filename}` });
});

r.post('/shop-admin/location', requireShopAdmin, (req, res) => {
  const lat = Number(req.body?.lat); const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'bad_location' });
  }
  db.prepare('UPDATE users SET shop_lat=?, shop_lng=? WHERE id=?').run(lat, lng, req.shop.id);
  res.json({ ok: true });
});

// ─── ميّز متجري — shop featuring request ─────────────────────────────
r.get('/shop-admin/feature-config', requireShopAdmin, (_req, res) => {
  res.json({
    tiers: SHOP_FEATURE_TIERS,
    carriers: CARRIERS,
    transfer_numbers: TRANSFER_NUMBERS,
    ussd_templates: USSD_TEMPLATES,
    qi_card: QI_CARD,
    carrier_prefixes: CARRIER_PREFIXES,
  });
});

r.post('/shop-admin/feature-request', requireShopAdmin, (req, res) => {
  const tier = SHOP_FEATURE_TIERS.find((t2) => t2.key === String(req.body?.tier || ''));
  if (!tier) return res.status(400).json({ error: 'bad_tier' });
  const carrier = String(req.body?.carrier || '').trim().toLowerCase();
  if (!CARRIERS.includes(carrier)) return res.status(400).json({ error: 'bad_carrier' });
  let senderPhone = null; let senderName = null;
  if (carrier === 'qicard') {
    senderName = String(req.body?.sender_name || '').trim().slice(0, 80);
    if (senderName.length < 2) return res.status(400).json({ error: 'bad_sender_name' });
  } else {
    senderPhone = String(req.body?.sender_phone || '').replace(/\D/g, '');
    if (senderPhone.length < 10) return res.status(400).json({ error: 'bad_sender_phone' });
    const pfx = CARRIER_PREFIXES[carrier];
    if (pfx && !senderPhone.startsWith(pfx)) return res.status(400).json({ error: 'bad_sender_prefix' });
  }
  const open = db.prepare(
    "SELECT id FROM shop_feature_requests WHERE shop_id=? AND status='pending'",
  ).get(req.shop.id);
  if (open) return res.status(409).json({ error: 'request_pending' });
  const id = db.prepare(`
    INSERT INTO shop_feature_requests(shop_id, tier, amount, days, carrier, sender_phone, sender_name, status, created_at)
    VALUES(?,?,?,?,?,?,?,'pending',?)
  `).run(req.shop.id, tier.key, tier.amount, tier.days, carrier, senderPhone, senderName, now()).lastInsertRowid;
  pushToAdmins('feature.requested', 'طلب تمييز متجر ✨',
    `${req.shop.shop_name || req.shop.display_name} · ${tier.label_ar} · ${tier.amount.toLocaleString('en-US')} د.ع`,
    { screen: 'shops' },
  ).catch(() => {});
  res.json({ ok: true, id });
});

// ─── verification request ────────────────────────────────────────────
// Prerequisites enforced server-side too: logo, ≥3 gallery images, and a
// pinned location — the badge should mean something.
r.post('/shop-admin/verification-request', requireShopAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.shop.id);
  if (u.verified) return res.status(409).json({ error: 'already_verified' });
  const gallery = db.prepare('SELECT COUNT(*) AS n FROM shop_images WHERE shop_id=?').get(u.id).n;
  const missing = [];
  if (!(u.shop_image_path || u.profile_image_path)) missing.push('logo');
  if (gallery < 3) missing.push('gallery');
  if (!(u.shop_lat && u.shop_lng)) missing.push('location');
  if (missing.length) return res.status(400).json({ error: 'requirements_missing', missing });
  const open = db.prepare(
    "SELECT id FROM shop_verification_requests WHERE shop_id=? AND status='pending'",
  ).get(u.id);
  if (open) return res.status(409).json({ error: 'request_pending' });
  const id = db.prepare(
    "INSERT INTO shop_verification_requests(shop_id, status, created_at) VALUES(?, 'pending', ?)",
  ).run(u.id, now()).lastInsertRowid;
  pushToAdmins('shop.new', 'طلب توثيق متجر ✔️',
    `${u.shop_name || u.display_name}`,
    { screen: 'shops' },
  ).catch(() => {});
  res.json({ ok: true, id });
});

export default r;
