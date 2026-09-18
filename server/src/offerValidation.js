// Is this offer a real price, or a typo?
//
// Measured on production, 18 Sep 2026: 43 offers ever sent, and 16 of them
// were under 20,000 IQD. Sellers type prices in thousands the way they speak
// them — «مائتين» for 200,000 — so an offer of "200" reaches the buyer as
// 200 dinars, which is not a discount but noise. More than a third of every
// offer this marketplace has ever carried was unreadable.
//
// Three rules, and they are deliberately different strengths:
//
//   under the floor   → REJECT. 200 dinars is not a price anyone meant.
//   over the buyer's cap → WARN, and let them send it anyway after a second
//                       tap. A ceiling is an opening position, and «I have
//                       it, but at 850» is a real answer to «I want it
//                       under 800».
//   absurd multiple   → REJECT. 13,750,000 for a phone with a 550,000
//                       median is a keyboard accident, and it poisons the
//                       buyer's list the same way the 200 does.
//
// Pure: the caller supplies the numbers so `node --test` can load this
// without a database, and so the client and the server can share one rule.

/** Below this, a price is a typo rather than an offer. */
export const MIN_OFFER_IQD = 20000;
/** Above median × this, likewise — in the other direction. */
export const ABSURD_MULTIPLE = 5;
/** Fewer live listings than this and there is no median worth trusting. */
export const MIN_SAMPLE = 4;

const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * @param opts.price      what the seller typed, in whole dinars
 * @param opts.maxPrice   the buyer's stated ceiling
 * @param opts.median     median live listing price for this device, or null
 *                        when too few are listed to have an opinion
 * @param opts.confirmedAboveCap  the seller tapped through the over-cap warning
 * @returns {{ok: boolean, code: string|null, message: string|null, needsConfirm: boolean}}
 */
export function validateOffer({ price, maxPrice, median = null, confirmedAboveCap = false } = {}) {
  const n = Math.floor(Number(price));
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, code: 'bad_price', message: 'اكتب سعراً صحيحاً.', needsConfirm: false };
  }

  if (n < MIN_OFFER_IQD) {
    return {
      ok: false,
      code: 'price_too_low',
      message: 'السعر يبدو ناقصاً — اكتب السعر الكامل بالدينار.',
      needsConfirm: false,
    };
  }

  // Only with a real sample behind it. A "median" over two listings would
  // reject honest prices on thinly-stocked devices, which is worse than
  // letting a rare typo through.
  if (median && median > 0 && n > median * ABSURD_MULTIPLE) {
    return {
      ok: false,
      code: 'price_absurd',
      message: 'السعر خارج النطاق المعقول.',
      needsConfirm: false,
    };
  }

  const cap = Math.floor(Number(maxPrice));
  if (Number.isFinite(cap) && cap > 0 && n > cap && !confirmedAboveCap) {
    return {
      ok: false,
      code: 'above_cap',
      message: `سعرك أعلى من سقف المشتري (${fmt(cap)} د.ع).`,
      needsConfirm: true,
    };
  }

  return { ok: true, code: null, message: null, needsConfirm: false };
}

/**
 * Median asking price of the live listings for a device, or null.
 *
 * Deliberately brand+model only: an offer carries neither storage nor
 * condition, so narrowing the way askingPriceGuidance does would leave no
 * sample at all. The number is only ever used to catch an order-of-magnitude
 * accident, and it does not need to be precise to do that.
 */
export function medianListingPrice(db, { brand, model }, norm) {
  if (!brand || !model) return null;
  const rows = db.prepare(
    `SELECT model, asking_price FROM phone_listings
      WHERE brand=? AND status IN ('active','reserved')
        AND COALESCE(is_draft,0)=0 AND asking_price > 1`,
  ).all(brand);
  const wanted = norm(model);
  const prices = rows.filter((r) => norm(r.model) === wanted)
    .map((r) => r.asking_price)
    .sort((a, b) => a - b);
  if (prices.length < MIN_SAMPLE) return null;
  const mid = prices.length / 2;
  return prices.length % 2
    ? prices[Math.floor(mid)]
    : (prices[mid - 1] + prices[mid]) / 2;
}
