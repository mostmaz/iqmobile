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
import { notify } from '../../notify.js';
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
  // ─── traffic: views, calls, and what they led to ───────────────────
  //
  // Separate from /stats on purpose. That endpoint answers "how is the shop
  // selling" — orders, margin, stock. This one answers "how is the shop being
  // used" — who looked, who called, which products pull attention and which
  // pull a phone call. They share a shop but not a question, and cramming
  // both into one payload made the page load two charts nobody read together.
  r.get('/store/:id(\\d+)/traffic', requireAdmin, (req, res) => {
    const shopId = Number(req.params.id);
    const now = Date.now();
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const since = now - days * 86400000;
    const prevSince = since - days * 86400000;

    // The CURRENT window is open-ended at the top — no `created_at < now`.
    // The daily series and the per-product table below filter on `>= since`
    // alone, and an upper bound here would let the KPI disagree with the
    // chart drawn directly beneath it over any event that landed between the
    // two queries. Nothing is in the future, so the bound bought nothing.
    const countSince = (type, from) => db.prepare(
      `SELECT COUNT(*) AS n FROM events
        WHERE shop_id=? AND type=? AND created_at >= ?`,
    ).get(shopId, type, from).n;

    // The PREVIOUS window genuinely needs both ends.
    const countBetween = (type, from, to) => db.prepare(
      `SELECT COUNT(*) AS n FROM events
        WHERE shop_id=? AND type=? AND created_at >= ? AND created_at < ?`,
    ).get(shopId, type, from, to).n;

    const views = countSince('store_view', since);
    const calls = countSince('store_call', since);
    // Same-length window immediately before, so "up or down" is answerable
    // without the operator holding last month's number in their head.
    const prevViews = countBetween('store_view', prevSince, since);
    const prevCalls = countBetween('store_call', prevSince, since);

    // "Browse" = someone opened the shop itself, product or no product.
    // Two event types because the shop has two front doors: store_browse is
    // the storefront home (IQ Mobile store), shop_view the classic shop page
    // (how the hidden price-book shop is entered from the home banner).
    const browseCount = (from, to) => db.prepare(
      `SELECT COUNT(*) AS n FROM events
        WHERE shop_id=? AND type IN ('store_browse','shop_view')
          AND created_at >= ? ${to ? 'AND created_at < ?' : ''}`,
    ).get(...(to ? [shopId, from, to] : [shopId, from])).n;
    const browses = browseCount(since, null);
    const prevBrowses = browseCount(prevSince, since);

    // People, not requests: distinct signed-in accounts that touched the
    // shop this window. Guests can't be deduplicated (no id to dedupe on),
    // so they're reported as raw browse events alongside — two honest
    // numbers instead of one inflated "visitors".
    const uniqueViewers = db.prepare(
      `SELECT COUNT(DISTINCT user_id) AS n FROM events
        WHERE shop_id=? AND user_id IS NOT NULL
          AND type IN ('store_browse','shop_view','store_view','store_call')
          AND created_at >= ?`,
    ).get(shopId, since).n;
    const guestBrowses = db.prepare(
      `SELECT COUNT(*) AS n FROM events
        WHERE shop_id=? AND user_id IS NULL
          AND type IN ('store_browse','shop_view')
          AND created_at >= ?`,
    ).get(shopId, since).n;

    const orders = db.prepare(
      `SELECT COUNT(*) AS n FROM orders WHERE shop_id=? AND created_at >= ?`,
    ).get(shopId, since).n;

    // Daily series for the chart. Bucketed in SQL by Baghdad day — the same
    // dayStart() the orders chart uses, so the two line up on the x-axis.
    const daily = db.prepare(
      `SELECT
         CAST((created_at - ?) / 86400000 AS INTEGER) AS bucket,
         SUM(CASE WHEN type='store_view' THEN 1 ELSE 0 END) AS views,
         SUM(CASE WHEN type='store_call' THEN 1 ELSE 0 END) AS calls,
         SUM(CASE WHEN type IN ('store_browse','shop_view') THEN 1 ELSE 0 END) AS browses
       FROM events
       WHERE shop_id=? AND type IN ('store_view','store_call','store_browse','shop_view')
         AND created_at >= ?
       GROUP BY bucket ORDER BY bucket ASC`,
    ).all(since, shopId, since);

    // Per-product, joined back to the listing so a product that has since
    // been renamed still reports under its current name.
    const byProduct = db.prepare(
      `SELECT l.brand, l.model,
              SUM(CASE WHEN e.type='store_view' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN e.type='store_call' THEN 1 ELSE 0 END) AS calls
         FROM events e JOIN phone_listings l ON l.id = e.listing_id
        WHERE e.shop_id=? AND e.type IN ('store_view','store_call')
          AND e.created_at >= ?
        GROUP BY l.brand, LOWER(TRIM(l.model))
        ORDER BY calls DESC, views DESC
        LIMIT 20`,
    ).all(shopId, since);

    // Calls with no product attached come from the store's own home screen.
    const homeCalls = db.prepare(
      `SELECT COUNT(*) AS n FROM events
        WHERE shop_id=? AND type='store_call' AND listing_id IS NULL AND created_at >= ?`,
    ).get(shopId, since).n;

    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

    res.json({
      window_days: days,
      views,
      calls,
      orders,
      home_calls: homeCalls,
      browses,
      unique_viewers: uniqueViewers,
      guest_browses: guestBrowses,
      prev: { views: prevViews, calls: prevCalls, browses: prevBrowses },
      // Nulls, not zeros, when the denominator is empty — "0% of nobody
      // called" reads as a problem when it is simply no data yet.
      call_rate: pct(calls, views),
      order_rate: pct(orders, views),
      daily,
      by_product: byProduct,
      // So the page can say WHY it is empty rather than drawing a blank
      // chart: this data only exists from the day tracking shipped.
      tracking_since: db.prepare(
        `SELECT MIN(created_at) AS t FROM events
          WHERE shop_id=? AND type IN ('store_view','store_call','store_browse','shop_view')`,
      ).get(shopId).t,
    });
  });

  // ─── storefront chats, read and answered from the operator app ─────
  //
  // The storefront's own login is never signed in — chats to it were only
  // reachable through the manager's personal account in the customer app.
  // These endpoints give the operator app the same thread, and replies are
  // written AS the shop account, so the buyer sees "IQ Mobile" answering,
  // not whichever operator happened to pick it up.

  // The set of shops whose chats the operators answer: the order-taking
  // storefront plus the hidden price book. Discovered by flags, same as
  // app-config does, so moving either to a new account keeps working.
  const managedShops = () => db.prepare(
    `SELECT id, shop_name, display_name FROM users
      WHERE seller_type='shop'
        AND (COALESCE(shop_orders_enabled,0)=1 OR COALESCE(shop_hidden,0)=1)`,
  ).all();

  r.get('/store/chats', requireAdmin, (req, res) => {
    const shops = managedShops();
    if (!shops.length) return res.json({ chats: [], unread_total: 0 });
    const ids = shops.map((x) => x.id);
    const ph = ids.map(() => '?').join(',');
    const nameOf = new Map(shops.map((x) => [x.id, x.shop_name || x.display_name]));
    const rows = db.prepare(
      `SELECT c.id, c.listing_id, c.buyer_id, c.last_message_at, c.created_at,
              c.seller_last_read_at,
              u.display_name AS buyer_name, u.phone AS buyer_phone,
              l.brand, l.model, l.asking_price,
              (SELECT body FROM chat_messages m
                WHERE m.chat_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
              (SELECT image_path IS NOT NULL FROM chat_messages m
                WHERE m.chat_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_is_image,
              c.seller_id,
              (SELECT COUNT(*) FROM chat_messages m
                WHERE m.chat_id = c.id AND m.sender_id = c.buyer_id
                  AND m.created_at > COALESCE(c.seller_last_read_at, 0)) AS unread
         FROM chats c
         JOIN users u ON u.id = c.buyer_id
         LEFT JOIN phone_listings l ON l.id = c.listing_id
        WHERE c.seller_id IN (${ph})
        ORDER BY c.last_message_at DESC LIMIT 100`,
    ).all(...ids);
    res.json({
      chats: rows.map((r2) => ({
        ...r2,
        last_is_image: !!r2.last_is_image,
        shop_name: nameOf.get(r2.seller_id) || null,
      })),
      unread_total: rows.reduce((a, r2) => a + (r2.unread || 0), 0),
    });
  });

  r.get('/store/chats/:chatId(\\d+)', requireAdmin, (req, res) => {
    const ids = managedShops().map((x) => x.id);
    const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.chatId);
    if (!chat || !ids.includes(chat.seller_id)) return res.status(404).json({ error: 'not_found' });

    const messages = db.prepare(
      `SELECT m.id, m.sender_id, m.body, m.image_path, m.created_at,
              u.display_name AS sender_name
         FROM chat_messages m JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id=? ORDER BY m.created_at ASC LIMIT 500`,
    ).all(chat.id);

    // Reading it from the operator app IS the shop reading it — clear the
    // unread pip everywhere, including the manager's customer app.
    db.prepare('UPDATE chats SET seller_last_read_at=? WHERE id=?').run(Date.now(), chat.id);

    const listing = chat.listing_id
      ? db.prepare('SELECT id, brand, model, asking_price, status FROM phone_listings WHERE id=?')
        .get(chat.listing_id)
      : null;
    const buyer = db.prepare(
      'SELECT id, display_name, phone, governorate FROM users WHERE id=?',
    ).get(chat.buyer_id);

    res.json({ chat: { id: chat.id, created_at: chat.created_at }, buyer, listing, messages });
  });

  r.post('/store/chats/:chatId(\\d+)/messages', requireAdmin, (req, res) => {
    const ids = managedShops().map((x) => x.id);
    const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.chatId);
    if (!chat || !ids.includes(chat.seller_id)) return res.status(404).json({ error: 'not_found' });

    const body = String(req.body?.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'empty_message' });

    // sender_id is the SHOP, not the admin: the buyer's thread shows the
    // store answering under its own name, and nothing in the customer app
    // needs to learn a new author type.
    const t = Date.now();
    const ins = db.prepare(
      'INSERT INTO chat_messages(chat_id, sender_id, body, image_path, masked, created_at) VALUES(?,?,?,NULL,0,?)',
    ).run(chat.id, chat.seller_id, body, t);
    db.prepare('UPDATE chats SET last_message_at=?, seller_last_read_at=? WHERE id=?')
      .run(t, t, chat.id);

    const msg = db.prepare(
      `SELECT m.id, m.chat_id, m.sender_id, m.body, m.image_path, m.masked, m.created_at,
              u.display_name AS sender_name
         FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id=?`,
    ).get(ins.lastInsertRowid);

    // Same kind and payload shape as a normal chat message, so every
    // existing build renders it correctly — no new KIND_LABEL needed.
    notify(chat.buyer_id, 'chat.message', { chat_id: chat.id, message: msg }, {
      title: 'رسالة جديدة',
      body: body.slice(0, 80),
    });

    res.json(msg);
  });

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
