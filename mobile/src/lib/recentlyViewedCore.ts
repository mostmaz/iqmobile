// The last few devices this person opened. Pure rules; storage lives next door.
//
// Deliberately device-local rather than server-side. The `events` table has no
// `(user_id, type, created_at)` index, so a per-user history query table-scans
// — and a rail on the home feed would run it on every launch. Guests do get
// `view` events under their guest id, and the guest→real upgrade preserves the
// row, so a server version would work; it would just cost an index migration
// and a query to produce something local storage already has.
//
// Modelled on lib/compare.tsx, which caches brand/model/image so the rail
// renders on a cold start with no fetch. It does NOT copy compare's missing
// `ready` gate — see recentlyViewed.ts.

export interface RecentEntry {
  id: number;
  brand: string;
  model: string;
  image_path?: string | null;
  at: number;
}

/**
 * Short on purpose. This is "what was I just looking at", not a history
 * feature — a long list turns a prompt into an archive nobody scrolls.
 */
export const RECENT_MAX = 12;

/** Below this the rail is not worth the space it takes from real listings. */
export const RECENT_MIN_TO_SHOW = 2;

/**
 * Record a view. Most recent first, one entry per listing.
 *
 * Re-opening a device MOVES it to the front rather than adding a second row —
 * otherwise a rail of twelve would be four devices repeated.
 */
export function recordView(list: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  if (!Number.isInteger(entry?.id) || entry.id <= 0) return list;
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, RECENT_MAX);
}

/** Drop one — used when a listing turns out to be gone. */
export function forget(list: RecentEntry[], id: number): RecentEntry[] {
  return list.filter((e) => e.id !== id);
}

/** Keep only well-formed rows; a corrupt store must not crash the feed. */
export function sanitize(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e: any) => e && Number.isInteger(e.id) && e.id > 0 && typeof e.brand === 'string')
    .slice(0, RECENT_MAX);
}

/**
 * What the rail should show.
 *
 * The device currently on screen is excluded: a "recently viewed" rail whose
 * first tile is the page you are already on is noise.
 */
export function railItems(list: RecentEntry[], excludeId?: number | null): RecentEntry[] {
  const out = list.filter((e) => e.id !== excludeId);
  return out.length >= RECENT_MIN_TO_SHOW ? out : [];
}
