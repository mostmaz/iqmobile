// The price range on a device card, short enough to fit beside the count.
//
// A card is ~48% of a 390pt screen, so about 146pt of usable width. Two full
// IQD figures — "1,070,000 – 1,300,000" — do not fit on one line there and
// wrap into the row below the device name, which is why this abbreviates.
//
// Iraqi prices are quoted in thousands in conversation, and the app's own
// listing cards already show the exact figure one tap away. This line is a
// range to orient by, not a price to act on.

/** "٬" is not used: the app's numerals are Latin everywhere else. */
function short(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    // 1.07م reads as a price; 1.070م reads as a serial number.
    return `${m >= 10 ? Math.round(m) : Number(m.toFixed(2))}م`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}ألف`;
  return String(Math.round(n));
}

/**
 * `null` when there is no real price to show — every listing in the group is
 * call-for-price. A single figure when the ends coincide, because "900ألف –
 * 900ألف" reads as a bug.
 */
export function formatPriceRange(min: number | null | undefined, max: number | null | undefined): string | null {
  const lo = Number(min);
  const hi = Number(max);
  const loOk = Number.isFinite(lo) && lo > 0;
  const hiOk = Number.isFinite(hi) && hi > 0;
  if (!loOk && !hiOk) return null;
  if (!hiOk) return short(lo);
  if (!loOk) return short(hi);
  const a = short(lo);
  const b = short(hi);
  return a === b ? a : `${a} – ${b}`;
}
