// Store management: the numbers behind one storefront, and its customers.
//
// Cash on delivery makes the obvious "revenue" number a lie. An order that
// was placed is not money — in Iraq a meaningful share of COD orders are
// refused at the door, and the shop eats the courier fee. So every figure
// here separates what was PLACED from what was actually DELIVERED, and the
// customer view is built around who refuses deliveries, because that is the
// shop's real loss and it is invisible in an order list sorted by date.

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, setSettingValue } from '../../db.js';
import {
  CARD_MODES, CARD_SLOTS, readCardConfig, resolveStorefrontCard, cardModeCounts,
} from '../../storefrontCard.js';

const r = Router();

// A day in Baghdad, not UTC — "today's orders" has to mean the shop's today.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const dayStart = (ms) => {
  const d = new Date(ms + TZ_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - TZ_OFFSET_MS;
};

const OPEN = "('pending','confirmed','shipped')";

export function registerStoreRoutes(requireAdmin, imageUpload, UPLOADS) {
  // ─── home-screen card ──────────────────────────────────────────────
  // What the storefront card shows: newest / best sellers / most viewed /
  // hand-picked / a banner image instead of tiles.
  r.get('/store/:id(\\d+)/card', requireAdmin, (req, res) => {
    const shopId = Number(req.params.id);
    const cfg = readCardConfig();
    const preview = resolveStorefrontCard(shopId, cfg);
    // Counts let the operator see BEFORE choosing that "best sellers" can
    // currently fill one slot out of three — otherwise the mode silently
    // becomes "one best seller and two newest".
    res.json({
      config: cfg,
      slots: CARD_SLOTS,
      counts: cardModeCounts(shopId),
      preview,
      // Candidates for hand-picking: one row per product, newest first.
      // No cover image here on purpose — SQLite rejects MIN() inside a
      // correlated subquery, and the picker is a searchable text list.
      candidates: db.prepare(
        `SELECT MIN(l.id) AS id, l.brand, MIN(l.model) AS model,
                MIN(l.asking_price) AS asking_price,
                MIN(COALESCE(l.price_on_request,0)) AS price_on_request
           FROM phone_listings l
          WHERE l.seller_id=? AND l.status='active'
            AND COALESCE(l.stock_qty,1) > 0
          GROUP BY l.brand, LOWER(TRIM(l.model))
          ORDER BY MAX(l.created_at) DESC LIMIT 300`,
      ).all(shopId).map((c) => ({ ...c, price_on_request: c.price_on_request === 1 })),
      // Why the picker still doesn't list EVERYTHING the shop sells. Only
      // sold-out products are held back now — price-on-request ones are
      // pickable and render as "السعر عند الطلب" with a call button.
      // Reported rather than silently dropped, so the operator isn't left
      // hunting for a device that was never in the list.
      excluded: db.prepare(
        `SELECT SUM(CASE WHEN COALESCE(stock_qty,1) <= 0 THEN 1 ELSE 0 END) AS out_of_stock
         FROM (SELECT MAX(COALESCE(stock_qty,1)) AS stock_qty
                 FROM phone_listings
                WHERE seller_id=? AND status='active'
                GROUP BY brand, LOWER(TRIM(model)))`,
      ).get(shopId),
    });
  });

  r.patch('/store/:id(\\d+)/card', requireAdmin, (req, res) => {
    const b = req.body || {};
    if (b.mode !== undefined) {
      if (!CARD_MODES.includes(b.mode)) return res.status(400).json({ error: 'bad_mode' });
      setSettingValue('storefront_card_mode', b.mode);
    }
    if (b.ids !== undefined) {
      const ids = (Array.isArray(b.ids) ? b.ids : [])
        .map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, CARD_SLOTS);
      setSettingValue('storefront_card_ids', ids.join(','));
    }
    if (b.title !== undefined) {
      setSettingValue('storefront_card_title', String(b.title || '').trim().slice(0, 60));
    }
    const cfg = readCardConfig();
    res.json({ ok: true, config: cfg, preview: resolveStorefrontCard(Number(req.params.id), cfg) });
  });

  r.post('/store/:id(\\d+)/card/image', requireAdmin, imageUpload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const prev = readCardConfig().image;
    // Drop the previous banner so uploads don't pile up in the uploads dir.
    if (prev && prev.startsWith('/uploads/')) {
      try { fs.unlinkSync(path.join(UPLOADS, path.basename(prev))); } catch { /* already gone */ }
    }
    const p = '/uploads/' + req.file.filename;
    setSettingValue('storefront_card_image', p);
    res.json({ ok: true, image: p });
  });

  // ─── KPI header ────────────────────────────────────────────────────
  r.get('/store/:id(\\d+)/stats', requireAdmin, (req, res) => {
    const shopId = Number(req.params.id);
    const now = Date.now();
    const today = dayStart(now);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const since = now - days * 86400000;

    const agg = (where, params) => db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS sum FROM orders WHERE shop_id=? ${where}`,
    ).get(shopId, ...params);

    const todayRow = agg('AND created_at >= ?', [today]);
    const windowAll = agg('AND created_at >= ?', [since]);
    // Delivered EXCLUDES returns. An order that came back is not revenue,
    // and counting it as such is the same lie as counting a placed order.
    const delivered = agg("AND status='delivered' AND returned_at IS NULL AND created_at >= ?", [since]);
    const returned = agg("AND returned_at IS NOT NULL AND created_at >= ?", [since]);
    const cancelled = agg("AND status='cancelled' AND created_at >= ?", [since]);
    const open = agg(`AND status IN ${OPEN}`, []);
    const pending = agg("AND status='pending'", []);

    // Deliberately from DELIVERED orders only: average order value computed
    // over placed orders flatters itself with everything that got refused.
    const aov = delivered.n ? Math.round(delivered.sum / delivered.n) : 0;

    // Margin on DELIVERED orders only, and only over lines whose cost is
    // actually known — averaging in a null cost as zero would report the
    // full sale price as profit and flatter the number badly. `covered`
    // says how much of the revenue the figure is based on, so a margin
    // computed from two priced lines out of fifty can't masquerade as fact.
    const marginRow = db.prepare(
      `SELECT COALESCE(SUM(oi.line_total),0) AS revenue,
              COALESCE(SUM(oi.unit_cost * oi.qty),0) AS cost,
              COUNT(*) AS lines_with_cost
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.shop_id=? AND o.status='delivered' AND o.returned_at IS NULL
          AND o.created_at >= ? AND oi.unit_cost IS NOT NULL`,
    ).get(shopId, since);
    const allLines = db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(oi.line_total),0) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.shop_id=? AND o.status='delivered' AND o.returned_at IS NULL
          AND o.created_at >= ?`,
    ).get(shopId, since);
    const profit = marginRow.revenue - marginRow.cost;
    const margin = {
      revenue: marginRow.revenue,
      cost: marginRow.cost,
      profit,
      pct: marginRow.revenue ? +(profit / marginRow.revenue * 100).toFixed(1) : null,
      lines_with_cost: marginRow.lines_with_cost,
      lines_total: allLines.n,
      covered_pct: allLines.revenue ? Math.round(marginRow.revenue / allLines.revenue * 100) : 0,
    };
    const cancelRate = windowAll.n ? +(cancelled.n / windowAll.n * 100).toFixed(1) : 0;
    const returnRate = windowAll.n ? +(returned.n / windowAll.n * 100).toFixed(1) : 0;

    // The customer pays a flat fee; the courier charges by governorate. The
    // gap is real money and invisible until both numbers sit together.
    const deliveryRow = db.prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(shipping_fee),0) AS charged,
              COALESCE(SUM(delivery_cost),0) AS paid
         FROM orders
        WHERE shop_id=? AND created_at >= ? AND delivery_cost IS NOT NULL`,
    ).get(shopId, since);
    const delivery = {
      orders_with_cost: deliveryRow.n,
      charged: deliveryRow.charged,
      paid: deliveryRow.paid,
      net: deliveryRow.charged - deliveryRow.paid,
    };

    const byStatus = db.prepare(
      'SELECT status, COUNT(*) AS n FROM orders WHERE shop_id=? GROUP BY status',
    ).all(shopId);

    // Daily series for a sparkline: placed vs delivered.
    const series = db.prepare(
      `SELECT (created_at / 86400000) AS bucket,
              COUNT(*) AS placed,
              SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN status='delivered' THEN total ELSE 0 END) AS revenue
         FROM orders WHERE shop_id=? AND created_at >= ?
        GROUP BY bucket ORDER BY bucket ASC`,
    ).all(shopId, since);

    const topProducts = db.prepare(
      `SELECT oi.brand, oi.model, SUM(oi.qty) AS units,
              SUM(CASE WHEN o.status='delivered' THEN oi.line_total ELSE 0 END) AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.shop_id=? AND o.created_at >= ? AND o.status <> 'cancelled'
        GROUP BY oi.brand, LOWER(TRIM(oi.model))
        ORDER BY units DESC, revenue DESC LIMIT 10`,
    ).all(shopId, since);

    // Stock that has never once been ordered — the money sitting on a shelf.
    const deadStock = db.prepare(
      `SELECT l.id, l.brand, l.model, l.storage, l.asking_price, l.created_at
         FROM phone_listings l
        WHERE l.seller_id=? AND l.status='active'
          AND NOT EXISTS (
            SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE oi.listing_id = l.id AND o.shop_id = l.seller_id
          )
        ORDER BY l.created_at ASC LIMIT 15`,
    ).all(shopId);

    const inventory = db.prepare(
      `SELECT COUNT(*) AS listings,
              COUNT(DISTINCT l.brand || '|' || LOWER(TRIM(l.model))) AS products,
              COALESCE(SUM(l.asking_price),0) AS retail_value,
              SUM(CASE WHEN l.stock_qty = 0 THEN 1 ELSE 0 END) AS out_of_stock,
              SUM(CASE WHEN l.stock_qty IS NOT NULL AND l.stock_qty > 0 AND l.stock_qty <= 2 THEN 1 ELSE 0 END) AS low_stock,
              SUM(CASE WHEN l.stock_qty IS NULL THEN 1 ELSE 0 END) AS untracked,
              COALESCE((SELECT SUM(c.cost_price) FROM listing_costs c
                          JOIN phone_listings pl ON pl.id = c.listing_id
                         WHERE pl.seller_id = l.seller_id AND pl.status='active'), 0) AS cost_value
         FROM phone_listings l WHERE l.seller_id=? AND l.status='active'`,
    ).get(shopId);

    res.json({
      today: { orders: todayRow.n, value: todayRow.sum },
      window_days: days,
      placed: { orders: windowAll.n, value: windowAll.sum },
      delivered: { orders: delivered.n, value: delivered.sum },
      cancelled: { orders: cancelled.n, value: cancelled.sum },
      returned: { orders: returned.n, value: returned.sum },
      open_orders: open.n,
      pending_orders: pending.n,
      aov,
      margin,
      cancel_rate: cancelRate,
      return_rate: returnRate,
      delivery,
      by_status: byStatus,
      series,
      top_products: topProducts,
      dead_stock: deadStock,
      inventory,
    });
  });

  // ─── customers ─────────────────────────────────────────────────────
  // The phone number is the identity: checkout collects one and most
  // customers order as guests, so user_id is usually null.
  r.get('/store/:id(\\d+)/customers', requireAdmin, (req, res) => {
    const shopId = Number(req.params.id);
    const q = String(req.query.q || '').trim();
    const sort = ['spend', 'orders', 'recent', 'risk'].includes(req.query.sort)
      ? req.query.sort : 'recent';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const where = ['o.shop_id = ?'];
    const params = [shopId];
    if (q) {
      where.push('(o.customer_phone LIKE ? OR o.customer_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const ORDER = {
      spend: 'delivered_value DESC',
      orders: 'orders DESC',
      recent: 'last_order_at DESC',
      risk: 'cancelled DESC, orders DESC',
    }[sort];

    const rows = db.prepare(
      `SELECT o.customer_phone AS phone,
              MAX(o.customer_name) AS name,
              COUNT(*) AS orders,
              SUM(CASE WHEN o.status='delivered' AND o.returned_at IS NULL THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN o.status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN o.returned_at IS NOT NULL THEN 1 ELSE 0 END) AS returned,
              SUM(CASE WHEN o.status IN ${OPEN} THEN 1 ELSE 0 END) AS open,
              COALESCE(SUM(CASE WHEN o.status='delivered' AND o.returned_at IS NULL THEN o.total ELSE 0 END),0) AS delivered_value,
              MAX(o.created_at) AS last_order_at,
              MIN(o.created_at) AS first_order_at,
              MAX(o.governorate) AS governorate
         FROM orders o
        WHERE ${where.join(' AND ')}
        GROUP BY o.customer_phone
        ORDER BY ${ORDER}
        LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset);

    const total = db.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM orders o WHERE ${where.join(' AND ')} GROUP BY o.customer_phone
       )`,
    ).get(...params).n;

    res.json({
      total,
      customers: rows.map((c) => ({
        ...c,
        repeat: c.delivered > 1,
        // Three or more refusals is the threshold worth acting on: below
        // that it's plausibly bad luck, above it it's a pattern, and the
        // shop should ask for prepayment before dispatching again.
        // A return costs the shop the same round trip a refusal does, so
        // both count toward the risk signal.
        risk: (c.cancelled + c.returned) >= 3 ? 'high' : (c.cancelled + c.returned) === 2 ? 'watch' : 'ok',
      })),
    });
  });

  // ─── one customer's history ────────────────────────────────────────
  r.get('/store/:id(\\d+)/customers/:phone', requireAdmin, (req, res) => {
    const shopId = Number(req.params.id);
    const phone = String(req.params.phone).slice(0, 20);
    const orders = db.prepare(
      `SELECT id, code, status, total, governorate, address, created_at, cancel_reason
         FROM orders WHERE shop_id=? AND customer_phone=? ORDER BY created_at DESC`,
    ).all(shopId, phone);
    if (!orders.length) return res.status(404).json({ error: 'not_found' });
    const items = db.prepare(
      `SELECT oi.order_id, oi.brand, oi.model, oi.storage, oi.qty, oi.line_total
         FROM order_items oi WHERE oi.order_id IN (${orders.map(() => '?').join(',')})`,
    ).all(...orders.map((o) => o.id));
    for (const o of orders) o.items = items.filter((i) => i.order_id === o.id);
    res.json({ phone, orders });
  });

  return r;
}
