// A phone priced at "500" means 500,000 IQD.
//
// Sellers type the price the way they say it out loud — "خمسمية" for a
// 500,000 dinar phone — and drop the thousands. The sell form already asks
// "هل تقصد 500,000 د.ع؟" with a one-tap fix, and sellers still ignore it and
// publish the 500. The result is a listing that undercuts every real one and
// sorts to the top of every price-ascending search, which makes the whole
// price filter untrustworthy.
//
// So the correction moves server-side, where it applies to every write path
// — the app, the dashboard, and any importer — instead of only to the one
// screen that happened to ask.
//
// Deliberately NOT applied to accessories. A 500 IQD phone does not exist,
// but the storefront stocks cables, screen protectors and cases, and there
// the small numbers can be real. Phones and tablets only.
//
// And NOT applied to our own storefronts — the IQ Mobile store and the price
// shop. Those are stocked from spreadsheets and the dashboard, with real
// figures typed once by someone who knows what they are doing; the rule
// exists for the person typing on a phone in a hurry. Identified by flag
// rather than by hardcoded id so a third storefront inherits the exemption.

import { db } from './db.js';
import { detectProductType } from './productType.js';

/**
 * Is this seller one of the storefronts we stock ourselves?
 * `shop_orders_enabled` marks the COD store, `shop_hidden` the price shop.
 */
export function isManagedStorefront(sellerId) {
  if (!sellerId) return false;
  const row = db.prepare(
    `SELECT 1 FROM users
      WHERE id=? AND (COALESCE(shop_orders_enabled,0)=1 OR COALESCE(shop_hidden,0)=1)`,
  ).get(sellerId);
  return !!row;
}

/** Below this, the seller meant thousands. */
export const PRICE_SCALE_THRESHOLD = 1000;
const SCALE = 1000;

/**
 * Correct a price that was typed in thousands.
 *
 * @param {number} price     the raw number the seller submitted
 * @param {object} [opts]
 * @param {string} [opts.productType]  'phone' | 'tablet' | 'accessory'; when
 *   absent it is detected from `name`. NULL/undefined means phone, matching
 *   the phone_listings convention.
 * @param {string} [opts.name]  brand + model, used to detect the type
 * @param {number} [opts.sellerId]  skips the correction for our own
 *   storefronts — they are stocked deliberately, not typed in a hurry.
 * @param {boolean} [opts.priceOnRequest]  when true the stored price is a
 *   placeholder (the storefront writes 1 and renders "السعر عند الطلب"), so
 *   there is no price to correct — scaling it would turn the placeholder
 *   into a real-looking 1,000 د.ع.
 * @returns {{price:number, scaled:boolean}}
 */
export function scalePriceIfThousands(price, opts = {}) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return { price: n, scaled: false };
  if (n >= PRICE_SCALE_THRESHOLD) return { price: n, scaled: false };
  if (opts.priceOnRequest) return { price: n, scaled: false };
  if (opts.sellerId && isManagedStorefront(opts.sellerId)) return { price: n, scaled: false };

  const type = opts.productType || detectProductType(opts.name || '');
  if (type === 'accessory') return { price: n, scaled: false };

  return { price: n * SCALE, scaled: true };
}
