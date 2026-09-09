// Which brands the request funnel shows first, and which it hides behind
// «أخرى». Pure, so the order is testable without rendering anything.
//
// The named brands are the owner's list, in the owner's order — they are
// what Iraqi buyers actually ask for, and a grid of twenty-two would bury
// them. Everything else waits behind «أخرى», ordered by how much of it
// is actually for sale (`count`), because that is the only honest ranking
// for a brand the buyer had to go looking for.
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

/** Owner's order. Compared lowercase against `name`. */
export const HEAD_BRANDS = ['apple', 'samsung', 'honor', 'realme', 'xiaomi', 'infinix', 'tecno'];

const key = (b: FunnelBrand) => (b.name || '').trim().toLowerCase();

export function orderBrandsForFunnel(brands: FunnelBrand[] | null | undefined): {
  head: FunnelBrand[];
  rest: FunnelBrand[];
} {
  const list = (brands || []).filter((b) => b && key(b));
  const byKey = new Map(list.map((b) => [key(b), b]));

  // Head brands missing from the server list are skipped, not invented —
  // only a brand that exists can ever be a pill, or tapping it would filter
  // on a name the server does not know and silently return everything.
  const head = HEAD_BRANDS.map((k) => byKey.get(k)).filter((b): b is FunnelBrand => !!b);
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
