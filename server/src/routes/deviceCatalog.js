// Device catalog — the brand → device dropdown behind the post-listing flow.
//
// The seller picks a brand, then their exact device from a searchable list,
// instead of free-typing a model string. Variants (storage / RAM / colour)
// are NOT catalog entries: one device = one row, and the variant lives in the
// listing's own storage/color fields. So "Galaxy S24 Ultra" appears once, not
// once per 256GB/512GB/1TB.
//
// No auth on the read endpoints: same public surface as /brands and
// /listings, and the app needs the list before a user signs in. Suggestions
// (POST) do require auth so an admin reviewing the queue can see who asked.

import { Router } from 'express';
import { suggestFromText } from '../listingNameNormalize.js';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { emitToAdmins } from '../sse.js';

const r = Router();

const TYPES = new Set(['phone', 'tablet', 'watch']);
// Falls back to 'phone' rather than 400ing: the type toggle is a convenience,
// and an unknown value from an older client should still return something
// useful instead of an error screen.
// "Galaxy A10" before "Galaxy A9"? No — split each name into digit and
// non-digit runs and compare the digit runs as numbers.
const NUM_RUN = /(\d+)/;
function naturalCompare(a, b) {
  const ax = String(a).toLowerCase().split(NUM_RUN);
  const bx = String(b).toLowerCase().split(NUM_RUN);
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const as = ax[i] ?? '';
    const bs = bx[i] ?? '';
    // Odd indices are the captured digit runs.
    if (i % 2 === 1) {
      const d = Number(as || 0) - Number(bs || 0);
      if (d) return d;
    } else if (as !== bs) {
      return as < bs ? -1 : 1;
    }
  }
  return 0;
}

const asType = (v) => (TYPES.has(v) ? v : 'phone');

// Brands that actually have devices of the requested type, with counts. The
// app uses this to build the brand rail *per type* — picking "watch" should
// not show Tecno or Infinix, which have no watches in the catalog.
r.get('/device-catalog/brands', (req, res) => {
  const type = asType(req.query.type);
  const rows = db
    .prepare(
      `SELECT brand, COUNT(*) AS count
         FROM device_catalog
        WHERE device_type=? AND is_active=1
        GROUP BY brand
        ORDER BY count DESC, brand ASC`,
    )
    .all(type);
  res.json(rows);
});

// Devices for one brand+type, optionally filtered by a search string.
//
// Ordering puts the models the seller is most likely to want first: exact
// prefix matches before mid-string matches, then newest-looking names. We
// don't store a release year (the dropdown only needs brand + name), so
// alphabetical is the tiebreak — good enough for a list the user is also
// typing to filter.
r.get('/device-catalog/devices', (req, res) => {
  const brand = String(req.query.brand || '').trim();
  if (!brand) return res.status(400).json({ error: 'brand_required' });
  const type = asType(req.query.type);
  const q = String(req.query.q || '').trim();

  // Cap the payload. A brand like Vivo has 500+ devices; the app renders a
  // searchable list, so we ship the first page and let typing narrow it
  // server-side rather than pushing the whole catalog over 3G.
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  if (!q) {
    // Sorted in JS, not SQL. A plain lexicographic ORDER BY interleaves
    // generations — Realme came back as "1, 10, 10 5G, 10 Pro, 10 Pro+, 10s,
    // 10T, 11", with the 10s wedged between the 1 and the 11 because "1" is
    // a prefix of "10". Buyers scan this list by generation, so the digit
    // runs have to compare as numbers. The list is capped at 500 rows, so
    // sorting here costs nothing.
    // Fetch the brand in full, sort, THEN slice. Applying SQL's LIMIT first
    // would hand the sorter an arbitrary subset — a brand with 261 devices
    // would return a neatly ordered slice of whichever 200 rows SQLite
    // happened to walk, which is worse than the lexicographic order it
    // replaced. Brands top out in the low hundreds, so reading all of one
    // costs nothing.
    const rows = db
      .prepare(
        `SELECT id, model FROM device_catalog
          WHERE brand=? AND device_type=? AND is_active=1`,
      )
      .all(brand, type);
    rows.sort((a, b) => naturalCompare(a.model, b.model));
    return res.json(rows.slice(0, limit));
  }

  // LIKE with an escaped pattern — the raw query can contain % or _ which
  // would otherwise turn a typo into a wildcard scan of the whole brand.
  const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = db
    .prepare(
      `SELECT id, model FROM device_catalog
        WHERE brand=? AND device_type=? AND is_active=1
          AND model LIKE ? ESCAPE '\\' COLLATE NOCASE
        ORDER BY
          CASE WHEN model LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 0 ELSE 1 END,
          LENGTH(model) ASC,
          model COLLATE NOCASE ASC
        LIMIT ?`,
    )
    .all(brand, type, `%${esc}%`, `${esc}%`, limit);
  if (rows.length) return res.json(rows);

  // Nothing matched literally. That is overwhelmingly because the seller
  // typed Arabic — "ايفون 13 برو" can never LIKE-match a Latin catalogue
  // row — and the picker's response to an empty list is to offer "use what
  // I typed", which is precisely how the catalogue filled up with
  // free-text Arabic model names in the first place.
  //
  // So fall back to the same transliterating matcher the name-cleanup job
  // uses, and answer with real catalogue devices instead of nothing.
  const fuzzy = suggestFromText(brand, q, type, limit);
  res.json(fuzzy);
});

// "My device isn't in the list" → queue it for admin review.
//
// This never blocks the listing: the seller's free-typed model is already
// saved on the listing itself. This row just asks an admin to add the device
// to the catalog so the *next* seller finds it in the dropdown.
r.post('/device-suggestions', requireAuth(), (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const model = String(req.body?.model || '').trim();
  const type = asType(req.body?.device_type);
  const listingId = Number(req.body?.listing_id) || null;

  if (!brand || !model) return res.status(400).json({ error: 'brand_and_model_required' });
  if (model.length > 80) return res.status(400).json({ error: 'model_too_long' });

  // Already in the catalog? Then the seller just didn't find it (spelling,
  // or they searched the wrong type). Tell the client so it can re-point at
  // the existing entry instead of filing a duplicate for an admin to close.
  const existing = db
    .prepare(
      `SELECT id, model FROM device_catalog
        WHERE brand=? AND device_type=? AND model=? COLLATE NOCASE AND is_active=1`,
    )
    .get(brand, type, model);
  if (existing) return res.json({ ok: true, already_in_catalog: true, device: existing });

  // Per-user daily cap. Cheap abuse guard: a suggestion costs an admin a
  // review, so one user can't queue hundreds from a scripted client.
  const t = now();
  const recent = db
    .prepare('SELECT COUNT(*) AS n FROM device_suggestions WHERE user_id=? AND created_at > ?')
    .get(req.user.id, t - 24 * 60 * 60 * 1000).n;
  if (recent >= 10) return res.status(429).json({ error: 'too_many_suggestions' });

  // Collapse duplicates from the same user: if they already asked for this
  // exact device and it's still pending, don't file a second row.
  const dupe = db
    .prepare(
      `SELECT id FROM device_suggestions
        WHERE user_id=? AND brand=? AND device_type=? AND model=? COLLATE NOCASE
          AND status='pending'`,
    )
    .get(req.user.id, brand, type, model);
  if (dupe) return res.json({ ok: true, id: dupe.id, duplicate: true });

  const info = db
    .prepare(
      `INSERT INTO device_suggestions(user_id, brand, device_type, model, listing_id, created_at)
       VALUES(?,?,?,?,?,?)`,
    )
    .run(req.user.id, brand, type, model, listingId, t);

  // Live-update the dashboard's pending badge without a poll.
  emitToAdmins('device_suggestion', { id: info.lastInsertRowid, brand, model, device_type: type });

  res.json({ ok: true, id: info.lastInsertRowid });
});

export default r;
