// What kind of product a listing is, for storefront browsing.
//
// The marketplace only ever sold phones, so nothing needed to say so. The
// storefront changed that: shop 5587 stocks phones, tablets, earbuds, a
// watch, two stylus pens and a robot vacuum, and a shopper looking for a
// tablet cannot get there through brand chips alone — "Honor" is a phone, a
// tablet AND five pairs of earbuds.
//
// The guess is made from the product NAME once, at import/create time, and
// stored on the row. Deriving it per query would be both slower and
// unfixable: the supplier's own sheet files an OPPO Reno14F as a tablet and
// "Honor earbuds open" as one too, so a human needs to be able to override
// the guess from the dashboard.

export const PRODUCT_TYPES = ['phone', 'tablet', 'accessory'];

// Accessories are checked first and deliberately include "pen"/"pencil":
// a stylus is an accessory even though "Xiaomi Focus Pen" contains no other
// signal, and checking accessory-first stops "Honor Pad ... pen" bundles
// landing under tablets.
const ACCESSORY = /(ear ?bud|free ?bud|free ?clip|air ?pod|\bbuds\b|\bwatch\b|\bband\b|pencil|\bpen\b|charger|\bcable\b|\bcase\b|\bcover\b|power ?bank|head ?phone|\bspeaker\b|robot cleaner|vacuum|hair ?dryer|\bdryer\b|screen protector|adapter)/i;
const TABLET = /(\bpad\b|\btab\b|\btablet\b|\bipad\b|megapad)/i;

/**
 * @param {string} name  brand + model, or just the model
 * @returns {'phone'|'tablet'|'accessory'}
 */
export function detectProductType(name) {
  const s = String(name || '');
  if (ACCESSORY.test(s)) return 'accessory';
  if (TABLET.test(s)) return 'tablet';
  return 'phone';
}

/** Normalise an incoming value; anything unrecognised falls back to null (= phone). */
export function normalizeProductType(v) {
  const s = String(v || '').trim().toLowerCase();
  return PRODUCT_TYPES.includes(s) ? s : null;
}
