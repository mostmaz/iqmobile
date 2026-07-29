// Price watches — "tell me if THIS listing gets cheaper".
//
// A watch stores price_at_watch = the lowest price the watcher has been
// alerted about (seeded with the price when they tapped watch). An alert
// fires only when the listing's price falls BELOW that, and the column then
// moves down to the new price — so each new low alerts exactly once, and a
// seller bouncing the price up and down can't re-trigger the same alert.
//
// This module also owns alertOnPriceChange(), the single dispatcher both
// edit paths (seller PATCH + admin dashboard) call after a price change.
// It fans out to: listing watchers (here), saved-search threshold crossings,
// and wish-list ceilings.

import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { notify } from '../notify.js';
import { alertOnPriceDrop } from './savedSearches.js';
import { alertWishlistOnPriceDrop } from './wishlist.js';

const r = Router();

// Fan out alerts for a listing whose asking_price just changed. No-op unless
// the price actually decreased. Callers run this via setImmediate so the
// HTTP response is never delayed (and a notify failure can't 500 the edit).
export function alertOnPriceChange(listing, oldPrice) {
  try {
    const newPrice = Number(listing?.asking_price);
    const old = Number(oldPrice);
    if (!Number.isFinite(newPrice) || !Number.isFinite(old) || newPrice >= old) return;

    // 1) Watchers of this specific listing.
    if (listing.status === 'active' || listing.status === 'reserved') {
      const watchers = db
        .prepare('SELECT * FROM price_watches WHERE listing_id=? AND price_at_watch > ?')
        .all(listing.id, newPrice);
      for (const w of watchers) {
        if (w.user_id === listing.seller_id) continue;
        notify(
          w.user_id,
          'price.drop',
          { listing_id: listing.id, brand: listing.brand, model: listing.model, old_price: old, new_price: newPrice },
          {
            title: 'انخفض سعر إعلان تراقبه 🔻',
            body: `${listing.brand} ${listing.model} — الآن ${newPrice.toLocaleString('en-US')} د.ع بدلاً من ${old.toLocaleString('en-US')}`,
          },
        );
        db.prepare('UPDATE price_watches SET price_at_watch=? WHERE id=?').run(newPrice, w.id);
      }
    }

    // 2) Saved searches the listing newly matches at the lower price.
    alertOnPriceDrop(listing, old);
    // 3) Wish-list ceilings the price just crossed downward.
    alertWishlistOnPriceDrop(listing, old);
  } catch (e) {
    console.error('[price-watch] alert failed:', e?.message);
  }
}

// ─── endpoints ───────────────────────────────────────────────────────
// Watch / re-watch. Re-watching resets price_at_watch to the CURRENT price,
// which is what a user tapping the bell again expects ("from now on").
r.post('/listings/:id(\\d+)/price-watch', requireAuth(), (req, res) => {
  const listing = db.prepare('SELECT id, seller_id, asking_price, status FROM phone_listings WHERE id=?')
    .get(req.params.id);
  if (!listing || listing.status === 'removed') return res.status(404).json({ error: 'not_found' });
  if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'own_listing' });

  db.prepare(
    `INSERT INTO price_watches(user_id, listing_id, price_at_watch, created_at)
     VALUES(?,?,?,?)
     ON CONFLICT(user_id, listing_id) DO UPDATE SET price_at_watch=excluded.price_at_watch`,
  ).run(req.user.id, listing.id, listing.asking_price, now());
  res.json({ ok: true, watching: true, price_at_watch: listing.asking_price });
});

r.delete('/listings/:id(\\d+)/price-watch', requireAuth(), (req, res) => {
  db.prepare('DELETE FROM price_watches WHERE user_id=? AND listing_id=?').run(req.user.id, req.params.id);
  res.json({ ok: true, watching: false });
});

export default r;
