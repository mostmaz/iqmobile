// Direct orders for order-enabled shops — cash on delivery.
//
// The rest of the marketplace is contact-only: the buyer phones the seller.
// A shop with users.shop_orders_enabled=1 is a storefront instead — the buyer
// fills a cart, checks out with name/phone/governorate/address, and the shop
// delivers and collects cash.
//
// Two rules shape everything here:
//
//   1. The SERVER prices the order. The client sends listing ids and
//      quantities, never money. Trusting a client-sent total is how you get
//      an order for a 1,700,000 IQD phone that says it costs 1,000.
//   2. Prices are snapshotted onto order_items. A listing's price can change
//      or the listing can be deleted while the order is still out for
//      delivery; the customer owes what they were quoted.

import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { normalizeGovernorate } from '../governorates.js';
import { notify } from '../notify.js';

const r = Router();

const MAX_QTY_PER_LINE = 10;
const MAX_LINES = 20;

// Iraqi phone normaliser — same shapes the rest of the app accepts
// (+964, 00964, spaces/dashes) collapsing to the canonical 0XXXXXXXXXX.
function normalizeIraqiPhone(input) {
  if (!input) return null;
  let d = String(input).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  if (!d.startsWith('0')) d = '0' + d;
  if (d.length < 10 || d.length > 12) return null;
  return d;
}

/**
 * Short human reference the customer can quote on the phone. Sequential
 * rather than random so support can eyeball "is this recent?", and derived
 * from the row id so it's unique without a retry loop.
 */
const orderCode = (id) => `IQ-${1000 + Number(id)}`;

function itemsFor(orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id ASC').all(orderId);
}

export function orderWithItems(row) {
  if (!row) return null;
  const shop = db.prepare('SELECT id, shop_name, display_name FROM users WHERE id=?').get(row.shop_id);
  return {
    ...row,
    shop_name: shop ? (shop.shop_name || shop.display_name) : null,
    items: itemsFor(row.id),
  };
}

// ─── checkout ─────────────────────────────────────────────────────────
// Auth required: an order needs someone to notify about status changes, and
// guests already have a real user row (auto-provisioned at app launch), so
// this costs a guest nothing.
r.post('/orders', requireAuth(), (req, res) => {
  const b = req.body || {};

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (!rawItems.length) return res.status(400).json({ error: 'empty_cart' });
  if (rawItems.length > MAX_LINES) return res.status(400).json({ error: 'too_many_items' });

  const customer_name = String(b.customer_name || '').trim().slice(0, 60);
  if (customer_name.length < 2) return res.status(400).json({ error: 'name_required' });

  const customer_phone = normalizeIraqiPhone(b.customer_phone);
  if (!customer_phone) return res.status(400).json({ error: 'bad_phone' });

  const governorate = normalizeGovernorate(b.governorate);
  if (!governorate) return res.status(400).json({ error: 'bad_governorate' });

  const address = String(b.address || '').trim().slice(0, 300);
  if (address.length < 5) return res.status(400).json({ error: 'address_required' });

  const note = String(b.note || '').trim().slice(0, 500) || null;

  // Collapse duplicate listing ids into one line. Tapping "add to cart"
  // twice must mean qty 2, not two lines that each look like a separate
  // device on the shop's picking list.
  const wanted = new Map();
  for (const it of rawItems) {
    const id = Number(it?.listing_id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_item' });
    // Omitted qty means 1; an explicit 0 is a client bug and must NOT be
    // coerced into 1 (`Number(0) || 1` would do exactly that, quietly
    // ordering a device the customer had just removed from the cart).
    const rawQty = it?.qty;
    const qty = rawQty === undefined || rawQty === null ? 1 : Math.floor(Number(rawQty));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      return res.status(400).json({ error: 'bad_qty' });
    }
    wanted.set(id, Math.min(MAX_QTY_PER_LINE, (wanted.get(id) || 0) + qty));
  }

  // Load every listing and verify they all belong to ONE order-enabled shop.
  // A cart spanning two shops has no coherent shipping fee or fulfilment
  // path, so it's rejected rather than silently split.
  const ids = [...wanted.keys()];
  const rows = db.prepare(
    `SELECT * FROM phone_listings WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).all(...ids);
  if (rows.length !== ids.length) return res.status(409).json({ error: 'item_unavailable' });

  const shopIds = [...new Set(rows.map((l) => l.seller_id))];
  if (shopIds.length !== 1) return res.status(400).json({ error: 'mixed_shops' });

  const shop = db.prepare("SELECT * FROM users WHERE id=? AND seller_type='shop'").get(shopIds[0]);
  if (!shop || !shop.shop_orders_enabled) return res.status(403).json({ error: 'orders_not_enabled' });

  // Sold/removed/expired listings can sit in a cart the buyer opened an hour
  // ago. Re-check at checkout rather than trusting what the app last saw.
  const unavailable = rows.filter((l) => l.status !== 'active');
  if (unavailable.length) {
    return res.status(409).json({ error: 'item_unavailable', listing_ids: unavailable.map((l) => l.id) });
  }

  const shipping_fee = Math.max(0, Number(shop.shop_shipping_fee) || 0);

  const t = now();
  let created;
  // One transaction: an order without its items is worse than no order.
  db.transaction(() => {
    let subtotal = 0;
    const lines = rows.map((l) => {
      const qty = wanted.get(l.id);
      const unit_price = Math.round(Number(l.asking_price) || 0);
      const line_total = unit_price * qty;
      subtotal += line_total;
      const image = db.prepare(
        'SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC LIMIT 1',
      ).get(l.id);
      return {
        listing_id: l.id, brand: l.brand, model: l.model,
        storage: l.storage || null, color: l.color || null,
        image_path: image ? image.image_path : null,
        unit_price, qty, line_total,
      };
    });

    const total = subtotal + shipping_fee;
    // 'code' is NOT NULL UNIQUE and we only learn the id after the insert,
    // so seed it with a placeholder unique per-insert and rewrite it below.
    const ins = db.prepare(
      `INSERT INTO orders(code, shop_id, user_id, customer_name, customer_phone, governorate,
                          address, note, subtotal, shipping_fee, total, payment_method,
                          status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'cod','pending',?,?)`,
    ).run(`tmp-${t}-${Math.round(subtotal)}-${rows.length}`, shop.id, req.user.id,
      customer_name, customer_phone, governorate, address, note,
      subtotal, shipping_fee, total, t, t);

    const orderId = ins.lastInsertRowid;
    db.prepare('UPDATE orders SET code=? WHERE id=?').run(orderCode(orderId), orderId);

    const insItem = db.prepare(
      `INSERT INTO order_items(order_id, listing_id, brand, model, storage, color,
                               image_path, unit_price, qty, line_total)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const l of lines) {
      insItem.run(orderId, l.listing_id, l.brand, l.model, l.storage, l.color,
        l.image_path, l.unit_price, l.qty, l.line_total);
    }
    created = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  })();

  // Tell the shop (and, via notify's delegation fan-out, whoever manages it)
  // outside the transaction — a push failure must not roll back a real order.
  notify(shop.id, 'order.placed', { order_id: created.id, code: created.code, total: created.total }, {
    title: 'طلب جديد',
    body: `${created.code} · ${created.total.toLocaleString('en-US')} د.ع`,
  });

  res.json(orderWithItems(created));
});

// ─── my orders ────────────────────────────────────────────────────────
r.get('/orders/mine', requireAuth(), (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
  ).all(req.user.id);
  res.json(rows.map(orderWithItems));
});

r.get('/orders/:id(\\d+)', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  // The buyer, the shop, or whoever manages that shop.
  const managed = db.prepare('SELECT id FROM users WHERE shop_manager_id=?')
    .all(req.user.id).map((x) => x.id);
  const allowed = row.user_id === req.user.id
    || row.shop_id === req.user.id
    || managed.includes(row.shop_id);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  res.json(orderWithItems(row));
});

// Buyer-side cancel, allowed only while nobody has acted on it yet. Once the
// shop confirms, cancelling is a phone call — the device may already be out
// with a courier.
r.post('/orders/:id(\\d+)/cancel', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'not_cancellable' });
  const t = now();
  db.prepare("UPDATE orders SET status='cancelled', cancel_reason=?, updated_at=? WHERE id=?")
    .run('cancelled_by_customer', t, row.id);
  notify(row.shop_id, 'order.cancelled', { order_id: row.id, code: row.code }, {
    title: 'أُلغي طلب', body: row.code,
  });
  res.json(orderWithItems(db.prepare('SELECT * FROM orders WHERE id=?').get(row.id)));
});

export default r;
