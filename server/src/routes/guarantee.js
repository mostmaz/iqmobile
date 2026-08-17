// ضمان iQ Mobile — buyer-facing routes for the guarantee service.
//
// The buyer's only powers are: ask us to buy a used device (one tap), watch
// the order move, and back out before we've committed to the seller. All
// money numbers are recomputed here from the listing row — the app's quote
// is display-only (same rule as COD checkout: clients send ids, never money).

import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { pushToAdmins } from '../adminPush.js';
import { quoteFor } from '../guarantee.js';

const r = Router();

// Iraqi phone normaliser — same shapes the rest of the app accepts
// (+964, 00964, spaces/dashes) collapsing to the canonical 0XXXXXXXXXX.
function normalizeIraqiPhone(input) {
  if (!input) return null;
  let d = String(input).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  if (!d.startsWith('0')) d = '0' + d;
  if (d.length < 10 || d.length > 12) return null;
  return d;
}

// "GR-1042" — sequential like the COD "IQ-" codes, so support can eyeball
// recency, and derived from the id so uniqueness needs no retry loop.
const guaranteeCode = (id) => `GR-${1000 + Number(id)}`;

// ─── create ───────────────────────────────────────────────────────────
r.post('/orders', requireAuth(), (req, res) => {
  const listingId = Number(req.body?.listing_id);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: 'bad_listing' });
  }
  const phone = normalizeIraqiPhone(req.body?.buyer_phone);
  if (!phone) return res.status(400).json({ error: 'bad_phone' });

  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listingId);
  if (!listing) return res.status(404).json({ error: 'not_found' });
  if (listing.seller_id === req.user.id) return res.status(403).json({ error: 'own_listing' });

  // Distinct codes for "this was never a guarantee device" vs "it was, but
  // it just sold" — the app words them differently.
  const quote = quoteFor(listing);
  if (!quote) {
    return res.status(409).json({
      error: listing.status !== 'active' ? 'listing_unavailable' : 'not_eligible',
    });
  }

  // One open order per listing per buyer. Tapping twice must not summon two
  // phone calls from two different operators.
  const open = db.prepare(
    `SELECT id FROM guarantee_orders
      WHERE listing_id=? AND buyer_id=? AND status NOT IN ('delivered','cancelled')`,
  ).get(listingId, req.user.id);
  if (open) return res.status(409).json({ error: 'already_requested' });

  const t = now();
  const cover = db.prepare(
    'SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC LIMIT 1',
  ).get(listingId);

  let row;
  db.transaction(() => {
    // code is NOT NULL UNIQUE and the id isn't known before the insert —
    // same placeholder-then-update dance the COD checkout does.
    const ins = db.prepare(
      `INSERT INTO guarantee_orders(
         code, listing_id, brand, model, storage, color, image_path,
         governorate, asking_price, fee_pct, fee, total,
         buyer_id, buyer_phone, seller_id, seller_phone, seller_opted_in,
         status, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?)`,
    ).run(
      `tmp-${t}-${Math.floor(Math.random() * 1e6)}`,
      listingId, listing.brand, listing.model, listing.storage, listing.color,
      cover ? cover.image_path : null,
      listing.governorate, listing.asking_price, quote.pct, quote.fee, quote.total,
      req.user.id, phone, listing.seller_id, listing.contact_phone || null,
      quote.seller_opted_in ? 1 : 0,
      t, t,
    );
    db.prepare('UPDATE guarantee_orders SET code=? WHERE id=?')
      .run(guaranteeCode(ins.lastInsertRowid), ins.lastInsertRowid);
    row = db.prepare('SELECT * FROM guarantee_orders WHERE id=?').get(ins.lastInsertRowid);
  })();

  // Operators hear about it instantly; failures must never fail the order.
  pushToAdmins(
    'guarantee.new',
    'طلب ضمان جديد',
    `${row.code} · ${row.brand} ${row.model} · ${Number(row.total).toLocaleString('en-US')} د.ع`,
    { guarantee_id: row.id, code: row.code },
  ).catch(() => {});

  res.json(row);
});

// ─── mine ─────────────────────────────────────────────────────────────
r.get('/mine', requireAuth(), (req, res) => {
  res.json(
    db.prepare(
      'SELECT * FROM guarantee_orders WHERE buyer_id=? ORDER BY created_at DESC LIMIT 50',
    ).all(req.user.id),
  );
});

// ─── buyer cancel ─────────────────────────────────────────────────────
// Only before we've committed to the seller. From seller_confirmed on, a
// human at iQ has made promises on the buyer's behalf — backing out then is
// a phone call to us, not a button.
r.post('/:id(\\d+)/cancel', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM guarantee_orders WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.buyer_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (!['new', 'buyer_confirmed'].includes(row.status)) {
    return res.status(409).json({ error: 'not_cancellable' });
  }
  db.prepare(
    `UPDATE guarantee_orders
        SET status='cancelled', cancel_reason='cancelled_by_buyer',
            cancelled_stage=?, updated_at=?
      WHERE id=?`,
  ).run(row.status, now(), row.id);
  res.json(db.prepare('SELECT * FROM guarantee_orders WHERE id=?').get(row.id));
});

export default r;
