import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { createLimiter } from '../limits.js';
import { FEATURE_TIERS, CARRIERS, OWNER_PHONE, TRANSFER_NUMBERS, USSD_TEMPLATES, QI_CARD, CARRIER_PREFIXES, tierFor } from '../featureTiers.js';

const r = Router();

// Same Iraqi-phone normaliser used across the codebase. Local copy to avoid
// cross-router coupling (mirrors routes/listings.js).
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

// Public — the mobile "feature this listing" sheet reads the tier catalog,
// the per-carrier receiving numbers, and the USSD templates the app fills
// ({amount}/{number}) to open the dialer. No secrets here.
r.get('/features/tiers', (_req, res) => {
  res.json({
    tiers: FEATURE_TIERS,
    carriers: CARRIERS,
    owner_phone: OWNER_PHONE,
    transfer_numbers: TRANSFER_NUMBERS,
    ussd_templates: USSD_TEMPLATES,
    qi_card: QI_CARD,
    carrier_prefixes: CARRIER_PREFIXES,
  });
});

// Seller files a request to feature one of their own listings. We don't take
// payment in-app: they transfer airtime to OWNER_PHONE, then submit this with
// the carrier + the number they paid from so the owner can match the transfer.
// The request lands as 'pending'; an admin approves it from the dashboard.
r.post('/listings/:id(\\d+)/feature-request', requireAuth(), createLimiter, (req, res) => {
  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(req.params.id);
  if (!listing || listing.status === 'removed') return res.status(404).json({ error: 'not_found' });
  if (listing.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });

  const tier = tierFor(String(req.body?.tier || '').trim());
  if (!tier) return res.status(400).json({ error: 'bad_tier' });

  const carrier = String(req.body?.carrier || '').trim().toLowerCase();
  if (!CARRIERS.includes(carrier)) return res.status(400).json({ error: 'bad_carrier' });

  // Qi Card: the matcher is the sender's account NAME (their Qi app
  // shows it on the transfer); phone is optional. Airtime carriers: the
  // sender phone is required and must belong to the same network.
  let senderPhone = null;
  let senderName = null;
  if (carrier === 'qicard') {
    senderName = String(req.body?.sender_name || '').trim().slice(0, 80);
    if (senderName.length < 2) return res.status(400).json({ error: 'bad_sender_name' });
    senderPhone = normalizeIraqiPhone(req.body?.sender_phone); // optional
  } else {
    senderPhone = normalizeIraqiPhone(req.body?.sender_phone);
    if (!senderPhone) return res.status(400).json({ error: 'bad_sender_phone' });
    const pfx = CARRIER_PREFIXES[carrier];
    if (pfx && !senderPhone.startsWith(pfx)) {
      return res.status(400).json({ error: 'bad_sender_prefix' });
    }
  }

  const note = req.body?.note ? String(req.body.note).trim().slice(0, 280) : null;

  // One open request per listing — block a second pending submission so the
  // owner's queue doesn't fill with duplicates of the same listing.
  const pending = db.prepare(
    "SELECT id FROM feature_requests WHERE listing_id=? AND status='pending'",
  ).get(listing.id);
  if (pending) return res.status(409).json({ error: 'request_pending', request_id: pending.id });

  const id = db.prepare(
    `INSERT INTO feature_requests(
      listing_id, user_id, tier, amount, days, boosts_per_day,
      carrier, sender_phone, sender_name, note, status, created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?)`,
  ).run(
    listing.id, req.user.id, tier.key, tier.amount, tier.days, tier.boosts_per_day,
    carrier, senderPhone, senderName, note, now(),
  ).lastInsertRowid;

  res.json(db.prepare('SELECT * FROM feature_requests WHERE id=?').get(id));
});

// Cancel the caller's own PENDING request for a listing — the "لم أحوّل
// الرصيد بعد" escape hatch. A user who opened the dialer but never completed
// the transfer would otherwise be stuck behind the one-pending-per-listing
// guard with no way to restart the flow. Approved/rejected requests are
// immutable history and can't be cancelled.
r.delete('/listings/:id(\\d+)/feature-request', requireAuth(), (req, res) => {
  const result = db.prepare(
    "DELETE FROM feature_requests WHERE listing_id=? AND user_id=? AND status='pending'",
  ).run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'no_pending_request' });
  res.json({ ok: true });
});

// The seller's own feature requests, newest first, with a thin listing label
// so the app can show "بانتظار الموافقة / مفعّل / مرفوض" per listing.
r.get('/features/mine', requireAuth(), (req, res) => {
  const rows = db.prepare(
    `SELECT f.*, l.brand, l.model, l.featured_until
     FROM feature_requests f
     JOIN phone_listings l ON l.id = f.listing_id
     WHERE f.user_id=? ORDER BY f.created_at DESC LIMIT 100`,
  ).all(req.user.id);
  res.json(rows);
});

export default r;
