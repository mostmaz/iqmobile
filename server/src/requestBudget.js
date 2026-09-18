// Is this budget going to get any offers?
//
// Five of 110 live requests on 18 Sep 2026 asked for phones worth 400,000+
// with ceilings of 50–75,000. Nobody could fill them, so nobody did, and the
// buyer spent 21 days waiting for a silence the site could have predicted on
// the spot.
//
// A WARNING, never a block. A buyer may know something the median does not:
// a cracked screen they will accept, a friend selling cheap, a model name
// that folds two devices together. Refusing the request would be the site
// claiming to know the Iraqi phone market better than the person buying in
// it. Saying "the middle price is 550,000 — you may hear nothing" costs them
// one line and can be ignored.
//
// Pure: the caller supplies the median, so `node --test` loads this with no
// database and the same rule can answer the app before the request exists.

/**
 * Below this share of the median, a ceiling is unlikely to be met.
 *
 * 40% rather than something tighter because used phones legitimately spread:
 * a well-used 128GB at 45% of the median for its model is a real listing,
 * not a fantasy. This is meant to catch the buyer who typed 50,000 for a
 * phone that sells at 500,000, not to police haggling.
 */
export const LOW_BUDGET_SHARE = 0.4;

/**
 * @param opts.maxPrice the buyer's stated ceiling
 * @param opts.median   median live price for the device, or null when too
 *                      few are listed to have an opinion
 * @returns {{low: boolean, median: number|null, suggested_min: number|null,
 *            suggested_max: number|null, message: string|null}}
 */
export function budgetVerdict({ maxPrice, median = null } = {}) {
  const cap = Math.floor(Number(maxPrice));
  const mid = Number(median);
  const none = { low: false, median: null, suggested_min: null, suggested_max: null, message: null };

  if (!Number.isFinite(cap) || cap <= 0) return none;
  if (!Number.isFinite(mid) || mid <= 0) return none;
  if (cap >= mid * LOW_BUDGET_SHARE) return { ...none, median: mid };

  // A range, not a number: quoting the median alone reads as a price the
  // buyer must meet, and plenty of devices do sell under it.
  const low = Math.round((mid * 0.7) / 5000) * 5000;
  const high = Math.round(mid / 5000) * 5000;
  return {
    low: true,
    median: mid,
    suggested_min: low,
    suggested_max: high,
    message: `سقفك أقل بكثير من سعر السوق (الوسيط ${fmt(mid)} د.ع) — قد لا تصلك عروض.`
      + ` أغلب الأجهزة تُباع بين ${fmt(low)} و${fmt(high)} د.ع.`,
  };
}

const fmt = (n) => Math.round(Number(n)).toLocaleString('en-US');
