// Public promotional banners — what the mobile feed reads to decide which
// banner (if any) to inject. No auth: same public surface as /listings and
// /brands. Only ever returns ENABLED rows (the dashboard's on/off toggle).
//
//   GET /banners?placement=home&gov=Baghdad
//       → home banners targeted at that governorate plus the nationwide ones.
//   GET /banners?placement=brand&brand=Samsung&gov=Baghdad
//       → that brand's banners AND the "every brand" ones, each either
//         targeted at the governorate or nationwide.
//
// Targeting is two-dimensional (brand × governorate). Rows are ordered most-
// specific first (a Baghdad+Samsung banner before an every-brand/nationwide
// one) so the mobile side can simply take the first match. A NULL brand or
// governorate means "any". When `gov` is omitted only nationwide rows match.

import { Router } from 'express';
import { db } from '../db.js';
import { normalizeGovernorate } from '../governorates.js';
import { optionalAuth } from '../auth.js';
import { logEvent } from '../eventLog.js';

const r = Router();

r.get('/', (req, res) => {
  const placement = String(req.query.placement || '').trim();
  // Normalise so 'baghdad' / 'بغداد' / 'Baghdad' all match what's stored.
  const gov = req.query.gov ? normalizeGovernorate(String(req.query.gov)) : null;

  if (placement === 'home') {
    return res.json(
      db.prepare(
        `SELECT id, placement, brand, governorate, image_path, link_type, link_value, position
           FROM banners
          WHERE placement='home' AND enabled=1 AND COALESCE(in_feed,0)=0
            AND (governorate IS NULL OR governorate = ?)
          ORDER BY (governorate IS NULL) ASC, position ASC, id ASC`,
      ).all(gov),
    );
  }

  // In-feed slots — the pool the app cycles through, injecting one banner
  // after every 5 listings. 'feed' is virtual: stored as home+in_feed (the
  // table's CHECK predates the placement), served here as its own pool so
  // the carousel and the feed never show the same banner twice at once.
  if (placement === 'feed') {
    return res.json(
      db.prepare(
        `SELECT id, 'feed' AS placement, brand, governorate, image_path, link_type, link_value, position
           FROM banners
          WHERE placement='home' AND enabled=1 AND COALESCE(in_feed,0)=1
            AND (governorate IS NULL OR governorate = ?)
          ORDER BY (governorate IS NULL) ASC, position ASC, id ASC`,
      ).all(gov),
    );
  }

  if (placement === 'brand') {
    const brand = req.query.brand ? String(req.query.brand).trim() : null;
    return res.json(
      db.prepare(
        `SELECT id, placement, brand, governorate, image_path, link_type, link_value, position
           FROM banners
          WHERE placement='brand' AND enabled=1
            AND (brand IS NULL OR brand = ?)
            AND (governorate IS NULL OR governorate = ?)
          ORDER BY ((brand IS NULL) + (governorate IS NULL)) ASC, position ASC, id ASC`,
      ).all(brand, gov),
    );
  }

  return res.status(400).json({ error: 'bad_placement' });
});

// ─── banner analytics beacon ──────────────────────────────────────────
// The app POSTs one `impression` per banner per carousel mount (the slide
// was actually on screen, not merely fetched) and one `click` per tap,
// right before navigating. Fire-and-forget on the client and best-effort
// here: the response is always {ok:true} for a real banner, because a
// failed beacon must never surface in the shopping flow. The banner must
// exist — otherwise a bad id would grow the events table with rows no
// report can join back to anything.
r.post('/:id(\\d+)/event', optionalAuth(), (req, res) => {
  const banner = db.prepare('SELECT id FROM banners WHERE id=?').get(req.params.id);
  if (!banner) return res.status(404).json({ error: 'not_found' });
  const kind = req.body?.kind === 'click' ? 'banner_click' : 'banner_impression';
  logEvent({ type: kind, banner_id: banner.id, user_id: req.user?.id ?? null });
  res.json({ ok: true });
});

export default r;
