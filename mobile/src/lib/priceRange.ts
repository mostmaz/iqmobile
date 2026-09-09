// The price range on a device card, short enough to fit beside the count.
//
// A card is ~48% of a 390pt screen, so about 146pt of usable width. Two full
// IQD figures — "1,070,000 – 1,300,000" — do not fit on one line there and
// wrap into the row below the device name, which is why this abbreviates.
//
// Iraqi prices are quoted in thousands in conversation, and the app's own
// listing cards already show the exact figure one tap away. This line is a
// range to orient by, not a price to act on.

/**
 * A number split from its unit, so the two ends can be compared and, when
 * they agree, printed with the unit written once.
 *
 * The unit is always a separate word. «450ألف» glues a Latin numeral to an
 * Arabic word with no space and reads as one broken token; «450 ألف» is how
 * the price is said out loud.
 */
function parts(n: number): { num: string; unit: string } | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    // 1.07 مليون reads as a price; 1.070 مليون reads as a serial number.
    return { num: String(m >= 10 ? Math.round(m) : Number(m.toFixed(2))), unit: 'مليون' };
  }
  if (n >= 1000) return { num: String(Math.round(n / 1000)), unit: 'ألف' };
  return { num: String(Math.round(n)), unit: '' };
}

function one(p: { num: string; unit: string }): string {
  return p.unit ? `${p.num} ${p.unit}` : p.num;
}

/**
 * `null` when there is no real price to show — every listing in the group is
 * call-for-price. A single figure when the ends coincide, because «900 ألف –
 * 900 ألف» reads as a bug.
 *
 * Both ends in the same unit share it: «450 – 900 ألف», not «450 ألف – 900
 * ألف». Half a card is about 146pt and the repeated word was the difference
 * between one line and two.
 */
export function formatPriceRange(min: number | null | undefined, max: number | null | undefined): string | null {
  const lo = parts(Number(min));
  const hi = parts(Number(max));
  if (!lo && !hi) return null;
  if (!hi) return one(lo!);
  if (!lo) return one(hi);
  if (lo.num === hi.num && lo.unit === hi.unit) return one(lo);
  if (lo.unit === hi.unit) return lo.unit ? `${lo.num} – ${hi.num} ${lo.unit}` : `${lo.num} – ${hi.num}`;
  return `${one(lo)} – ${one(hi)}`;
}
