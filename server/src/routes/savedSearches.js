import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { isBrand } from '../brands.js';
import { isGovernorate, normalizeGovernorate } from '../governorates.js';
import { queryTokens } from '../searchNormalize.js';
import { AR_DIGITS, normalizeArabic, mapDeviceToken } from '../arabicDeviceTerms.js';
import { notify, hasNotified } from '../notify.js';

const r = Router();

const MAX_PER_USER = 20;
import { CONDITIONS } from '../conditions.js';
// Push at most once per search per this window, so a broad search doesn't
// fire a burst of notifications when several matching listings post together.
const PUSH_COOLDOWN_MS = 15 * 60 * 1000;

// Lower, digit-fold, collapse Arabic orthography, TRANSLITERATE known device
// words, strip spaces.
//
// The transliteration step is the one that earns its keep. Without it this
// was a pure orthography fold, which meant «ايفون ١٣» normalised to
// "ايفون13" and "iPhone 13" to "iphone13" — two different strings for the
// same phone. Every consumer of this function compares an Arabic-typed
// thing to a Latin-typed one, so all three were silently half-blind:
//
//   - a saved search whose haystack is a listing's own Arabic description,
//     matched against query tokens that were ALREADY transliterated by
//     queryTokens() — so the two sides were never in the same alphabet;
//   - a wishlist entry, compared model-to-model;
//   - a device request, compared to a seller's listing.
//
// The vocabulary is arabicDeviceTerms.js, the same table buyer search, the
// device picker and the nightly name cleanup use. Adding a product line
// there fixes all of them at once, which is exactly why it lives in one
// file. Unknown tokens pass through untouched, so an Arabic word that is
// not a device term («كفاله») still matches an Arabic description.
//
// The cost, stated: for the free-text haystack this trades a little
// precision for a lot of recall. A handful of dictionary keys are ordinary
// Arabic words — «ساعه» (hour) maps to "watch", «ان» to "n" — so a
// description saying «خلال ساعة» now contains the token "watch". That only
// bites when the SEARCHER typed something that maps to the same token, and
// against it stands the common case this fixes: Iraqi sellers write model
// names in Arabic in the description, and a saved search for "iPhone" could
// not see «ايفون» at all.
//
// NOT identical to arabicNormalizeSql() any more, and deliberately so:
// that expression is a chain of REPLACEs evaluated per row, and a hundred
// more of them on every browse query is not worth the same reach. The two
// are never compared against each other — each is used on both sides of
// its own comparison — so this is a capability difference, not drift.
export function norm(s) {
  const folded = normalizeArabic(String(s || '').toLowerCase())
    .replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] || d);
  return folded
    // Split letter↔digit boundaries first, or «ايفون13» is one unknown
    // token and never reaches the dictionary. expandQuery does the same.
    .replace(/([؀-ۿ])(\d)/g, '$1 $2')
    .replace(/(\d)([؀-ۿ])/g, '$1 $2')
    .split(/[\s،,.\-_/]+/)
    .filter(Boolean)
    .map(mapDeviceToken)
    .join('')
    .replace(/\s+/g, '');
}

// Validate + normalize an incoming criteria object into what we store. Drops
// unknown keys and anything that fails validation (so a bad brand can't make
// a search that never matches OR errors at alert time).
function sanitizeCriteria(input) {
  const c = {};
  if (input?.brand && isBrand(String(input.brand))) c.brand = String(input.brand);
  if (input?.governorate) {
    const g = normalizeGovernorate(input.governorate);
    if (g && isGovernorate(g)) c.governorate = g;
  }
  if (input?.condition && CONDITIONS.includes(String(input.condition))) c.condition = String(input.condition);
  const mn = Number(input?.min_price); if (Number.isFinite(mn) && mn > 0) c.min_price = Math.floor(mn);
  const mx = Number(input?.max_price); if (Number.isFinite(mx) && mx > 0) c.max_price = Math.floor(mx);
  if (input?.model) c.model = String(input.model).trim().slice(0, 80);
  if (input?.q) c.q = String(input.q).trim().slice(0, 100);
  return c;
}

// Does a listing satisfy a stored criteria object?
export function matchesCriteria(listing, c) {
  if (c.brand && listing.brand !== c.brand) return false;
  if (c.governorate && listing.governorate !== c.governorate) return false;
  if (c.condition && listing.condition !== c.condition) return false;
  const price = Number(listing.asking_price);
  if (c.min_price != null && price < c.min_price) return false;
  if (c.max_price != null && price > c.max_price) return false;
  if (c.model || c.q) {
    const hay = norm(`${listing.brand} ${listing.model} ${listing.description || ''}`);
    for (const field of [c.model, c.q]) {
      if (!field) continue;
      const toks = queryTokens(String(field));
      if (toks.length && !toks.every((t) => hay.includes(t))) return false;
    }
  }
  return true;
}

// Fire alerts for a freshly created listing. Called (best-effort) from the
// listing-create paths. One alert per user per listing even if several of
// their searches match; the seller never gets alerted about their own post.
// In-app notification is always recorded; the PUSH is throttled per search.
export function alertOnNewListing(listing) {
  try {
    if (!listing || listing.status !== 'active') return;
    const searches = db.prepare('SELECT * FROM saved_searches WHERE alerts_enabled=1').all();
    if (searches.length === 0) return;
    const t = now();
    const doneUsers = new Set();
    for (const s of searches) {
      if (s.user_id === listing.seller_id || doneUsers.has(s.user_id)) continue;
      let c;
      try { c = JSON.parse(s.criteria_json); } catch { continue; }
      if (!matchesCriteria(listing, c)) continue;

      const cooled = !s.last_notified_at || (t - s.last_notified_at) > PUSH_COOLDOWN_MS;
      notify(
        s.user_id,
        'saved_search.match',
        { search_id: s.id, listing_id: listing.id, brand: listing.brand, model: listing.model, price: listing.asking_price },
        cooled
          ? {
            title: 'إعلان جديد يطابق بحثك المحفوظ',
            body: `${listing.brand} ${listing.model} — ${Number(listing.asking_price).toLocaleString('en-US')} د.ع`,
          }
          : null,
      );
      if (cooled) db.prepare('UPDATE saved_searches SET last_notified_at=? WHERE id=?').run(t, s.id);
      doneUsers.add(s.user_id);
    }
  } catch (e) {
    console.error('[saved-search] alert failed:', e?.message);
  }
}

// A listing's price dropped: alert saved searches that the listing NEWLY
// matches — it satisfies the criteria at the new price but did NOT at the
// old one (those users were already alerted when the listing was created).
// In practice this fires for searches with a max_price the listing just
// crossed downward.
export function alertOnPriceDrop(listing, oldPrice) {
  try {
    if (!listing || listing.status !== 'active') return;
    const searches = db.prepare('SELECT * FROM saved_searches WHERE alerts_enabled=1').all();
    if (searches.length === 0) return;
    const t = now();
    const doneUsers = new Set();
    for (const s of searches) {
      if (s.user_id === listing.seller_id || doneUsers.has(s.user_id)) continue;
      let c;
      try { c = JSON.parse(s.criteria_json); } catch { continue; }
      if (!matchesCriteria(listing, c)) continue;
      if (matchesCriteria({ ...listing, asking_price: oldPrice }, c)) continue;
      // Once per listing per user: a price bouncing across the threshold
      // must not re-alert on every downward crossing.
      if (hasNotified(s.user_id, 'saved_search.match', listing.id)) { doneUsers.add(s.user_id); continue; }

      const cooled = !s.last_notified_at || (t - s.last_notified_at) > PUSH_COOLDOWN_MS;
      notify(
        s.user_id,
        'saved_search.match',
        { search_id: s.id, listing_id: listing.id, brand: listing.brand, model: listing.model, price: listing.asking_price, price_drop: true },
        cooled
          ? {
            title: 'جهاز يطابق بحثك أصبح أرخص 🔻',
            body: `${listing.brand} ${listing.model} — الآن ${Number(listing.asking_price).toLocaleString('en-US')} د.ع`,
          }
          : null,
      );
      if (cooled) db.prepare('UPDATE saved_searches SET last_notified_at=? WHERE id=?').run(t, s.id);
      doneUsers.add(s.user_id);
    }
  } catch (e) {
    console.error('[saved-search] price-drop alert failed:', e?.message);
  }
}

function publicRow(row) {
  let criteria = {};
  try { criteria = JSON.parse(row.criteria_json); } catch {}
  return {
    id: row.id, label: row.label || null, criteria,
    alerts_enabled: !!row.alerts_enabled, created_at: row.created_at,
  };
}

// ─── endpoints ───────────────────────────────────────────────────────
r.get('/saved-searches', requireAuth(), (req, res) => {
  const rows = db.prepare('SELECT * FROM saved_searches WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map(publicRow));
});

r.post('/saved-searches', requireAuth(), (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id=?').get(req.user.id).n;
  if (count >= MAX_PER_USER) return res.status(400).json({ error: 'too_many_saved_searches' });

  const criteria = sanitizeCriteria(req.body?.criteria || req.body);
  if (Object.keys(criteria).length === 0) return res.status(400).json({ error: 'empty_criteria' });

  const label = req.body?.label ? String(req.body.label).trim().slice(0, 60) : null;
  const alerts = req.body?.alerts_enabled === false ? 0 : 1;
  const id = db.prepare(
    'INSERT INTO saved_searches(user_id, label, criteria_json, alerts_enabled, created_at) VALUES(?,?,?,?,?)',
  ).run(req.user.id, label, JSON.stringify(criteria), alerts, now()).lastInsertRowid;
  res.json(publicRow(db.prepare('SELECT * FROM saved_searches WHERE id=?').get(id)));
});

r.patch('/saved-searches/:id(\\d+)', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM saved_searches WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const fields = [];
  const params = [];
  if (typeof req.body?.alerts_enabled === 'boolean') {
    fields.push('alerts_enabled=?'); params.push(req.body.alerts_enabled ? 1 : 0);
  }
  if (req.body?.label !== undefined) {
    fields.push('label=?'); params.push(req.body.label ? String(req.body.label).trim().slice(0, 60) : null);
  }
  if (req.body?.criteria) {
    const c = sanitizeCriteria(req.body.criteria);
    if (Object.keys(c).length === 0) return res.status(400).json({ error: 'empty_criteria' });
    fields.push('criteria_json=?'); params.push(JSON.stringify(c));
  }
  if (fields.length === 0) return res.json(publicRow(row));
  params.push(row.id);
  db.prepare(`UPDATE saved_searches SET ${fields.join(', ')} WHERE id=?`).run(...params);
  res.json(publicRow(db.prepare('SELECT * FROM saved_searches WHERE id=?').get(row.id)));
});

r.delete('/saved-searches/:id(\\d+)', requireAuth(), (req, res) => {
  const info = db.prepare('DELETE FROM saved_searches WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

export default r;
