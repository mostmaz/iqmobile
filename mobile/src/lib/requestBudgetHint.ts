// «سقفك أقل بكثير من سعر السوق» — the line under the budget stepper.
//
// Mirrors server/src/requestBudget.js, and for the same reason the offer
// rule is mirrored: the server decides, but a buyer adjusting a stepper
// should see the warning move as they move it, not receive it as a verdict
// after they have already posted.
//
// Dependency-free so `node --test` can import it.

/** Below this share of the median, a ceiling is unlikely to be met. */
export const LOW_BUDGET_SHARE = 0.4;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * @returns the warning, or null when there is nothing worth saying — which
 *   is most of the time, and is why this returns null rather than a verdict
 *   object the caller has to interrogate.
 */
export function budgetHint(maxPrice: number, median?: number | null): { title: string; body: string } | null {
  const cap = Math.floor(Number(maxPrice));
  const mid = Number(median);
  if (!Number.isFinite(cap) || cap <= 0) return null;
  // No median means too few listings to have an opinion. Warning a buyer off
  // a thinly-stocked device on the strength of two prices is worse than
  // saying nothing.
  if (!Number.isFinite(mid) || mid <= 0) return null;
  if (cap >= mid * LOW_BUDGET_SHARE) return null;

  const low = Math.round((mid * 0.7) / 5000) * 5000;
  const high = Math.round(mid / 5000) * 5000;
  return {
    title: `سقفك أقل بكثير من سعر السوق (الوسيط ${fmt(mid)} د.ع)`,
    body: `قد لا تصلك عروض. أغلب الأجهزة تُباع بين ${fmt(low)} و${fmt(high)} د.ع — تقدر تنشر الطلب على أي حال.`,
  };
}
