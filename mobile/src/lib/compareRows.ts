// Comparison rows: when a blank is information, and when it is noise.
//
// Two behaviours here were actively misleading.
//
// 1. Any row where every column was null got DROPPED. So if neither listing
//    stated a warranty, the warranty row vanished — and a buyer reads a
//    missing row as "not applicable", not as "neither seller said". The one
//    thing this screen exists to surface is what you do not know about a
//    phone before you go and meet a stranger.
//
// 2. `differs()` compared `v ?? '—'`, so "89%" versus "didn't say" counted as
//    a DIFFERENCE and got tinted like one. A missing value masqueraded as a
//    real distinction — the exact opposite of the goal — and "show only what
//    differs" filled with rows that differ only in how much we know.
//
// The fix for both is the same idea: unknown is a third state, not a value.
//
// Rows split by who is supposed to know. A SELLER row (price, warranty,
// battery, accessories) is something the seller could have told us, so its
// absence is a fact about the listing and it always renders. A SPEC row
// (chipset, camera) comes from the catalogue and is the same for every unit,
// so when it is missing that is our gap, not theirs — and an empty one is
// genuine noise in a table this narrow.

export const UNKNOWN_LABEL = 'غير محدد';

export interface CompareRow {
  label: string;
  values: (string | null)[];
  /** Index of the best column, if one wins. */
  best?: number | null;
  ltr?: boolean;
  /**
   * `seller` rows survive being entirely empty because "neither said" is
   * worth stating. `spec` rows do not.
   */
  kind?: 'seller' | 'spec';
}

const isKnown = (v: string | null | undefined): v is string => v != null && v !== '';

/**
 * Do the columns actually disagree?
 *
 * Only known values count. One listing stating 89% and another saying nothing
 * is not a disagreement about battery health — it is one seller answering.
 * Tinting that taught buyers to distrust the highlight entirely.
 */
export function differs(row: CompareRow): boolean {
  const known = row.values.filter(isKnown);
  if (known.length < 2) return false;
  return new Set(known).size > 1;
}

/** Is anything at all known in this row? */
export function hasAnyValue(row: CompareRow): boolean {
  return row.values.some(isKnown);
}

/**
 * Which rows to render.
 *
 * A seller row stays even when empty; a spec row does not.
 */
export function visibleRows(rows: CompareRow[]): CompareRow[] {
  return rows.filter((r) => (r.kind === 'seller' ? true : hasAnyValue(r)));
}

/** What to print in a cell. */
export function cellText(v: string | null | undefined): string {
  return isKnown(v) ? v : UNKNOWN_LABEL;
}

/** `true` when the cell is an absence and should be drawn as one. */
export function cellIsUnknown(v: string | null | undefined): boolean {
  return !isKnown(v);
}
