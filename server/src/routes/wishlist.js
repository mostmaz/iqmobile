// Wish list — "I want THIS device at THIS price or less".
//
// Distinct from saved searches: a wish is one exact device (catalog model)
// plus the buyer's price ceiling, not stored browse filters. A wish fires
// when a matching listing appears — either newly posted, or an existing
// listing whose price drops through the ceiling (see alertWishlistOnPriceDrop,
// called from the price-change dispatcher in priceWatches.js).
//
// Model matching is exact on the normalized name (same normalization the
// saved-search matcher uses): "iPhone 13" ≠ "iPhone 13 Pro", but Arabic
// digit/orthography variants of the same name still match.

import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { isBrand } from '../brands.js';
import { notify, hasNotified } from '../notify.js';
import { norm } from './savedSearches.js';

const r = Router();

const MAX_PER_USER = 20;
// One push per wish per this window — a burst of matching listings (e.g. a
// shop bulk-posting) collapses to a single push; in-app rows still record all.
const PUSH_COOLDOWN_MS = 15 * 60 * 1000;

function publicRow(row) {
  return { id: row.id, brand: row.brand, model: row.model, max_price: row.max_price, created_at: row.created_at };
}

function matchesWish(listing, w) {
  return (
    listing.brand === w.brand &&
    norm(listing.model) === norm(w.model) &&
    Number(listing.asking_price) <= w.max_price
  );
}

// Shared alert core. `filter` decides which wishes qualify beyond the basic
// match — the price-drop path only alerts wishes the listing NEWLY satisfies.
function fireAlerts(listing, extraFilter, pushTitle) {
  try {
    if (!listing || listing.status !== 'active') return;
    const wishes = db.prepare('SELECT * FROM wishlist_items').all();
    if (wishes.length === 0) return;
    const t = now();
    for (const w of wishes) {
      if (w.user_id === listing.seller_id) continue;
      if (!matchesWish(listing, w)) continue;
      if (extraFilter && !extraFilter(w)) continue;
      // Once per listing per user: a bouncing price must not re-alert on
      // every downward crossing of the wish ceiling.
      if (hasNotified(w.user_id, 'wishlist.match', listing.id)) continue;

      const cooled = !w.last_notified_at || (t - w.last_notified_at) > PUSH_COOLDOWN_MS;
      notify(
        w.user_id,
        'wishlist.match',
        { wish_id: w.id, listing_id: listing.id, brand: listing.brand, model: listing.model, price: listing.asking_price, max_price: w.max_price },
        cooled
          ? {
            title: pushTitle,
            body: `${listing.brand} ${listing.model} — ${Number(listing.asking_price).toLocaleString('en-US')} د.ع (حدّك ${Number(w.max_price).toLocaleString('en-US')})`,
          }
          : null,
      );
      if (cooled) db.prepare('UPDATE wishlist_items SET last_notified_at=? WHERE id=?').run(t, w.id);
    }
  } catch (e) {
    console.error('[wishlist] alert failed:', e?.message);
  }
}

// A fresh listing was posted — fire every wish it satisfies.
export function alertWishlistOnListing(listing) {
  fireAlerts(listing, null, 'جهاز من قائمة رغباتك متوفر الآن 🎯');
}

// An existing listing's price dropped — fire only wishes it NEWLY satisfies
// (ceiling sits between the new and old price), so a wish that already fired
// when the listing was posted doesn't fire again on every discount.
export function alertWishlistOnPriceDrop(listing, oldPrice) {
  fireAlerts(listing, (w) => Number(oldPrice) > w.max_price, 'جهاز من قائمة رغباتك أصبح ضمن ميزانيتك 🔻');
}

// ─── endpoints ───────────────────────────────────────────────────────
r.get('/wishlist', requireAuth(), (req, res) => {
  const rows = db.prepare('SELECT * FROM wishlist_items WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map(publicRow));
});

r.post('/wishlist', requireAuth(), (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const model = String(req.body?.model || '').trim().slice(0, 80);
  const maxPrice = Math.floor(Number(req.body?.max_price));
  if (!brand || !isBrand(brand)) return res.status(400).json({ error: 'bad_brand' });
  if (!model) return res.status(400).json({ error: 'model_required' });
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) return res.status(400).json({ error: 'bad_price' });

  const count = db.prepare('SELECT COUNT(*) AS n FROM wishlist_items WHERE user_id=?').get(req.user.id).n;
  const existing = db.prepare('SELECT id FROM wishlist_items WHERE user_id=? AND brand=? AND model=?')
    .get(req.user.id, brand, model);
  if (!existing && count >= MAX_PER_USER) return res.status(400).json({ error: 'too_many_wishes' });

  // Same device wished twice = update the ceiling, not a duplicate row.
  const id = db.prepare(
    `INSERT INTO wishlist_items(user_id, brand, model, max_price, created_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(user_id, brand, model) DO UPDATE SET max_price=excluded.max_price`,
  ).run(req.user.id, brand, model, maxPrice, now()).lastInsertRowid;

  const row = existing
    ? db.prepare('SELECT * FROM wishlist_items WHERE id=?').get(existing.id)
    : db.prepare('SELECT * FROM wishlist_items WHERE id=?').get(id);
  res.json(publicRow(row));
});

r.patch('/wishlist/:id(\\d+)', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM wishlist_items WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const maxPrice = Math.floor(Number(req.body?.max_price));
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) return res.status(400).json({ error: 'bad_price' });
  db.prepare('UPDATE wishlist_items SET max_price=? WHERE id=?').run(maxPrice, row.id);
  res.json(publicRow(db.prepare('SELECT * FROM wishlist_items WHERE id=?').get(row.id)));
});

r.delete('/wishlist/:id(\\d+)', requireAuth(), (req, res) => {
  const info = db.prepare('DELETE FROM wishlist_items WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

export default r;
