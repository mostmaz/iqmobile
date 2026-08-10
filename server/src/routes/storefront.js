// Storefront API — the shop-as-e-commerce view.
//
// The marketplace's unit is a LISTING: one physical device, one price. A
// storefront's unit is a PRODUCT the customer picks options on ("Realme
// C100i" in 64/128/256 GB). Rather than migrate 161 rows into a new
// products+variants schema, this derives products by grouping the shop's
// listings on brand + normalised model. Each listing becomes a variant, and
// because a variant IS a listing, checkout keeps working unchanged —
// order_items already reference listing_id.
//
// That grouping is the whole design. It means the dashboard's "add product"
// stays exactly as it is: add the same model twice with different storage and
// the storefront shows one product with two options.

import { Router } from 'express';
import { db } from '../db.js';
import { expandQuery, arabicNormalizeSql } from '../searchNormalize.js';
import { PRODUCT_TYPES } from '../productType.js';

const r = Router();

const PAGE = 24;
const MAX_PAGE = 60;
const SORTS = {
  // Photoless products sort last within "newest". A tile with no image is a
  // grey box, and four of them across the top row is the first thing a
  // shopper sees — it reads as a broken store, not a new arrival. Explicit
  // price sorts below stay purely about price.
  newest: 'has_image DESC, MAX(l.created_at) DESC',
  // Unpriced items carry a placeholder asking_price, so they'd win "cheapest
  // first" outright and lead "most expensive" backwards. Push them last in
  // both directions instead of pretending the placeholder is a price.
  price_asc: 'MIN(COALESCE(l.price_on_request,0)) ASC, MIN(l.asking_price) ASC',
  price_desc: 'MIN(COALESCE(l.price_on_request,0)) ASC, MIN(l.asking_price) DESC',
};

// Products are keyed on brand + case/space-insensitive model so "iPhone 16"
// and "iphone  16" collapse into one product rather than two near-identical
// tiles. Mirrored in SQL below via LOWER(TRIM(model)).
const productKey = (brand, model) => `${brand}|${String(model).trim().toLowerCase()}`;

function loadShop(id) {
  return db.prepare(
    `SELECT id, shop_name, display_name, shop_phone, shop_shipping_fee
       FROM users
      WHERE id=? AND seller_type='shop' AND COALESCE(shop_orders_enabled,0)=1`,
  ).get(id);
}

// ─── storefront home: shop + categories ───────────────────────────────
r.get('/storefront/:id(\\d+)', (req, res) => {
  const shop = loadShop(req.params.id);
  if (!shop) return res.status(404).json({ error: 'not_found' });

  // Categories are brands, counted by PRODUCT not listing — a model stocked
  // in three capacities is one thing to browse, and a count that disagrees
  // with the grid below reads as a bug.
  const categories = db.prepare(
    `SELECT brand, COUNT(*) AS count FROM (
       SELECT brand FROM phone_listings
        WHERE seller_id=? AND status='active' AND COALESCE(stock_qty, 1) > 0
        GROUP BY brand, LOWER(TRIM(model))
     ) GROUP BY brand ORDER BY count DESC, brand ASC`,
  ).all(shop.id);

  // Product types are the OTHER axis, and the more useful one here: brand
  // chips can't answer "show me tablets" when Honor is a phone, a tablet and
  // five pairs of earbuds. Same product-level counting as brands. NULL means
  // phone (see db.js), and types with nothing in stock are omitted rather
  // than shown as an empty chip.
  const types = db.prepare(
    `SELECT type, COUNT(*) AS count FROM (
       SELECT COALESCE(product_type, 'phone') AS type FROM phone_listings
        WHERE seller_id=? AND status='active' AND COALESCE(stock_qty, 1) > 0
        GROUP BY brand, LOWER(TRIM(model))
     ) GROUP BY type ORDER BY count DESC, type ASC`,
  ).all(shop.id);

  // Two different questions, so two different filters. The COUNT must match
  // what the grid actually shows — including call-for-price products, or the
  // header disagrees with the tiles below it and reads as a bug. The price
  // RANGE must exclude them, because their asking_price is a placeholder and
  // would advertise the shop as starting from 1 IQD.
  const totals = db.prepare(
    `SELECT COUNT(*) AS products FROM (
       SELECT 1 FROM phone_listings
        WHERE seller_id=? AND status='active' AND COALESCE(stock_qty, 1) > 0
        GROUP BY brand, LOWER(TRIM(model))
     )`,
  ).get(shop.id);
  const priceRange = db.prepare(
    `SELECT MIN(p) AS min_price, MAX(p) AS max_price FROM (
       SELECT MIN(asking_price) AS p FROM phone_listings
        WHERE seller_id=? AND status='active' AND COALESCE(stock_qty, 1) > 0
          AND COALESCE(price_on_request,0) = 0
        GROUP BY brand, LOWER(TRIM(model))
     )`,
  ).get(shop.id);

  res.json({
    shop: {
      id: shop.id,
      name: shop.shop_name || shop.display_name,
      phone: shop.shop_phone || null,
      shipping_fee: Number(shop.shop_shipping_fee) || 0,
    },
    categories,
    types,
    product_count: totals.products || 0,
    min_price: priceRange.min_price ?? null,
    max_price: priceRange.max_price ?? null,
  });
});

// ─── product grid: search + category + sort + paging ──────────────────
r.get('/storefront/:id(\\d+)/products', (req, res) => {
  const shop = loadShop(req.params.id);
  if (!shop) return res.status(404).json({ error: 'not_found' });

  const q = String(req.query.q || '').trim().slice(0, 60);
  const brand = String(req.query.brand || '').trim();
  const type = String(req.query.type || '').trim().toLowerCase();
  const sort = SORTS[req.query.sort] ? req.query.sort : 'newest';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE, 1), MAX_PAGE);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const minPrice = Number(req.query.min_price);
  const maxPrice = Number(req.query.max_price);

  // Sold out means gone from the shelf: a tile you can open but never buy
  // is worse than no tile. NULL stock is untracked, hence COALESCE to 1.
  const conds = ["l.seller_id = ?", "l.status = 'active'", "COALESCE(l.stock_qty, 1) > 0"];
  const params = [shop.id];
  if (brand) { conds.push('l.brand = ?'); params.push(brand); }
  // NULL product_type means phone, so filtering for phones has to match the
  // un-backfilled rows too.
  if (PRODUCT_TYPES.includes(type)) {
    conds.push(type === 'phone'
      ? "COALESCE(l.product_type, 'phone') = 'phone'"
      : 'l.product_type = ?');
    if (type !== 'phone') params.push(type);
  }
  if (Number.isFinite(minPrice) && minPrice > 0) { conds.push('l.asking_price >= ?'); params.push(minPrice); }
  if (Number.isFinite(maxPrice) && maxPrice > 0) { conds.push('l.asking_price <= ?'); params.push(maxPrice); }
  if (q) {
    const like = `%${q}%`;
    // Same Arabic-normalised match the marketplace search uses, so a shopper
    // typing "ايفون" finds listings stored as "iPhone".
    conds.push(`(l.brand LIKE ? OR l.model LIKE ? OR ${arabicNormalizeSql('l.model')} LIKE ?)`);
    const norm = (expandQuery(q).pop() || q).toLowerCase().replace(/\s+/g, '');
    params.push(like, like, `%${norm}%`);
  }
  const where = `WHERE ${conds.join(' AND ')}`;

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT 1 FROM phone_listings l ${where} GROUP BY l.brand, LOWER(TRIM(l.model))
     )`,
  ).get(...params).n;

  // The cover image can't be a correlated subquery here: SQLite rejects
  // `WHERE listing_id = MIN(l.id)` as "misuse of aggregate function". So the
  // group query returns the representative listing ids and images are
  // resolved in one follow-up query.
  const rows = db.prepare(
    `SELECT l.brand,
            MIN(l.model) AS model_fallback,
            COUNT(*) AS variant_count,
            MIN(l.asking_price) AS min_price,
            MAX(l.asking_price) AS max_price,
            MAX(l.created_at) AS newest_at,
            MIN(l.id) AS lead_id,
            MIN(COALESCE(l.price_on_request,0)) AS all_on_request,
            MAX(CASE WHEN EXISTS(
              SELECT 1 FROM listing_images WHERE listing_id = l.id
            ) THEN 1 ELSE 0 END) AS has_image,
            GROUP_CONCAT(l.id) AS variant_ids
       FROM phone_listings l
      ${where}
      GROUP BY l.brand, LOWER(TRIM(l.model))
      ORDER BY ${SORTS[sort]}
      LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  // Photos often sit on a variant that isn't the lead one, so look across
  // every listing in the group and take the first that has an image —
  // otherwise a product whose 64GB row has no photo renders as a blank tile.
  const allIds = rows.flatMap((p) => String(p.variant_ids || '').split(',').filter(Boolean).map(Number));
  const coverByListing = new Map();
  const modelById = new Map();
  if (allIds.length) {
    const ph = allIds.map(() => '?').join(',');
    for (const im of db.prepare(
      `SELECT listing_id, image_path FROM listing_images
        WHERE listing_id IN (${ph}) ORDER BY position ASC, id ASC`,
    ).all(...allIds)) {
      if (!coverByListing.has(im.listing_id)) coverByListing.set(im.listing_id, im.image_path);
    }
    for (const m of db.prepare(`SELECT id, model FROM phone_listings WHERE id IN (${ph})`).all(...allIds)) {
      modelById.set(m.id, m.model);
    }
  }

  res.json({
    total,
    limit,
    offset,
    products: rows.map((p) => {
      const ids = String(p.variant_ids || '').split(',').filter(Boolean).map(Number);
      const image_path = ids.map((id) => coverByListing.get(id)).find(Boolean) || null;
      // Display the spelling from the earliest-added variant, not SQL's
      // MIN(model) — that's a lexical pick, so a stray " c100i " with a
      // leading space would beat the properly-cased "C100i".
      const model = String(modelById.get(p.lead_id) || p.model_fallback || '').trim();
      // MIN over the group: the tile only says "call for price" when EVERY
      // variant is unpriced. One priced capacity means there's a real number
      // to show, and hiding it would lose a sale.
      const { variant_ids, model_fallback, all_on_request, has_image, ...rest } = p;
      return {
        ...rest,
        model,
        image_path,
        price_on_request: !!all_on_request,
        key: productKey(p.brand, model),
      };
    }),
  });
});

// ─── product detail: every variant of one model ───────────────────────
r.get('/storefront/:id(\\d+)/product', (req, res) => {
  const shop = loadShop(req.params.id);
  if (!shop) return res.status(404).json({ error: 'not_found' });

  const brand = String(req.query.brand || '').trim();
  const model = String(req.query.model || '').trim();
  if (!brand || !model) return res.status(400).json({ error: 'brand_and_model_required' });

  const variants = db.prepare(
    `SELECT id, brand, model, storage, color, condition, asking_price, description, created_at,
            stock_qty, COALESCE(price_on_request,0) AS price_on_request, specs_json
       FROM phone_listings
      WHERE seller_id=? AND status='active' AND COALESCE(stock_qty, 1) > 0
        AND brand=? AND LOWER(TRIM(model))=LOWER(TRIM(?))
      ORDER BY asking_price ASC`,
  ).all(shop.id, brand, model);
  if (!variants.length) return res.status(404).json({ error: 'not_found' });

  const imgStmt = db.prepare(
    'SELECT id, image_path, position FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC',
  );
  // Photos usually live on whichever variant was added first, so pool them
  // across the group — otherwise picking the 256GB option can blank the
  // gallery. Deduped by path because shops often upload the same shots twice.
  const seen = new Set();
  const images = [];
  const withImages = variants.map((v) => {
    const own = imgStmt.all(v.id);
    for (const im of own) {
      if (seen.has(im.image_path)) continue;
      seen.add(im.image_path);
      images.push(im);
    }
    const { specs_json, ...rest } = v;
    return { ...rest, images: own };
  });

  // Same rule as the grid: name the product after its earliest-added variant
  // so both screens show one identical title.
  const lead = variants.reduce((a, b) => (a.id <= b.id ? a : b));

  // Specs are written to every variant together, but a product imported
  // before that could have them on only one row — so take the first variant
  // that actually has any rather than trusting the lead.
  const specs = (() => {
    for (const v of [lead, ...variants]) {
      if (!v.specs_json) continue;
      try {
        const arr = JSON.parse(v.specs_json);
        if (Array.isArray(arr) && arr.length) return arr;
      } catch { /* malformed row — keep looking */ }
    }
    return [];
  })();

  res.json({
    brand: lead.brand,
    model: String(lead.model || '').trim(),
    // The longest description across variants — they're usually identical,
    // and an empty one on the cheapest variant shouldn't win.
    description: withImages.map((v) => v.description || '').sort((a, b) => b.length - a.length)[0] || null,
    images,
    min_price: Math.min(...variants.map((v) => v.asking_price)),
    max_price: Math.max(...variants.map((v) => v.asking_price)),
    price_on_request: variants.every((v) => v.price_on_request),
    specs,
    storages: [...new Set(variants.map((v) => v.storage).filter(Boolean))],
    colors: [...new Set(variants.map((v) => v.color).filter(Boolean))],
    variants: withImages,
    shop: {
      id: shop.id,
      name: shop.shop_name || shop.display_name,
      phone: shop.shop_phone || null,
      shipping_fee: Number(shop.shop_shipping_fee) || 0,
    },
  });
});

export default r;
