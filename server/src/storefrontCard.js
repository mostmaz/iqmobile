// What the storefront card on the home screen shows.
//
// The card used to be fixed: the three newest products. This makes it a
// choice — best sellers, most viewed, a hand-picked set, or a single banner
// image instead of tiles.
//
// The important detail is TOPPING UP. Real data is thin: at the time this
// was written the store had two products ever sold and four with any views
// at all. A "best sellers" card that renders one tile and two gaps looks
// broken, and the operator picking that mode has no way to know the shelf
// is that bare. So every mode fills its remaining slots from the default
// (newest with a photo) and reports how many slots it actually earned.

import { db, getSetting } from './db.js';

export const CARD_MODES = ['newest', 'best_selling', 'most_viewed', 'custom', 'banner'];
export const CARD_SLOTS = 3;

const setting = (k, d = '') => getSetting(k) ?? d;

/**
 * Settings key for one shop's card.
 *
 * These used to be bare globals ('storefront_card_mode'), which was fine only
 * while exactly one shop had ordering enabled: configuring a second shop
 * overwrote the first's card and unlinked its banner file, with the dashboard
 * showing the winner's settings under the loser's name. Migration v8 moved the
 * old global values onto the shop that was actually being served.
 */
export const cardSettingKey = (shopId, name) => `storefront_card_${name}:${Number(shopId)}`;

export function readCardConfig(shopId) {
  const k = (name) => cardSettingKey(shopId, name);
  const raw = setting(k('mode'), 'newest');
  return {
    mode: CARD_MODES.includes(raw) ? raw : 'newest',
    ids: String(setting(k('ids'), ''))
      .split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0),
    image: setting(k('image'), '') || null,
    title: setting(k('title'), '') || null,
  };
}

// A product here is a brand+model group, matching how the storefront itself
// counts — three capacities of one phone must not take all three slots.
const GROUP_SELECT = `
  SELECT MIN(l.id) AS lead_id, l.brand, GROUP_CONCAT(l.id) AS ids,
         MAX(CASE WHEN EXISTS(
           SELECT 1 FROM listing_images WHERE listing_id = l.id
         ) THEN 1 ELSE 0 END) AS has_image`;

const LIVE = `l.seller_id = ? AND l.status='active'
  AND COALESCE(l.price_on_request,0) = 0
  AND COALESCE(l.stock_qty, 1) > 0`;

function hydrate(groups) {
  return groups.map((g) => {
    const ids = String(g.ids || '').split(',').filter(Boolean).map(Number);
    const ph = ids.map(() => '?').join(',');
    const img = ids.length ? db.prepare(
      `SELECT image_path FROM listing_images WHERE listing_id IN (${ph})
        ORDER BY position ASC, id ASC LIMIT 1`,
    ).get(...ids) : null;
    // Price and storage from the cheapest variant, so the label and the
    // number describe the same device.
    const cheapest = db.prepare(
      `SELECT storage, asking_price FROM phone_listings WHERE id IN (${ph})
        ORDER BY asking_price ASC, id ASC LIMIT 1`,
    ).get(...ids);
    const lead = db.prepare('SELECT model FROM phone_listings WHERE id=?').get(g.lead_id);
    return {
      id: g.lead_id,
      brand: g.brand,
      model: String(lead?.model || '').trim(),
      storage: cheapest ? cheapest.storage : null,
      asking_price: cheapest ? cheapest.asking_price : 0,
      image_path: img ? img.image_path : null,
    };
  });
}

const defaultGroups = (shopId, limit) => db.prepare(
  `${GROUP_SELECT} FROM phone_listings l WHERE ${LIVE}
    GROUP BY l.brand, LOWER(TRIM(l.model))
    ORDER BY has_image DESC, MAX(l.created_at) DESC LIMIT ?`,
).all(shopId, limit);

// Units actually sold. Cancelled and returned orders are excluded — a device
// that came back is not a best seller.
const bestSellingGroups = (shopId, limit) => db.prepare(
  `${GROUP_SELECT},
          (SELECT COALESCE(SUM(oi.qty),0)
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.shop_id = l.seller_id AND o.status <> 'cancelled'
              AND o.returned_at IS NULL
              AND oi.brand = l.brand AND LOWER(TRIM(oi.model)) = LOWER(TRIM(l.model))
          ) AS sold_units
     FROM phone_listings l WHERE ${LIVE}
    GROUP BY l.brand, LOWER(TRIM(l.model))
    HAVING sold_units > 0
    ORDER BY sold_units DESC, has_image DESC LIMIT ?`,
).all(shopId, limit);

const mostViewedGroups = (shopId, limit, sinceMs) => db.prepare(
  `${GROUP_SELECT},
          (SELECT COUNT(*) FROM events e
            WHERE e.type='view' AND e.created_at >= ?
              AND e.listing_id IN (
                SELECT id FROM phone_listings x
                 WHERE x.seller_id = l.seller_id AND x.brand = l.brand
                   AND LOWER(TRIM(x.model)) = LOWER(TRIM(l.model))
              )
          ) AS views
     FROM phone_listings l WHERE ${LIVE}
    GROUP BY l.brand, LOWER(TRIM(l.model))
    HAVING views > 0
    ORDER BY views DESC, has_image DESC LIMIT ?`,
).all(sinceMs, shopId, limit);

// Hand-picked. Order follows the order the operator saved, not the DB's.
function customGroups(shopId, ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `${GROUP_SELECT} FROM phone_listings l
      WHERE ${LIVE} AND l.id IN (${ph})
      GROUP BY l.brand, LOWER(TRIM(l.model))`,
  ).all(shopId, ...ids);
  const pos = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (pos.get(a.lead_id) ?? 999) - (pos.get(b.lead_id) ?? 999));
}

const VIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Resolve the card for one shop.
 * @returns {{mode, title, banner_image, products, matched, topped_up}}
 *   `matched` is how many products the chosen mode actually produced, before
 *   top-up — the dashboard shows it so "best sellers" can't quietly mean
 *   "one best seller and two newest".
 */
export function resolveStorefrontCard(shopId, cfg = readCardConfig(shopId)) {
  if (cfg.mode === 'banner' && cfg.image) {
    return { mode: 'banner', title: cfg.title, banner_image: cfg.image, products: [], matched: 0, topped_up: 0 };
  }

  let groups = [];
  if (cfg.mode === 'best_selling') groups = bestSellingGroups(shopId, CARD_SLOTS);
  else if (cfg.mode === 'most_viewed') groups = mostViewedGroups(shopId, CARD_SLOTS, Date.now() - VIEW_WINDOW_MS);
  else if (cfg.mode === 'custom') groups = customGroups(shopId, cfg.ids).slice(0, CARD_SLOTS);
  // 'newest' IS the fallback, so its own picks are matches, not top-ups —
  // otherwise the dashboard would report "0 matched, 3 topped up" for the
  // one mode that always has exactly what it asked for.
  else groups = defaultGroups(shopId, CARD_SLOTS);

  const matched = groups.length;
  if (groups.length < CARD_SLOTS) {
    const have = new Set(groups.map((g) => g.lead_id));
    for (const g of defaultGroups(shopId, CARD_SLOTS * 3)) {
      if (groups.length >= CARD_SLOTS) break;
      if (have.has(g.lead_id)) continue;
      groups.push(g);
      have.add(g.lead_id);
    }
  }

  return {
    // Report the mode the operator CHOSE even when it was topped up — the app
    // labels the card from this, and silently relabelling it "newest" because
    // the shop is quiet would be its own kind of lie.
    mode: cfg.mode === 'banner' ? 'newest' : cfg.mode,
    title: cfg.title,
    banner_image: null,
    products: hydrate(groups),
    matched,
    topped_up: Math.max(0, groups.length - matched),
  };
}

/** How many products each mode could fill right now — for the dashboard. */
export function cardModeCounts(shopId) {
  return {
    newest: defaultGroups(shopId, 99).length,
    best_selling: bestSellingGroups(shopId, 99).length,
    most_viewed: mostViewedGroups(shopId, 99, Date.now() - VIEW_WINDOW_MS).length,
  };
}
