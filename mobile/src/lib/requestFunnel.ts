// Which brands the request funnel shows first, and which it hides behind
// «أخرى». Pure, so the order is testable without rendering anything.
//
// The named brands are the owner's list — they are what Iraqi buyers
// actually ask for, and a grid of twenty-two would bury them. WHICH brands
// are shown is that list; the ORDER they appear in is supply, biggest first,
// so the grid reorders itself as the marketplace changes instead of freezing
// a ranking that was true the day it was typed.
//
// Everything else waits behind «أخرى», ordered the same way — the only
// honest ranking for a brand the buyer had to go looking for.
//
// The catalogue has a literal brand called "Other". It is a real row with
// real listings, so it belongs in the modal like any other — but the «أخرى»
// PILL means "the rest", not that row. Conflating the two would make the
// pill open a list of one.

export interface FunnelBrand {
  name: string;
  display_ar?: string | null;
  count?: number | null;
  position?: number | null;
  logo_path?: string | null;
}

/**
 * Which brands get a card. Compared lowercase against `name`.
 *
 * Membership only — this list does NOT set the order any more. Ties fall
 * back to it, so an empty marketplace still renders something stable.
 */
export const HEAD_BRANDS = ['apple', 'samsung', 'honor', 'realme', 'xiaomi', 'infinix', 'tecno'];

const key = (b: FunnelBrand) => (b.name || '').trim().toLowerCase();

export function orderBrandsForFunnel(brands: FunnelBrand[] | null | undefined): {
  head: FunnelBrand[];
  rest: FunnelBrand[];
} {
  const list = (brands || []).filter((b) => b && key(b));
  const byKey = new Map(list.map((b) => [key(b), b]));

  // Head brands missing from the server list are skipped, not invented —
  // only a brand that exists can ever be a card, or tapping it would filter
  // on a name the server does not know and silently return everything.
  //
  // Sorted by how many devices are actually for sale. The grid is rendered
  // row-reverse, so the first entry is the top-RIGHT card: the biggest brand
  // is where an Arabic reader's eye starts.
  const head = HEAD_BRANDS
    .map((k) => byKey.get(k))
    .filter((b): b is FunnelBrand => !!b)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0)
      || HEAD_BRANDS.indexOf(key(a)) - HEAD_BRANDS.indexOf(key(b)));
  const headKeys = new Set(head.map(key));

  const rest = list
    .filter((b) => !headKeys.has(key(b)))
    .sort((a, b) => ((b.count ?? 0) - (a.count ?? 0)) || ((a.position ?? 0) - (b.position ?? 0)));

  return { head, rest };
}

/** The label for a brand pill or row. */
export function brandLabel(b: FunnelBrand): string {
  return (b.display_ar || '').trim() || b.name;
}

/**
 * The server's model fold, in JS.
 *
 * Mirrors arabicNormalizeSql() in server/src/searchNormalize.js — lowercase,
 * Arabic orthography collapse, Arabic-Indic digits, strip tatweel and spaces.
 * Needed because the two sides of a comparison come from different places: a
 * chip's label is the spelling SELLERS use most, while the model a buyer picks
 * comes from the CATALOGUE. "Galaxy S24 Ultra" and "galaxy s24  ultra" are the
 * same phone, and matching raw strings would quietly show no availability for
 * a device with twenty listings.
 *
 * If the SQL fold ever changes, this changes with it.
 */
export function foldModelKey(input: string | null | undefined): string {
  let s = String(input ?? '').toLowerCase();
  const reps: [RegExp, string][] = [
    [/[أإآٱ]/g, 'ا'], [/ى/g, 'ي'], [/ؤ/g, 'و'], [/ئ/g, 'ي'], [/ة/g, 'ه'],
    [/ـ/g, ''], [/\s/g, ''],
  ];
  for (const [re, to] of reps) s = s.replace(re, to);
  return s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
