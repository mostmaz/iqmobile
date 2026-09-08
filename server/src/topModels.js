// Which models of a brand are actually for sale right now — the pure half.
//
// The request funnel opens on a brand and then asks "which ten devices?".
// The catalogue cannot answer that: /device-catalog/devices ranks by
// membership, so a model with zero listings sorts level with one that has
// fifty, and tapping it lands on nothing. Ranking by listings posted in the
// same window the next step displays is what guarantees a chip never opens
// onto an empty list.
//
// Grouping happens on `model_key`, which the route computes IN SQL with the
// same arabicNormalizeSql() fold the exact-match filter uses — so what this
// groups and what step 3 filters are one function, and cannot drift apart.
// This module never computes a key itself; that is the point.
//
// It does NOT merge spellings that differ by a word. "Galaxy S26 Ultra" and
// "S26 Ultra" stay two chips. The leading-line-word canonicalisation that
// would join them lives in listingNameNormalize.js and is done against the
// catalogue, and docs/../project notes record it once renaming an Apple
// Watch to an iPhone. Not the place for it.

/**
 * @param rows  `{ model, model_key, asking_price, price_on_request,
 *               created_at, image_path }` — every listing in the window,
 *               already filtered to brand/status by the caller.
 * @returns `{ model, model_key, count, min_price, image_path }[]`, best first.
 */
export function groupTopModels(rows, { limit = 10 } = {}) {
  const groups = new Map();

  for (const r of rows || []) {
    const key = r?.model_key;
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { model_key: key, count: 0, spellings: new Map(), min_price: null, newest: -Infinity, image_path: null };
      groups.set(key, g);
    }
    g.count++;

    // The label is the spelling sellers use most, not whichever row SQLite
    // happened to emit for a bare column in a GROUP BY — that is arbitrary
    // and would make the chip's wording change between refreshes.
    const spelling = String(r.model || '').trim();
    if (spelling) g.spellings.set(spelling, (g.spellings.get(spelling) || 0) + 1);

    // A call-for-price row carries the sentinel asking_price=1. Letting it
    // through would put "from 1 د.ع" on the chip — the exact bug #9 fixed on
    // the cards. Only a real price competes for the minimum.
    const price = Number(r.asking_price);
    if (!r.price_on_request && Number.isFinite(price) && price > 1) {
      g.min_price = g.min_price == null ? price : Math.min(g.min_price, price);
    }

    // The thumbnail is the newest listing's, so it reflects what is on sale
    // today rather than a photo from the oldest row in the window.
    const at = Number(r.created_at) || 0;
    if (at > g.newest) { g.newest = at; g.image_path = r.image_path || null; }
  }

  const out = [];
  for (const g of groups.values()) {
    let best = null; let bestN = -1;
    for (const [s, n] of g.spellings) if (n > bestN) { best = s; bestN = n; }
    out.push({
      model: best ?? g.model_key,
      model_key: g.model_key,
      count: g.count,
      min_price: g.min_price,
      image_path: g.image_path,
      // kept for ordering only; not part of the response shape
      _newest: g.newest,
    });
  }

  out.sort((a, b) => (b.count - a.count) || (b._newest - a._newest));
  return out.slice(0, limit).map(({ _newest, ...rest }) => rest);
}
