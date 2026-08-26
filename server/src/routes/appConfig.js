// GET /app-config — everything the app needs to know that an operator can
// change without shipping a release.
//
// Two things live here today:
//   update  — the minimum/nag version floors, so a broken old build can be
//             pushed off without waiting for people to update voluntarily.
//   overlay — a dashboard-controlled interstitial over the home feed
//             (sponsor, promo, service notice).
//
// Public and unauthenticated on purpose: the app must be able to read the
// update floor even when its token is stale or it can't authenticate, which
// is exactly the situation a forced update often needs to resolve.

import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { resolveStorefrontCard, houseShopId } from '../storefrontCard.js';

const r = Router();

const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://api.iqmobile.org').replace(/\/+$/, '');

/**
 * Compare dotted version strings numerically: '0.1.10' > '0.1.9', which a
 * string compare gets backwards. Missing segments count as 0, so '0.2' and
 * '0.2.0' are equal. Anything unparseable sorts lowest, so a client sending
 * junk is treated as old rather than as up to date.
 */
export function cmpVersion(a = '0', b = '0') {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

r.get('/app-config', (_req, res) => {
  const image = getSetting('overlay_image') || '';
  const overlayOn = getSetting('overlay_enabled') === '1';

  // The aggregator price shop, so the home screen's "new device prices" row
  // knows where to go. Looked up by the shop_hidden flag rather than shipped
  // as a constant: the shop is invisible in /shops by design, so the app has
  // no other way to discover its id, and hardcoding one would silently break
  // the row if the price book ever moves to a different shop.
  // Null when no hidden shop exists — the app hides the row rather than
  // offering a link that dead-ends.
  const priceShop = db.prepare(
    "SELECT id FROM users WHERE seller_type='shop' AND COALESCE(shop_hidden,0)=1 ORDER BY id ASC LIMIT 1",
  ).get();

  // The order-taking storefront, plus enough of its stock to render the home
  // card in ONE request — three products with prices is what makes the card
  // read as a shop rather than another link.
  //
  // Returns null unless the shop actually has something to sell. A storefront
  // card showing three empty boxes is worse than no card, and the app has no
  // way to know the shelf is bare without asking.
  const storefront = (() => {
    const hid = houseShopId();
    const shop = hid ? db.prepare(
      `SELECT id, shop_name, display_name, shop_shipping_fee FROM users
        WHERE id=? AND seller_type='shop' AND COALESCE(shop_orders_enabled,0)=1`,
    ).get(hid) : null;
    if (!shop) return null;

    // Grouped by brand + model, exactly like /storefront/:id — a shop
    // stocking one phone in three capacities has ONE product, and three
    // teaser tiles that all open the same page would look broken. This also
    // keeps product_count agreeing with the number the store screen shows.
    const total = db.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM phone_listings WHERE seller_id=? AND status='active'
          AND COALESCE(stock_qty, 1) > 0
          GROUP BY brand, LOWER(TRIM(model))
       )`,
    ).get(shop.id).n;
    if (!total) return null;

    // What the card shows is now an operator choice — best sellers, most
    // viewed, hand-picked, or a banner image instead of tiles. See
    // src/storefrontCard.js; it also tops up thin modes so the card never
    // renders with gaps.
    const card = resolveStorefrontCard(shop.id);

    return {
      shop_id: shop.id,
      shop_name: shop.shop_name || shop.display_name,
      shipping_fee: Number(shop.shop_shipping_fee) || 0,
      product_count: total,
      card_mode: card.mode,
      card_title: card.title,
      banner_image: card.banner_image
        ? (card.banner_image.startsWith('http') ? card.banner_image : PUBLIC_BASE + card.banner_image)
        : null,
      products: card.products,
    };
  })();

  // Home-hub "كل المتاجر" segment: three dashboard-picked shops (app_settings
  // key 'home_shops' = JSON array of user ids), topped up automatically —
  // featured first, then the biggest active inventories — so the segment
  // never renders half-empty when nothing was picked.
  const homeShops = (() => {
    const nowTs = Date.now();
    let picked = [];
    try {
      const v = JSON.parse(getSetting('home_shops') || '[]');
      if (Array.isArray(v)) picked = v.map(Number).filter(Number.isFinite);
    } catch {}
    const baseSql = `SELECT id, shop_name, display_name, city, governorate,
        shop_image_path, profile_image_path
      FROM users WHERE seller_type='shop'
        AND COALESCE(shop_hidden,0)=0 AND COALESCE(shop_status,'approved')='approved'`;
    let rows = picked
      .map((pid) => db.prepare(baseSql + ' AND id=?').get(pid))
      .filter(Boolean)
      .slice(0, 3);
    if (rows.length < 3) {
      const exclude = rows.map((r) => r.id);
      const fill = db.prepare(baseSql + `
          AND id NOT IN (${exclude.length ? exclude.map(() => '?').join(',') : '0'})
        ORDER BY (CASE WHEN shop_featured_until > ? THEN 1 ELSE 0 END) DESC,
          (SELECT COUNT(*) FROM phone_listings l
            WHERE l.seller_id = users.id AND l.status='active') DESC,
          rating_avg DESC
        LIMIT ?`).all(...exclude, nowTs, 3 - rows.length);
      rows = rows.concat(fill);
    }
    return rows.map((u) => ({
      id: u.id,
      name: u.shop_name || u.display_name,
      city: u.city || null,
      governorate: u.governorate || null,
      logo: u.shop_image_path || u.profile_image_path || null,
    }));
  })();
  const shopsTotal = db.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE seller_type='shop'
      AND COALESCE(shop_hidden,0)=0 AND COALESCE(shop_status,'approved')='approved'`,
  ).get().n;

  res.set('Cache-Control', 'public, max-age=60').json({
    price_shop_id: priceShop ? priceShop.id : null,
    storefront,
    home_shops: homeShops,
    shops_total: shopsTotal,
    update: {
      // The app compares its own version against these. Doing the comparison
      // client-side (rather than the server reading x-app-version) means the
      // answer is identical for every caller and stays cacheable.
      min_supported_version: getSetting('min_supported_version') || '0',
      nag_below_version: getSetting('nag_below_version') || '0',
      android_url: 'https://play.google.com/store/apps/details?id=org.iqmobile.app',
      ios_url: 'https://apps.apple.com/app/id6776442942',
    },
    overlay: overlayOn ? {
      // `version` is what the app remembers as "dismissed". Bump it in the
      // dashboard and the overlay returns for everyone.
      version: getSetting('overlay_version') || '1',
      frequency: getSetting('overlay_frequency') === 'always' ? 'always' : 'once',
      title: getSetting('overlay_title') || '',
      body: getSetting('overlay_body') || '',
      // Stored as a /uploads path; hand back an absolute URL so the app
      // doesn't have to know how to resolve it.
      image: image ? (image.startsWith('http') ? image : PUBLIC_BASE + image) : '',
      cta_label: getSetting('overlay_cta_label') || '',
      cta_url: getSetting('overlay_cta_url') || '',
    } : null,
  });
});

export default r;
