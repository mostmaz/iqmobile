import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { isBrand } from '../brands.js';
import { isGovernorate, normalizeGovernorate } from '../governorates.js';
import { queryTokens } from '../searchNormalize.js';
import { notify } from '../notify.js';

const r = Router();

const MAX_PER_USER = 20;
const CONDITIONS = ['new', 'used', 'repaired', 'refurbished'];
// Push at most once per search per this window, so a broad search doesn't
// fire a burst of notifications when several matching listings post together.
const PUSH_COOLDOWN_MS = 15 * 60 * 1000;

// Mirror of arabicNormalizeSql (server/src/searchNormalize.js) in JS: lower,
// digit-fold, collapse Arabic orthography, strip spaces. Applied to both the
// listing haystack and (via queryTokens) the query so matching behaves the
// same as the real /listings search.
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه').replace(/ـ/g, '')
    .replace(/٠/g, '0').replace(/١/g, '1').replace(/٢/g, '2').replace(/٣/g, '3').replace(/٤/g, '4')
    .replace(/٥/g, '5').replace(/٦/g, '6').replace(/٧/g, '7').replace(/٨/g, '8').replace(/٩/g, '9')
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
