// The one expression the marketplace sorts on.
//
// It used to be `l.created_at` written out at five call sites. Then the
// rewarded boost gave a seller a way to move a listing back up, and a bump
// that only some of those five queries honoured would mean a listing at the
// top of the app's feed and halfway down the website's — the same listing,
// two answers, and no way to tell which was the bug.
//
// COALESCE, not a backfill: `bumped_at` is NULL for the ~3,000 listings that
// existed before this shipped and for every listing that is never boosted,
// and NULL must keep meaning "rank me by when I was posted".
//
// `created_at` is NEVER written by the boost path. It means "posted", the
// listing page shows it as such, and the request funnel's 60/365-day windows
// filter on it. A bump moves a listing's PLACE, not its age.
export const RANK_TS = 'COALESCE(l.bumped_at, l.created_at)';

/** The same expression for a query whose table alias is not `l`. */
export function rankTs(alias) {
  return alias ? `COALESCE(${alias}.bumped_at, ${alias}.created_at)` : 'COALESCE(bumped_at, created_at)';
}
