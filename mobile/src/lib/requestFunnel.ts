// Which brands the request funnel shows first, and which it hides behind
// «أخرى». Pure, so the order is testable without rendering anything.
//
// The six named brands are the owner's list, in the owner's order — they are
// what Iraqi buyers actually ask for, and a rail of twenty-two pills would
// bury them. Everything else waits behind one pill, ordered by how much of it
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
}

/** Owner's order. Compared lowercase against `name`. */
export const HEAD_BRANDS = ['apple', 'samsung', 'honor', 'realme', 'xiaomi', 'infinix'];

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
