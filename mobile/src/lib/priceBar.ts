// Where things sit on the price bar, as fractions of the track.
//
// Pure because the interesting cases are the ugly ones and they deserve
// tests: a seller priced outside the range of every comparable listing, and
// a range with no width at all because every comparable listing asks the
// same number.

export type BarPoints = {
  /** 0..1 along the track. */
  median: number;
  /** 0..1, or null when there is no price to place. */
  price: number | null;
  /** The seller is outside the observed range — the marker is pinned to an end. */
  priceOutside: 'below' | 'above' | null;
};

export function barPoints(
  low: number,
  high: number,
  median: number,
  price?: number | null,
): BarPoints {
  // Every comparable listing asks the same number. A zero-width track would
  // divide by zero and put NaN into a style prop, which silently collapses
  // the bar rather than throwing — so it is centred instead.
  const span = high - low;
  const at = (n: number) => (span > 0 ? Math.min(1, Math.max(0, (n - low) / span)) : 0.5);

  const p = Number(price);
  const hasPrice = Number.isFinite(p) && p > 0;
  return {
    median: at(median),
    price: hasPrice ? at(p) : null,
    priceOutside: !hasPrice ? null : p < low ? 'below' : p > high ? 'above' : null,
  };
}
