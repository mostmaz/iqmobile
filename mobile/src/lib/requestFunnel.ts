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

/**
 * Order the compose sheet's brand rail by how many devices are FOR SALE.
 *
 * The rail is fed by `/device-catalog/brands`, whose `count` is the number
 * of models the catalogue knows for a brand — not the number of listings.
 * Those two diverge badly: a brand with four hundred catalogue entries and
 * nothing for sale sorted above the brands Iraqi buyers actually ask for.
 *
 * The catalogue is still the source of the NAMES, because the model picker
 * queries the catalogue with whatever the buyer taps here — reordering is
 * all this does. A brand nobody has listed keeps its place at the end, in
 * catalogue order, so the rail never loses an option.
 *
 * @param catalog  `{ brand, count }` from the catalogue, in its own order.
 * @param supply   `{ name, count }` from /brands — real listing counts.
 */
export function orderComposeBrands<T extends { brand: string; count?: number | null }>(
  catalog: T[] | null | undefined,
  supply: Array<{ name: string; count?: number | null }> | null | undefined,
): T[] {
  const listings = new Map<string, number>();
  for (const b of supply || []) {
    const k = (b?.name || '').trim().toLowerCase();
    if (k) listings.set(k, Number(b.count) || 0);
  }
  return (catalog || [])
    .filter((b) => b && String(b.brand || '').trim())
    .map((b, i) => ({ b, i, n: listings.get(b.brand.trim().toLowerCase()) ?? 0 }))
    // `i` as the final tiebreak keeps the catalogue's own order among brands
    // that are level — without it, ties reshuffle between renders.
    .sort((x, y) => (y.n - x.n) || ((Number(y.b.count) || 0) - (Number(x.b.count) || 0)) || (x.i - y.i))
    .map(({ b }) => b);
}
