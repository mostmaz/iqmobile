// What to offer when a search returns nothing.
//
// The rule this obeys is already written down in docs/asking-price-guidance.md
// and restated in the comment above /listings/search-suggestions: "No broader
// location or different condition is silently substituted." So nothing here
// changes a filter. It counts how many listings a DIFFERENT filter would
// return and hands those counts back as labelled options; applying one is the
// buyer's tap, and the tap is what changes the search.
//
// Every alternative is COUNTED before it is offered. An option that says
// "Basra (3)" and lands on an empty list is worse than no option at all — it
// spends the one bit of trust a dead end still has.
//
// Deliberately not offered: a different `condition`. "Used instead of new" is
// a different product, not a nearby one, and the marketplace already treats
// that distinction as load-bearing (see the CONDITIONS comment in db.js).

import { neighboursOf } from './governorates.js';

// Same +20% the buyer-request matcher uses (requestMatch.js CEILING_SLACK).
// A stated budget is an opening position, not a wall — but only just, and the
// label always says the price is over what was asked for.
export const BUDGET_SLACK = 1.2;

// Offer at most this many neighbouring governorates. Ordered by how much
// stock each has, so the first suggestion is the one most likely to help.
const MAX_NEARBY = 3;

/**
 * Count listings matching a filter set. Mirrors the browse route's own
 * visibility rules — status, drafts, expiry — because a count that includes
 * rows browse would hide is a lie the very next tap exposes.
 */
function countMatching(db, f, nowTs, neverExpire) {
  const where = [
    "l.status IN ('active','reserved')",
    'COALESCE(l.is_draft,0)=0',
  ];
  const params = [];
  if (!neverExpire) { where.push('l.expires_at > ?'); params.push(nowTs); }
  if (f.brand) { where.push('l.brand=?'); params.push(f.brand); }
  if (f.model) { where.push('l.model LIKE ?'); params.push(`%${f.model}%`); }
  if (f.governorate) { where.push('l.governorate=?'); params.push(f.governorate); }
  if (f.condition) { where.push('l.condition=?'); params.push(f.condition); }
  if (f.storage) { where.push('l.storage=?'); params.push(f.storage); }
  if (Number.isFinite(f.min_price)) { where.push('l.asking_price >= ?'); params.push(f.min_price); }
  if (Number.isFinite(f.max_price)) { where.push('l.asking_price <= ?'); params.push(f.max_price); }
  try {
    return db.prepare(
      `SELECT COUNT(*) AS n FROM phone_listings l WHERE ${where.join(' AND ')}`,
    ).get(...params).n;
  } catch {
    return 0;
  }
}

/**
 * Alternatives for a search that returned nothing.
 *
 * `filters` is the search as the buyer left it — canonical English
 * governorate, canonical brand. Returns [] when the search itself would have
 * matched something (the caller should only ask on a genuine zero) or when
 * no alternative has any stock behind it.
 *
 * Each entry is `{ kind, label_key, apply, count }`:
 *   - `apply` is the exact filter patch to merge if the buyer taps it, so the
 *     client never has to reconstruct one and can't drift from what was counted.
 *   - `label_key` names the shape of the sentence; the app owns the wording.
 */
export function searchAlternatives(db, filters = {}, opts = {}) {
  const nowTs = opts.now ?? Date.now();
  const neverExpire = opts.neverExpire !== false;
  const base = {
    brand: filters.brand || null,
    model: filters.model || null,
    governorate: filters.governorate || null,
    condition: filters.condition || null,
    storage: filters.storage || null,
    min_price: Number.isFinite(filters.min_price) ? filters.min_price : undefined,
    max_price: Number.isFinite(filters.max_price) ? filters.max_price : undefined,
  };
  const out = [];

  // ── another storage size ────────────────────────────────────────────
  // Only when a storage filter is what's narrowing things. The server matches
  // storage EXACTLY ('128GB' != '128 GB'), so the values offered come from
  // the rows themselves rather than a hardcoded ladder — otherwise a tap
  // could land on a spelling no listing uses.
  if (base.storage) {
    const rows = db.prepare(
      `SELECT l.storage AS storage, COUNT(*) AS n
         FROM phone_listings l
        WHERE l.status IN ('active','reserved') AND COALESCE(l.is_draft,0)=0
          ${neverExpire ? '' : 'AND l.expires_at > @now'}
          ${base.brand ? 'AND l.brand=@brand' : ''}
          ${base.model ? 'AND l.model LIKE @modelLike' : ''}
          ${base.governorate ? 'AND l.governorate=@gov' : ''}
          AND l.storage IS NOT NULL AND l.storage <> '' AND l.storage <> @storage
        GROUP BY l.storage ORDER BY n DESC LIMIT 3`,
    ).all({
      now: nowTs, brand: base.brand, modelLike: `%${base.model}%`,
      gov: base.governorate, storage: base.storage,
    });
    for (const r of rows) {
      if (r.n > 0) {
        out.push({
          kind: 'storage', label_key: 'other_storage',
          value: r.storage, count: r.n, apply: { storage: r.storage },
        });
      }
    }
  }

  // ── a neighbouring governorate ──────────────────────────────────────
  if (base.governorate) {
    const near = [];
    for (const gov of neighboursOf(base.governorate)) {
      const n = countMatching(db, { ...base, governorate: gov }, nowTs, neverExpire);
      if (n > 0) near.push({ gov, n });
    }
    near.sort((a, b) => b.n - a.n);
    for (const { gov, n } of near.slice(0, MAX_NEARBY)) {
      out.push({
        kind: 'governorate', label_key: 'nearby_governorate',
        value: gov, count: n, apply: { governorate: gov },
      });
    }
  }

  // ── a slightly wider budget ─────────────────────────────────────────
  // Only meaningful when a ceiling is what's excluding stock. The widened
  // ceiling is reported so the label can name the real number rather than
  // saying a vague "a bit more".
  if (Number.isFinite(base.max_price) && base.max_price > 0) {
    const widened = Math.round(base.max_price * BUDGET_SLACK);
    const n = countMatching(db, { ...base, max_price: widened }, nowTs, neverExpire);
    if (n > 0) {
      out.push({
        kind: 'budget', label_key: 'wider_budget',
        value: widened, count: n, apply: { max_price: widened },
      });
    }
  }

  // ── drop the governorate entirely ───────────────────────────────────
  // Browse auto-applies the user's own governorate on first mount, so a great
  // many "no results" are location-scoped by a filter the buyer never chose.
  // Offered last: a neighbour is a better answer than the whole country.
  if (base.governorate) {
    const n = countMatching(db, { ...base, governorate: null }, nowTs, neverExpire);
    const alreadyCovered = out
      .filter((o) => o.kind === 'governorate')
      .reduce((sum, o) => sum + o.count, 0);
    // Only worth showing if it beats the neighbours we already listed.
    if (n > alreadyCovered) {
      out.push({
        kind: 'all_governorates', label_key: 'all_governorates',
        // `null`, not `undefined`: JSON.stringify DROPS undefined values, so
        // this patch reached the client as `{}` and clearing the governorate
        // silently did nothing. The client's qs() omits null the same way it
        // omits undefined, so null clears the filter end to end.
        value: null, count: n, apply: { governorate: null },
      });
    }
  }

  return out;
}
