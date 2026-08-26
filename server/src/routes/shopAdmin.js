// Per-shop merchant panel API (dormant until the multi_shop_orders switch
// is on — login itself works regardless so credentials can be handed out
// ahead of the launch). Each shop gets its own username/password (set by
// the admin from the shops page); the token is scoped to that one shop and
// every query here filters by it. Deliberately small: see your orders,
// move them through the linear lifecycle, glance at your stock.

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';
import { authLimiter } from '../limits.js';
import { notify } from '../notify.js';
import { applyStatusToStock } from '../stock.js';
import { ORDER_STATUSES, ORDER_NEXT, orderStatusNotification } from '../orderFlow.js';

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
  res.json({
    id: u.id,
    name: u.shop_name || u.display_name,
    logo: u.shop_image_path || u.profile_image_path || null,
    orders_enabled: !!u.shop_orders_enabled,
    active_listings: db.prepare(
      "SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND status='active'",
    ).get(u.id).n,
    order_counts: counts,
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
    `SELECT id, brand, model, storage, color, asking_price, status, created_at
       FROM phone_listings WHERE seller_id=? AND status != 'removed'
       ORDER BY created_at DESC LIMIT 500`,
  ).all(req.shop.id);
  res.json(rows);
});

export default r;
