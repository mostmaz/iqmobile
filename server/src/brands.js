// Brand catalog — backed by the `brands` table in SQLite.
//
// Previously brands lived as a hardcoded array in governorates.js. Moving
// to the DB lets admins add/rename/remove brands from the dashboard
// without an APK rebuild or a code push. The in-memory cache below is
// invalidated by the admin CRUD endpoints whenever a brand row changes.
//
// Brand helpers live in their own module (not governorates.js) because
// db.js already imports governorates.js for the GOVERNORATES const; if
// governorates.js then imported db.js we'd hit a TDZ circular-import
// gotcha. Keeping brand logic here avoids that.

import { db } from './db.js';

let _cache = null;

export function getBrands() {
  if (!_cache) {
    _cache = db
      .prepare('SELECT id, name, display_ar, position FROM brands ORDER BY position ASC, id ASC')
      .all();
  }
  return _cache;
}

export function invalidateBrandsCache() {
  _cache = null;
}

// True when `b` is a known brand name (canonical English form). Cheap —
// scans the cached array (typically ~13 items).
export function isBrand(b) {
  if (typeof b !== 'string') return false;
  return getBrands().some((x) => x.name === b);
}

/** Canonical brand names, for callers that need to test text against all of them. */
export function brandNames() {
  return getBrands().map((x) => x.name);
}

// Brand list joined with active-listing counts. Used by the public
// `GET /brands` endpoint AND the admin overview. One DB pass for the
// counts; cheap enough not to cache.
export function getBrandsWithCounts() {
  const brands = getBrands();
  const counts = db
    .prepare(
      `SELECT brand, COUNT(*) AS n FROM phone_listings
       WHERE status='active' GROUP BY brand`,
    )
    .all();
  const byName = Object.fromEntries(counts.map((c) => [c.brand, c.n]));
  return brands.map((b) => ({ ...b, count: byName[b.name] || 0 }));
}
