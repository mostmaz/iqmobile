import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now, getSetting, setSettingValue } from '../../db.js';
import { parseShopPhones, sanitizeUrl, shopImages } from '../shops.js';
import { issueToken, requireAdmin } from '../../auth.js';
import { registerStoreRoutes } from './store.js';
import { applyStatusToStock, restoreStockForOrder } from '../../stock.js';
import { resolveListingName, resetCatalogCache } from '../../listingNameNormalize.js';
import { pushTo } from '../../push.js';
import { authLimiter } from '../../limits.js';
import { getBrandsWithCounts, invalidateBrandsCache, isBrand, brandNames } from '../../brands.js';
import { normalizeGovernorate } from '../../governorates.js';
import { parseCsvRow, detectBrand } from '../../importParse.js';
import { bufferConfigured, bufferChannels, publishToChannels } from '../../buffer.js';
import { notify } from '../../notify.js';
import { tierFor, tierTiming } from '../../featureTiers.js';
import { arabicNormalizeSql, expandQuery } from '../../searchNormalize.js';
import { alertOnPriceChange } from '../priceWatches.js';
import { inspectionConfigured, inspectionEnabled, inspectListingAsync } from '../../listingInspect.js';

// Iraqi phone normaliser — duplicated from routes/listings.js so the
// admin quick-add accepts the same input shapes (+964, 00964, with
// spaces/dashes, etc.) and persists the canonical 0XXXXXXXXXX form.
// Kept local rather than exported to avoid cross-router coupling.
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

const r = Router();

// In-memory multer for the Import upload — the CSV is parsed inline,
// rows go straight into import_jobs as JSON. Cap at 5 MB; a single CSV
// of 1000+ FB posts is typically well under 1 MB.
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Disk multer for the per-job image upload. Same hygiene as
// routes/chats.js + routes/listings.js — block SVG-renamed-to-jpeg
// and any extension/MIME we don't recognise (stored-XSS class
// vulnerability if the mobile <Image> ever falls back to a webview).
const UPLOADS = path.resolve('./uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
// Total photos a listing may hold. Must stay in sync with MAX_IMAGES in
// routes/listings.js — the mobile gallery and the seller-facing upload
// endpoint both assume the same ceiling.
const MAX_LISTING_IMAGES = 10;
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
function pickSafeExt(originalname, mimetype) {
  const ext = (path.extname(originalname || '') || '').toLowerCase();
  if (ALLOWED_IMAGE_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      // Same filename shape as the Samsung seed staging
      // (`lst_<16hex>.<ext>`) so all listing-image files share a
      // recognisable prefix.
      const ext = pickSafeExt(file.originalname, file.mimetype);
      cb(null, 'lst_' + crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  // 5 MB × 10 files per request matches what the mobile create-listing
  // flow caps at. We expect the admin to drop 1-5 images per FB post.
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) return cb(new Error('not_image'));
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (ext && !ALLOWED_IMAGE_EXT.has(ext)) return cb(new Error('not_image'));
    cb(null, true);
  },
});

// Admin login uses the same rate limit as user login — five attempts per
// minute. A leaked admin username without this would be brute-forceable
// in seconds.
r.post('/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    return res.status(401).json({ error: 'bad_credentials' });
  const token = issueToken({ id: row.id, kind: 'admin', username: row.username });
  res.json({ token, admin: { id: row.id, username: row.username } });
});

// ─── settings ────────────────────────────────────────────────────────
r.get('/settings', requireAdmin, (_req, res) => {
  res.json({
    listing_ttl_days: Number(getSetting('listing_ttl_days')) || 30,
    reserve_on_confirm: getSetting('reserve_on_confirm') === '1',
    // Default on when unset. Toggle off to re-cap shops at the 8/min limit.
    shops_unlimited_listings: getSetting('shops_unlimited_listings') !== '0',
    // Default on: show every listing regardless of TTL (nothing expires).
    listings_never_expire: getSetting('listings_never_expire') !== '0',

    // Update floor. '0' = nothing enforced.
    min_supported_version: getSetting('min_supported_version') || '0',
    nag_below_version: getSetting('nag_below_version') || '0',

    // Home overlay.
    overlay_enabled: getSetting('overlay_enabled') === '1',
    overlay_title: getSetting('overlay_title') || '',
    overlay_body: getSetting('overlay_body') || '',
    overlay_image: getSetting('overlay_image') || '',
    overlay_cta_label: getSetting('overlay_cta_label') || '',
    overlay_cta_url: getSetting('overlay_cta_url') || '',
    overlay_version: getSetting('overlay_version') || '1',
    overlay_frequency: getSetting('overlay_frequency') || 'once',
  });
});

r.patch('/settings', requireAdmin, (req, res) => {
  const { listing_ttl_days, reserve_on_confirm, shops_unlimited_listings, listings_never_expire } = req.body || {};
  if (listing_ttl_days != null) {
    const n = Number(listing_ttl_days);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'bad_ttl' });
    setSettingValue('listing_ttl_days', n);
  }
  if (reserve_on_confirm != null) {
    setSettingValue('reserve_on_confirm', reserve_on_confirm ? '1' : '0');
  }
  if (shops_unlimited_listings != null) {
    setSettingValue('shops_unlimited_listings', shops_unlimited_listings ? '1' : '0');
  }
  if (listings_never_expire != null) {
    setSettingValue('listings_never_expire', listings_never_expire ? '1' : '0');
  }
  // AI listing inspection. Auto-reject is deliberately independent: turning
  // inspection on only starts flagging, never removing.
  if (req.body?.listing_inspection_enabled != null) {
    setSettingValue('listing_inspection_enabled', req.body.listing_inspection_enabled ? '1' : '0');
  }
  if (req.body?.listing_inspection_autoreject != null) {
    setSettingValue('listing_inspection_autoreject', req.body.listing_inspection_autoreject ? '1' : '0');
  }
  // Update floor + home overlay. Free-text so the operator controls copy,
  // link and image without a deploy; stored verbatim and escaped at render.
  for (const k of [
    'min_supported_version', 'nag_below_version',
    'overlay_title', 'overlay_body', 'overlay_image',
    'overlay_cta_label', 'overlay_cta_url', 'overlay_version', 'overlay_frequency',
  ]) {
    if (req.body?.[k] != null) setSettingValue(k, String(req.body[k]).slice(0, 500));
  }
  if (req.body?.overlay_enabled != null) {
    setSettingValue('overlay_enabled', req.body.overlay_enabled ? '1' : '0');
  }
  res.json({ ok: true });
});

// ─── users ────────────────────────────────────────────────────────────
r.get('/users', requireAdmin, (req, res) => {
  // Cap q to 64 chars before LIKE-wrapping. Without a cap, a 10KB q
  // gets concatenated into the SQL bind and travels to better-sqlite3
  // for every comparison — pointless work that a typo or fuzz call
  // can trigger.
  const q = req.query.q ? String(req.query.q).slice(0, 64) : '';
  let sql = 'SELECT id, phone, display_name, governorate, city, rating_avg, rating_count, verified, created_at FROM users';
  const params = [];
  if (q) {
    sql += ' WHERE phone LIKE ? OR display_name LIKE ?';
    const like = '%' + q + '%';
    params.push(like, like);
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params).map((u) => ({ ...u, verified: !!u.verified }));
  res.json(rows);
});

r.patch('/users/:id(\\d+)/verify', requireAdmin, (req, res) => {
  const verified = req.body?.verified ? 1 : 0;
  const r2 = db.prepare('UPDATE users SET verified=? WHERE id=?').run(verified, req.params.id);
  if (r2.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ─── listings ─────────────────────────────────────────────────────────
r.get('/listings', requireAdmin, (req, res) => {
  const { status } = req.query;
  const q = String(req.query.q || '').trim().slice(0, 60);

  const conds = [];
  const params = [];
  if (status) { conds.push('l.status=?'); params.push(status); }
  // Scope to one seller — how the storefront page loads just its own stock
  // instead of paging through the whole marketplace.
  const sellerId = Number(req.query.seller_id);
  if (Number.isInteger(sellerId) && sellerId > 0) { conds.push('l.seller_id=?'); params.push(sellerId); }

  // Search across the things an operator actually has to hand: a listing id
  // from a report, a phone number from a complaint, or a device name. Run in
  // SQL rather than filtering the loaded page — the list is capped at 200 of
  // ~700 listings, so client-side filtering could never reach an older one,
  // which is exactly when someone needs to find it.
  if (q) {
    const like = `%${q}%`;
    // A bare number is almost always a listing id being looked up; still
    // OR it against the text columns so "13" also finds "iPhone 13".
    const idMatch = /^\d+$/.test(q) ? 'l.id = ? OR ' : '';
    conds.push(`(${idMatch}l.brand LIKE ? OR l.model LIKE ? OR l.description LIKE ?
                 OR u.display_name LIKE ? OR u.phone LIKE ?
                 OR ${arabicNormalizeSql('l.model')} LIKE ?)`);
    if (idMatch) params.push(Number(q));
    params.push(like, like, like, like, like);
    // Arabic-normalised copy of the query, matched against the identically
    // normalised model column, so "ايفون" finds a model stored "أيفون".
    const norm = (expandQuery(q).pop() || q).toLowerCase().replace(/\s+/g, '');
    params.push(`%${norm}%`);
  }

  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  // Cover photo + photo count come along on the list itself. The moderator
  // console renders a thumbnail per card, and fetching /listings/:id/images
  // for each of 200 rows would be 200 extra round-trips over mobile data.
  const sql = `
    SELECT l.*, u.display_name AS seller_name, u.phone AS seller_phone,
           (SELECT image_path FROM listing_images
             WHERE listing_id = l.id ORDER BY position ASC, id ASC LIMIT 1) AS cover_image,
           (SELECT COUNT(*) FROM listing_images WHERE listing_id = l.id) AS image_count,
           (SELECT cost_price FROM listing_costs WHERE listing_id = l.id) AS cost_price
    FROM phone_listings l JOIN users u ON u.id = l.seller_id${where}
    ORDER BY l.created_at DESC LIMIT 200`;
  res.json(db.prepare(sql).all(...params));
});

// Quick-add: create a listing from the admin dashboard. Find-or-create
// the seller user keyed on phone (same logic as the import-approve
// handler below) so the operator can type a phone + brand + model +
// price and have the listing live in one POST. Used by the "Quick Add"
// form on the admin Listings page.
r.post('/listings', requireAdmin, (req, res) => {
  const phone = normalizeIraqiPhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'bad_phone' });

  const brand = String(req.body?.brand || '').trim();
  const model = String(req.body?.model || '').trim().slice(0, 80);
  const askingPrice = Number(req.body?.asking_price);
  const governorate = normalizeGovernorate(req.body?.governorate);
  const condition = String(req.body?.condition || 'used').trim();
  const storage = String(req.body?.storage || '').trim().slice(0, 16);
  const color = String(req.body?.color || '').trim().slice(0, 30);
  const city = String(req.body?.city || '').trim().slice(0, 60);
  const description = String(req.body?.description || '').trim().slice(0, 2000);
  const wa = req.body?.contact_whatsapp ? normalizeIraqiPhone(req.body.contact_whatsapp) : null;
  const displayNameInput = String(req.body?.display_name || '').trim();
  // Price-only listings (e.g. the El Ryan website source in the aggregator):
  // no contact at all. The app hides the call/WhatsApp row when both contact
  // fields are null, so this creates a pure price entry with no buy button.
  const noContact = !!req.body?.no_contact;

  if (!brand || !model || !governorate) return res.status(400).json({ error: 'missing_fields' });
  if (!isBrand(brand)) return res.status(400).json({ error: 'bad_brand' });
  // Same "Other" → real-brand upgrade as the mobile create path, so a
  // quick-add typed as Other but with a recognisable model still lands
  // under the right brand.
  let finalBrand = brand;
  if (brand === 'Other') {
    const guess = detectBrand(`${model} ${description}`, null);
    if (guess && guess !== 'Other' && isBrand(guess)) finalBrand = guess;
  }
  if (!Number.isFinite(askingPrice) || askingPrice <= 0) return res.status(400).json({ error: 'bad_price' });
  if (!['new', 'used', 'repaired', 'refurbished'].includes(condition)) return res.status(400).json({ error: 'bad_condition' });
  if (req.body?.contact_whatsapp && !wa) return res.status(400).json({ error: 'bad_contact_whatsapp' });

  // find-or-create the seller. Mirrors the /admin/import/:id/approve path.
  let seller = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!seller) {
    const displayName = (displayNameInput || `مستخدم ${phone.slice(-4)}`).slice(0, 50);
    const id = db.prepare(
      `INSERT INTO users(phone, password_hash, display_name, governorate,
                          seller_type, is_guest, created_at)
       VALUES(?, '', ?, ?, 'individual', 0, ?)`,
    ).run(phone, displayName, governorate, now()).lastInsertRowid;
    seller = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  }

  const TTL_MS = (Number(getSetting('listing_ttl_days')) || 30) * 24 * 60 * 60 * 1000;
  const t = now();
  const listingId = db.prepare(`
    INSERT INTO phone_listings(
      seller_id, brand, model, storage, color, condition,
      battery_health, warranty_status, accessories_json, asking_price,
      governorate, city, description, status,
      contact_phone, contact_whatsapp,
      created_at, expires_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    seller.id, finalBrand, model, storage || null, color || null, condition,
    null, null, '[]', askingPrice,
    governorate, city || null, description || null, 'active',
    noContact ? null : phone, noContact ? null : wa,
    t, t + TTL_MS, t,
  ).lastInsertRowid;

  res.json({ ok: true, listing_id: listingId, seller_id: seller.id });
});

// Edit an existing listing from the dashboard. Partial update — only the
// keys actually present in the body are touched, so the UI can send just
// the fields the operator changed without having to round-trip the whole
// row. Every field reuses the same validators as POST /listings above so
// an edit can't write a value the create path would have rejected.
//
// Deliberately NOT editable here: seller_id (moving a listing between
// accounts would orphan chats/deals that reference the original seller)
// and the featured_* columns (those have their own endpoint below, which
// also maintains the boost schedule).
r.patch('/listings/:id(\\d+)', requireAdmin, (req, res) => {
  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'not_found' });

  const b = req.body || {};
  const fields = [];
  const params = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

  if (has('brand')) {
    const brand = String(b.brand || '').trim();
    if (!brand) return res.status(400).json({ error: 'missing_fields' });
    if (!isBrand(brand)) return res.status(400).json({ error: 'bad_brand' });
    fields.push('brand=?'); params.push(brand);
  }
  if (has('model')) {
    const model = String(b.model || '').trim().slice(0, 80);
    if (!model) return res.status(400).json({ error: 'missing_fields' });
    fields.push('model=?'); params.push(model);
  }
  if (has('asking_price')) {
    const price = Number(b.asking_price);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'bad_price' });
    fields.push('asking_price=?'); params.push(price);
  }
  if (has('governorate')) {
    const gov = normalizeGovernorate(b.governorate);
    if (!gov) return res.status(400).json({ error: 'bad_governorate' });
    fields.push('governorate=?'); params.push(gov);
  }
  if (has('condition')) {
    const condition = String(b.condition || '').trim();
    if (!['new', 'used', 'repaired', 'refurbished'].includes(condition)) {
      return res.status(400).json({ error: 'bad_condition' });
    }
    fields.push('condition=?'); params.push(condition);
  }
  if (has('status')) {
    // Same set the mobile PATCH /listings/:id accepts. 'expired' is
    // excluded on purpose — that transition is owned by the expirer job,
    // so letting an operator set it by hand would be immediately undone.
    if (!['active', 'reserved', 'sold', 'removed'].includes(b.status)) {
      return res.status(400).json({ error: 'bad_status' });
    }
    fields.push('status=?'); params.push(b.status);
    // Same sale stamp as the seller-side PATCH — see routes/listings.js.
    if (b.status !== listing.status) {
      if (b.status === 'sold') { fields.push('sold_at=?'); params.push(now()); }
      else if (listing.status === 'sold') { fields.push('sold_at=?'); params.push(null); }
    }
  }
  if (has('contact_whatsapp')) {
    // Empty string clears the number; anything non-empty must normalise.
    const raw = String(b.contact_whatsapp || '').trim();
    if (!raw) { fields.push('contact_whatsapp=?'); params.push(null); }
    else {
      const wa = normalizeIraqiPhone(raw);
      if (!wa) return res.status(400).json({ error: 'bad_contact_whatsapp' });
      fields.push('contact_whatsapp=?'); params.push(wa);
    }
  }
  if (has('contact_phone')) {
    // Same empty→NULL semantics. Used to turn a listing "price-only" (no call
    // button) when a no-contact source like El Ryan becomes its cheapest price.
    const raw = String(b.contact_phone || '').trim();
    if (!raw) { fields.push('contact_phone=?'); params.push(null); }
    else {
      const cp = normalizeIraqiPhone(raw);
      if (!cp) return res.status(400).json({ error: 'bad_contact_phone' });
      fields.push('contact_phone=?'); params.push(cp);
    }
  }
  // Free-text columns: trimmed, length-capped, empty → NULL so the
  // mobile client's `field || fallback` checks behave consistently.
  for (const [key, max] of [['city', 60], ['storage', 16], ['color', 30], ['description', 2000]]) {
    if (!has(key)) continue;
    const v = String(b[key] ?? '').trim().slice(0, max);
    fields.push(`${key}=?`); params.push(v || null);
  }

  // Units in stock. Explicit null/'' clears it back to UNTRACKED, which is
  // different from 0 (0 means sold out and hides the product).
  // Key specs. Written to EVERY variant of this product in this shop, not
  // just the row being edited: screen/chipset/battery don't change with
  // storage, and asking the operator to retype them per capacity guarantees
  // the 128GB and 256GB rows eventually disagree.
  let specsOp = null;
  if (has('specs')) {
    const raw = Array.isArray(b.specs) ? b.specs : null;
    if (raw === null) return res.status(400).json({ error: 'bad_specs' });
    const clean = raw
      .map((x) => ({
        label: String(x?.label ?? '').trim().slice(0, 40),
        value: String(x?.value ?? '').trim().slice(0, 120),
      }))
      .filter((x) => x.label && x.value)
      .slice(0, 20);
    specsOp = clean.length ? JSON.stringify(clean) : null;
  }

  if (has('price_on_request')) {
    fields.push('price_on_request=?'); params.push(b.price_on_request ? 1 : 0);
  }
  if (has('stock_qty')) {
    const raw = b.stock_qty;
    if (raw === null || raw === '') { fields.push('stock_qty=?'); params.push(null); }
    else {
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n) || n < 0 || n > 100000) return res.status(400).json({ error: 'bad_stock' });
      fields.push('stock_qty=?'); params.push(n);
    }
  }

  // cost_price is NOT a column on phone_listings — see the listing_costs
  // table in db.js. Public listing routes spread a SELECT-star row into
  // their response, so a cost column there would leak the shop's supplier
  // price to buyers. Written separately, below the main update.
  let costOp = null;
  if (has('cost_price')) {
    const raw = b.cost_price;
    if (raw === null || raw === '') costOp = { clear: true };
    else {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || n < 0 || n > 1000000000) return res.status(400).json({ error: 'bad_cost' });
      costOp = { value: n };
    }
  }

  if (fields.length === 0 && !costOp && specsOp === null && !has('specs')) {
    return res.status(400).json({ error: 'no_fields' });
  }

  if (has('specs')) {
    const n = db.prepare(
      `UPDATE phone_listings SET specs_json=?, updated_at=?
        WHERE seller_id=? AND brand=? AND LOWER(TRIM(model))=LOWER(TRIM(?))`,
    ).run(specsOp, now(), listing.seller_id, listing.brand, listing.model).changes;
    if (!fields.length && !costOp) {
      const only = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listing.id);
      return res.json({ ok: true, listing: only, specs_applied_to: n });
    }
  }

  if (costOp) {
    if (costOp.clear) db.prepare('DELETE FROM listing_costs WHERE listing_id=?').run(listing.id);
    else {
      db.prepare(
        `INSERT INTO listing_costs(listing_id, cost_price, updated_at) VALUES(?,?,?)
         ON CONFLICT(listing_id) DO UPDATE SET cost_price=excluded.cost_price, updated_at=excluded.updated_at`,
      ).run(listing.id, costOp.value, now());
    }
  }
  if (fields.length === 0) {
    const only = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listing.id);
    return res.json({ ok: true, listing: only });
  }

  fields.push('updated_at=?'); params.push(now());
  params.push(listing.id);
  db.prepare(`UPDATE phone_listings SET ${fields.join(', ')} WHERE id=?`).run(...params);

  const updated = db.prepare(`
    SELECT l.*, u.display_name AS seller_name, u.phone AS seller_phone
    FROM phone_listings l JOIN users u ON u.id = l.seller_id
    WHERE l.id=?
  `).get(listing.id);
  // Dashboard price cut? Same alert fan-out as the seller edit path
  // (listing watchers + saved searches + wish lists), post-response.
  if (updated.asking_price < listing.asking_price) {
    setImmediate(() => alertOnPriceChange(updated, listing.asking_price));
  }
  res.json({ ok: true, listing: updated });
});

// (POST /listings/:id/ingest-image lives further down, next to the shop
// ingest it mirrors. Two copies of this route existed for a while — Express
// matches the first, so the later, stricter one was dead code.)

// Attach images to a listing created via Quick Add. The admin web
// compresses each photo client-side (canvas → JPEG q=0.8 @ max 1600px)
// before uploading, so the server only needs to validate MIME + write
// to disk + add listing_images rows. Per-position is appended at the
// end of any existing images. Returns the full list back so the UI can
// confirm what landed.
r.post('/listings/:id(\\d+)/images', requireAdmin, imageUpload.array('images', 10), (req, res) => {
  const listing = db.prepare('SELECT id FROM phone_listings WHERE id=?').get(req.params.id);
  // Multer may have already written files before we know the listing
  // doesn't exist — clean them up so we don't leak orphans on the
  // disk that uploads/ lives on.
  const cleanup = () => { for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch {} } };
  if (!listing) { cleanup(); return res.status(404).json({ error: 'not_found' }); }
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'no_files' });

  // Multer's array('images', 10) only caps a SINGLE request. Adding photos
  // from the edit modal is repeatable, so without a total check a listing
  // could drift past the 10 the mobile client (and its gallery) expects.
  const existing = db.prepare('SELECT COUNT(*) AS n FROM listing_images WHERE listing_id=?')
    .get(listing.id).n;
  if (existing + req.files.length > MAX_LISTING_IMAGES) {
    cleanup();
    return res.status(400).json({ error: 'too_many_images', existing, max: MAX_LISTING_IMAGES });
  }

  const t = now();
  const startPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM listing_images WHERE listing_id=?')
    .get(listing.id).next;
  const ins = db.prepare(
    'INSERT INTO listing_images(listing_id, image_path, position, created_at) VALUES(?,?,?,?)',
  );
  const added = [];
  req.files.forEach((f, idx) => {
    const imagePath = `/uploads/${f.filename}`;
    const id = ins.run(listing.id, imagePath, startPos + idx, t).lastInsertRowid;
    // Return the row id too — the edit modal needs it to delete a photo
    // it just added without having to refetch the whole list.
    added.push({ id, image_path: imagePath, position: startPos + idx });
  });
  db.prepare('UPDATE phone_listings SET updated_at=? WHERE id=?').run(t, listing.id);
  res.json({ ok: true, added });
});

// Images currently attached to a listing. The edit modal fetches this on
// open so the operator can see what's there before adding/removing.
r.get('/listings/:id(\\d+)/images', requireAdmin, (req, res) => {
  const listing = db.prepare('SELECT id FROM phone_listings WHERE id=?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'not_found' });
  const images = db.prepare(
    `SELECT id, image_path, position FROM listing_images
     WHERE listing_id=? ORDER BY position ASC, id ASC`,
  ).all(listing.id);
  res.json({ images, max: MAX_LISTING_IMAGES });
});

// Remove a single photo. Mirrors the seller-facing
// DELETE /listings/:id/images/:imageId — unlink from disk first (best
// effort; a missing file shouldn't block the row delete) then drop the
// row. Remaining positions are re-packed so the gallery doesn't end up
// with gaps that shift the cover photo unexpectedly.
r.delete('/listings/:id(\\d+)/images/:imageId(\\d+)', requireAdmin, (req, res) => {
  const listing = db.prepare('SELECT id FROM phone_listings WHERE id=?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'not_found' });
  const img = db.prepare('SELECT * FROM listing_images WHERE id=? AND listing_id=?')
    .get(req.params.imageId, listing.id);
  if (!img) return res.status(404).json({ error: 'not_found' });

  try { fs.unlinkSync(path.join(UPLOADS, path.basename(img.image_path))); } catch {}
  db.transaction(() => {
    db.prepare('DELETE FROM listing_images WHERE id=?').run(img.id);
    const rest = db.prepare(
      'SELECT id FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC',
    ).all(listing.id);
    const setPos = db.prepare('UPDATE listing_images SET position=? WHERE id=?');
    rest.forEach((row, i) => setPos.run(i, row.id));
  })();
  db.prepare('UPDATE phone_listings SET updated_at=? WHERE id=?').run(now(), listing.id);
  res.json({ ok: true });
});

// Lookup endpoint for the quick-add form's duplicate-phone indicator —
// returns the count of non-removed listings the typed phone already owns,
// plus a short list so the operator can verify before submitting.
r.get('/listings/by-phone', requireAdmin, (req, res) => {
  const phone = normalizeIraqiPhone(req.query?.phone);
  if (!phone) return res.json({ count: 0, listings: [] });
  const rows = db.prepare(`
    SELECT l.id, l.brand, l.model, l.status, l.asking_price, l.created_at
    FROM phone_listings l
    JOIN users u ON u.id = l.seller_id
    WHERE u.phone = ? AND l.status != 'removed'
    ORDER BY l.created_at DESC
    LIMIT 10
  `).all(phone);
  res.json({ count: rows.length, listings: rows });
});

// Batch soft-delete. Body: { ids: [number, ...] }. Returns how many
// rows actually changed (some ids may have already been status='removed'
// or never existed — server doesn't fail the whole batch for those).
// Wrapped in a transaction so a typo on row 50 doesn't leave 49 already
// updated.
r.patch('/listings/remove-batch', requireAdmin, (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!raw || raw.length === 0) return res.status(400).json({ error: 'missing_ids' });
  // Defensive coercion — accept stringy numbers from JSON, drop anything
  // that doesn't look like a positive integer. Caps batch at 500 so a
  // runaway client can't hammer one giant statement.
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (ids.length === 0) return res.status(400).json({ error: 'no_valid_ids' });
  const t = now();
  const placeholders = ids.map(() => '?').join(',');
  const stmt = db.prepare(
    `UPDATE phone_listings SET status='removed', updated_at=?
     WHERE id IN (${placeholders}) AND status != 'removed'`,
  );
  const result = db.transaction(() => stmt.run(t, ...ids))();
  res.json({ ok: true, removed: result.changes });
});

// Mark/clear the "last known price" flag on a batch of listings. Used by the
// price-aggregator refresh: stale=true greys a device that dropped off every
// source's price list ("آخر سعر معروف · غير متوفر حالياً"); stale=false
// revives one that came back. Stamping only touches rows not already stale so
// a long-unavailable device keeps its original drop-off date (which drives the
// expirer's 6-month auto-removal).
r.patch('/listings/stale-batch', requireAdmin, (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!raw || raw.length === 0) return res.status(400).json({ error: 'missing_ids' });
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 1000);
  if (ids.length === 0) return res.status(400).json({ error: 'no_valid_ids' });
  const stale = !!req.body?.stale;
  const t = now();
  const placeholders = ids.map(() => '?').join(',');
  const sql = stale
    ? `UPDATE phone_listings SET stale_since=?, updated_at=? WHERE id IN (${placeholders}) AND stale_since IS NULL`
    : `UPDATE phone_listings SET stale_since=NULL, updated_at=? WHERE id IN (${placeholders}) AND stale_since IS NOT NULL`;
  const params = stale ? [t, t, ...ids] : [t, ...ids];
  const changed = db.prepare(sql).run(...params).changes;
  res.json({ ok: true, stale, changed });
});

// Manual feature/unfeature — for sellers who pay directly (WhatsApp / cash)
// without filing an in-app request. days>0 features from now for that many
// days (boost cadence defaults to 3×/day); days=0 clears the featured state.
r.patch('/listings/:id(\\d+)/feature', requireAdmin, (req, res) => {
  const l = db.prepare('SELECT id FROM phone_listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'not_found' });
  const days = Number(req.body?.days);
  if (!Number.isFinite(days) || days < 0) return res.status(400).json({ error: 'bad_days' });
  const t = now();
  if (days === 0) {
    db.prepare(
      `UPDATE phone_listings
       SET featured_until=NULL, feature_tier=NULL, boosted_at=NULL, next_boost_at=NULL, boost_interval_ms=NULL
       WHERE id=?`,
    ).run(l.id);
    return res.json({ ok: true, featured_until: null });
  }
  const bpd = Number(req.body?.boosts_per_day) > 0 ? Math.floor(Number(req.body.boosts_per_day)) : 3;
  const interval = Math.floor(DAY_MS / bpd);
  const until = t + days * DAY_MS;
  db.prepare(
    `UPDATE phone_listings
     SET featured_until=?, feature_tier='manual', boosted_at=?, next_boost_at=?, boost_interval_ms=?
     WHERE id=?`,
  ).run(until, t, t + interval, interval, l.id);
  res.json({ ok: true, featured_until: until });
});

r.patch('/listings/:id(\\d+)/remove', requireAdmin, (req, res) => {
  // Return 404 when the listing doesn't exist so the admin UI doesn't
  // silently 200 on probes or fat-finger IDs. Matches the
  // /users/:id/verify pattern above.
  const r2 = db.prepare("UPDATE phone_listings SET status='removed', updated_at=? WHERE id=?")
    .run(now(), req.params.id);
  if (r2.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ─── reports ──────────────────────────────────────────────────────────
r.get('/reports', requireAdmin, (req, res) => {
  const status = req.query.status || 'open';
  const rows = db.prepare(
    `SELECT r.*, u.display_name AS reporter_name, u.phone AS reporter_phone
     FROM reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.status=? ORDER BY r.created_at DESC LIMIT 200`,
  ).all(status);
  res.json(rows);
});

r.patch('/reports/:id(\\d+)', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['reviewed','dismissed','open'].includes(status)) return res.status(400).json({ error: 'bad_status' });
  // Same 404-on-no-row treatment as /listings/:id/remove.
  const r2 = db.prepare('UPDATE reports SET status=? WHERE id=?').run(status, req.params.id);
  if (r2.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ─── deals ────────────────────────────────────────────────────────────
r.get('/deals', requireAdmin, (req, res) => {
  const status = req.query.status || 'seller_confirmed';
  const rows = db.prepare(
    `SELECT d.*, l.brand, l.model,
            b.display_name AS buyer_name, s.display_name AS seller_name
     FROM deals d
     JOIN phone_listings l ON l.id = d.listing_id
     JOIN users b ON b.id = d.buyer_id
     JOIN users s ON s.id = d.seller_id
     WHERE d.status=? ORDER BY d.updated_at DESC LIMIT 200`,
  ).all(status);
  res.json(rows);
});

// ─── bypass attempts ─────────────────────────────────────────────────
r.get('/bypass-attempts', requireAdmin, (_req, res) => {
  const rows = db.prepare(
    `SELECT b.id, b.chat_id, b.user_id, b.raw_text, b.matched_pattern, b.created_at,
            u.display_name AS user_name, u.phone AS user_phone
     FROM bypass_attempts b JOIN users u ON u.id = b.user_id
     ORDER BY b.created_at DESC LIMIT 200`,
  ).all();
  res.json(rows);
});

// ─── push notifications ──────────────────────────────────────────────
// Send a one-off test push to a specific user. Useful for verifying
// the pipeline end-to-end after device pairing — admin curls this with
// their own user_id and checks the phone.
r.post('/push/test', requireAdmin, async (req, res) => {
  const { user_id, title, body, data } = req.body || {};
  const id = Number(user_id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_user_id' });
  const t = title || 'iQ Mobile';
  const b = body || 'إشعار تجريبي من السيرفر';
  await pushTo([id], t, b, data || { kind: 'broadcast' });
  res.json({ ok: true, user_id: id });
});

// Broadcast a push to every non-guest user with a registered token.
// Use sparingly — Expo's free push quota is generous but not infinite.
//
// Two-step flow to make a typo expensive:
//   1) Call with ?dry=1 (or { dry: true } in body). Returns the recipient
//      count + a preview echo of the title/body. No notifications are sent.
//   2) Call without dry=1 AND with ?confirm=1 in the query. Sends the
//      broadcast. Missing confirm flag = 400 instead of a quiet send.
//
// The two-step guards against the case where someone hits Enter on a
// draft push without re-reading — a single typo otherwise reaches every
// installed device with no recall.
r.post('/push/broadcast', requireAdmin, async (req, res) => {
  const { title, body, data } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'missing_fields' });
  const isDry = req.query.dry === '1' || req.body?.dry === true;
  const isConfirmed = req.query.confirm === '1';
  const rows = db.prepare(
    `SELECT id FROM users
     WHERE is_guest=0
       AND expo_push_token IS NOT NULL
       AND expo_push_token <> ''`,
  ).all();
  const ids = rows.map((r) => r.id);

  if (isDry) {
    return res.json({ ok: true, dry: true, would_send_to: ids.length, title, body });
  }
  if (!isConfirmed) {
    return res.status(400).json({
      error: 'confirm_required',
      hint: 'add ?confirm=1 to actually send, or ?dry=1 for a recipient-count preview',
      would_send_to: ids.length,
    });
  }

  await pushTo(ids, title, body, data || { kind: 'broadcast' });
  res.json({ ok: true, recipients: ids.length });
});

// ─── brands CRUD ─────────────────────────────────────────────────────
// Brands moved from a hardcoded array (governorates.js) to the `brands`
// table so the dashboard can manage them at runtime. CRUD invalidates
// the in-memory cache in brands.js so mobile callers see the new list
// on their next /brands fetch.

// Validation: short, ASCII-ish brand identifier matching what mobile
// expects (no weird punctuation, no overlong strings).
const BRAND_NAME_RE = /^[A-Za-z0-9 +\-/.]{1,30}$/;

r.get('/brands', requireAdmin, (_req, res) => {
  res.json(getBrandsWithCounts());
});

r.post('/brands', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const display_ar = req.body?.display_ar ? String(req.body.display_ar).trim().slice(0, 60) : null;
  const positionInput = Number(req.body?.position);
  if (!BRAND_NAME_RE.test(name)) return res.status(400).json({ error: 'bad_name' });

  // Uniqueness check up front so we can return a clean 409 instead of a
  // raw SQLite constraint error.
  const exists = db.prepare('SELECT id FROM brands WHERE name=?').get(name);
  if (exists) return res.status(409).json({ error: 'brand_exists' });

  // Default position = last in the list so admins don't have to manage
  // ordering on first add.
  const lastPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM brands').get().p;
  const position = Number.isFinite(positionInput) && positionInput > 0 ? Math.floor(positionInput) : lastPos + 1;

  const id = db.prepare(
    'INSERT INTO brands(name, display_ar, position, created_at) VALUES(?,?,?,?)',
  ).run(name, display_ar, position, now()).lastInsertRowid;
  invalidateBrandsCache();
  res.json({ id, name, display_ar, position, count: 0 });
});

r.patch('/brands/:id(\\d+)', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM brands WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const fields = [];
  const params = [];
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!BRAND_NAME_RE.test(name)) return res.status(400).json({ error: 'bad_name' });
    if (name !== row.name) {
      const dup = db.prepare('SELECT id FROM brands WHERE name=?').get(name);
      if (dup) return res.status(409).json({ error: 'brand_exists' });
    }
    fields.push('name=?');
    params.push(name);
  }
  if (req.body?.display_ar !== undefined) {
    const ar = req.body.display_ar ? String(req.body.display_ar).trim().slice(0, 60) : null;
    fields.push('display_ar=?');
    params.push(ar);
  }
  if (req.body?.position !== undefined) {
    const p = Number(req.body.position);
    if (!Number.isFinite(p) || p < 1) return res.status(400).json({ error: 'bad_position' });
    fields.push('position=?');
    params.push(Math.floor(p));
  }
  if (fields.length === 0) return res.json(row);

  // Atomic rename: when `name` changes, ALSO update every phone_listings
  // row that used the old name. Otherwise existing listings become
  // orphaned (their `brand` doesn't match any row in the brands table).
  const newName = req.body?.name !== undefined ? String(req.body.name).trim() : row.name;
  db.transaction(() => {
    db.prepare(`UPDATE brands SET ${fields.join(', ')} WHERE id=?`).run(...params, id);
    if (newName !== row.name) {
      db.prepare('UPDATE phone_listings SET brand=? WHERE brand=?').run(newName, row.name);
    }
  })();
  invalidateBrandsCache();
  const updated = db.prepare('SELECT * FROM brands WHERE id=?').get(id);
  res.json(updated);
});

r.delete('/brands/:id(\\d+)', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM brands WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  // Refuse to drop a brand if any listing still references it — would
  // orphan those listings (their `brand` no longer matches any row).
  // Caller's job to rename / remove the listings first.
  const inUse = db.prepare(
    "SELECT COUNT(*) AS n FROM phone_listings WHERE brand=? AND status != 'removed'",
  ).get(row.name).n;
  if (inUse > 0) {
    return res.status(409).json({ error: 'brand_in_use', listings: inUse });
  }

  db.prepare('DELETE FROM brands WHERE id=?').run(id);
  invalidateBrandsCache();
  res.json({ ok: true });
});

// ─── user suspend toggle ─────────────────────────────────────────────
// Sets/clears users.suspended_at. While set, requireAuth() returns 403
// `user_suspended` for that user's token. Reverses by passing the same
// endpoint again.
r.patch('/users/:id(\\d+)/suspend', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT id, suspended_at FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const next = u.suspended_at ? null : now();
  db.prepare('UPDATE users SET suspended_at=? WHERE id=?').run(next, id);
  res.json({ id, suspended_at: next });
});

// ─── overview / KPI dashboard ────────────────────────────────────────
// One round-trip that the dashboard's landing page renders into KPI
// cards + bar charts. All queries are cheap counts over indexed columns.
r.get('/overview', requireAdmin, (_req, res) => {
  const week = now() - 7 * 24 * 60 * 60 * 1000;
  const month = now() - 30 * 24 * 60 * 60 * 1000;

  const userTotals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_guest=0 THEN 1 ELSE 0 END) AS real_users,
      SUM(CASE WHEN is_guest=1 THEN 1 ELSE 0 END) AS guests,
      SUM(CASE WHEN suspended_at IS NOT NULL THEN 1 ELSE 0 END) AS suspended,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_30d
    FROM users
  `).get(week, month);

  const listingTotals = db.prepare(`
    SELECT
      SUM(CASE WHEN status='active'  THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='sold'    THEN 1 ELSE 0 END) AS sold,
      SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN status='removed' THEN 1 ELSE 0 END) AS removed,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_30d
    FROM phone_listings
  `).get(week, month);

  const by_brand = db.prepare(`
    SELECT brand AS name, COUNT(*) AS count
    FROM phone_listings WHERE status='active'
    GROUP BY brand ORDER BY count DESC
  `).all();

  const by_governorate = db.prepare(`
    SELECT governorate AS name, COUNT(*) AS count
    FROM phone_listings WHERE status='active'
    GROUP BY governorate ORDER BY count DESC
  `).all();

  const by_condition = db.prepare(`
    SELECT condition AS name, COUNT(*) AS count
    FROM phone_listings WHERE status='active'
    GROUP BY condition ORDER BY count DESC
  `).all();

  const recent_listings = db.prepare(`
    SELECT l.id, l.brand, l.model, l.asking_price, l.governorate, l.created_at,
           u.display_name AS seller_name
    FROM phone_listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.status='active'
    ORDER BY l.created_at DESC LIMIT 8
  `).all();

  const recent_signups = db.prepare(`
    SELECT id, display_name, is_guest, created_at
    FROM users
    ORDER BY created_at DESC LIMIT 8
  `).all().map((u) => ({ ...u, is_guest: !!u.is_guest }));

  res.json({
    users: {
      total: userTotals.total || 0,
      real: userTotals.real_users || 0,
      guest: userTotals.guests || 0,
      suspended: userTotals.suspended || 0,
      new_7d: userTotals.new_7d || 0,
      new_30d: userTotals.new_30d || 0,
    },
    listings: {
      active: listingTotals.active || 0,
      sold: listingTotals.sold || 0,
      expired: listingTotals.expired || 0,
      removed: listingTotals.removed || 0,
      new_7d: listingTotals.new_7d || 0,
      new_30d: listingTotals.new_30d || 0,
    },
    by_brand,
    by_governorate,
    by_condition,
    recent_listings,
    recent_signups,
  });
});

// ─── import queue ─────────────────────────────────────────────────────
//
// Workflow:
//   1. Admin uploads a CSV (Facebook-marketplace scrape format) via
//      POST /admin/import/upload?source=<name>. Each row is parsed by
//      importParse.parseCsvRow and inserted as a pending job.
//   2. GET /admin/import/queue?status=pending returns the parsed jobs.
//   3. Admin edits any field via PATCH /admin/import/:id.
//   4. POST /admin/import/:id/approve creates the user (if needed,
//      keyed on phone) and the phone_listings row, marks the job
//      approved + links to listing_id.
//   5. POST /admin/import/:id/reject marks the job rejected.
//
// Naïve CSV parser inline below — no quotes-with-embedded-newlines
// support because the FB scrape format doesn't use them. Each line is
// split on commas honouring "..." quoted fields. If we ever need full
// RFC 4180 handling, swap in `csv-parse`.
function csvParseLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function csvParse(text) {
  // Split on actual line breaks — but a quoted cell can contain newlines.
  // We walk char-by-char to handle that. Reuses csvParseLine per row.
  const rows = [];
  let cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQ = !inQ; cur += c; }
    else if (c === '\n' && !inQ) { rows.push(cur); cur = ''; }
    else if (c === '\r' && !inQ) { /* skip */ }
    else cur += c;
  }
  if (cur.trim()) rows.push(cur);
  if (rows.length === 0) return [];
  const headers = csvParseLine(rows[0]);
  return rows.slice(1).map((line) => {
    const cells = csvParseLine(line);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ''; });
    return obj;
  });
}

r.post('/import/upload', requireAdmin, csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const source = (req.query.source || req.body?.source || 'csv').toString().slice(0, 80);
  let text;
  try { text = req.file.buffer.toString('utf8'); }
  catch { return res.status(400).json({ error: 'not_utf8' }); }
  let rows;
  try { rows = csvParse(text); }
  catch (e) { return res.status(400).json({ error: 'csv_parse_failed', detail: String(e?.message || e) }); }
  if (rows.length === 0) return res.status(400).json({ error: 'empty_csv' });

  const ins = db.prepare(
    'INSERT INTO import_jobs(source, raw_json, parsed_json, status, created_at) VALUES(?,?,?,?,?)',
  );
  const t = now();
  const txn = db.transaction(() => {
    for (const row of rows) {
      const parsed = parseCsvRow(row);
      ins.run(source, JSON.stringify(row), JSON.stringify(parsed), 'pending', t);
    }
  });
  txn();
  res.json({ inserted: rows.length, source });
});

// Short-lived, upload-only token. Used by the FB-scrape pipeline: an
// admin browser session needs to POST images to the import endpoint
// from a cross-origin page (web.facebook.com) without carrying the
// long-lived admin Bearer token through the URL/JS. The admin pulls
// one of these via curl (Authorization header), then passes it to the
// in-page script as a query param.
//
// Scope: works only for POST /admin/import/:id/images (no other admin
// action). Lifetime: 30 minutes. Single-use: marked used on first
// successful upload. Stored in-memory (Map) — fine because admin
// sessions are short and a server restart simply invalidates pending
// tokens; the admin re-issues one.
const uploadTokens = new Map(); // token → { expiresAt, used: bool }
function newUploadToken() {
  const t = crypto.randomBytes(24).toString('hex');
  uploadTokens.set(t, { expiresAt: Date.now() + 30 * 60 * 1000, used: false });
  // Garbage-collect expired entries each issue, so the Map can't grow
  // unboundedly if an admin spams the endpoint.
  const cutoff = Date.now();
  for (const [k, v] of uploadTokens) {
    if (v.expiresAt < cutoff) uploadTokens.delete(k);
  }
  return t;
}
function consumeUploadToken(t) {
  const e = uploadTokens.get(t);
  if (!e) return false;
  if (e.expiresAt < Date.now()) { uploadTokens.delete(t); return false; }
  // Note: We deliberately do NOT mark used + delete here — the same
  // admin run uploads many images, and burning the token per-image
  // means re-issuing for every image. Instead the token expires by
  // wall-clock 30 min. Single-job batches finish in seconds.
  return true;
}

r.post('/import/upload-token', requireAdmin, (_req, res) => {
  res.json({ token: newUploadToken(), expires_in: 1800 });
});

// Attach images to a pending job. Files are saved to uploads/ with the
// same lst_<hex>.<ext> shape as listing images created via the mobile
// flow; the paths are appended to parsed.uploaded_images on the job.
// On approve the existing handler walks that array and inserts a row
// per image into listing_images.
//
// We deliberately accept multipart on a pending job *without* writing
// to listing_images directly — the job might still be edited/rejected,
// and we don't want orphaned listing_images pointing at a phantom
// listing_id. Storing the paths on the job lets them be discarded
// trivially on reject (or kept as audit, see comment in reject route).
// Middleware that accepts either:
//   - Authorization: Bearer <adminToken>  (normal admin auth)
//   - ?ut=<uploadToken>                   (short-lived alternate)
// Used only on the image-upload route so the FB-scrape pipeline can
// authenticate from web.facebook.com without exposing the admin token
// in URLs / JS.
function requireAdminOrUploadToken(req, res, next) {
  const ut = req.query.ut;
  if (ut && typeof ut === 'string' && consumeUploadToken(ut)) return next();
  return requireAdmin(req, res, next);
}

r.post('/import/:id(\\d+)/images', requireAdminOrUploadToken, imageUpload.array('images', 10), (req, res) => {
  const job = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(req.params.id);
  // Clean up any files multer already wrote if the job lookup fails or
  // the job isn't pending — otherwise we leak orphan files on disk.
  const cleanupFiles = () => {
    for (const f of req.files || []) {
      try { fs.unlinkSync(f.path); } catch {}
    }
  };
  if (!job) { cleanupFiles(); return res.status(404).json({ error: 'not_found' }); }
  if (job.status !== 'pending') { cleanupFiles(); return res.status(400).json({ error: 'not_pending' }); }
  const parsed = JSON.parse(job.parsed_json || '{}');
  parsed.uploaded_images = parsed.uploaded_images || [];
  for (const f of req.files || []) {
    parsed.uploaded_images.push(`/uploads/${f.filename}`);
  }
  db.prepare('UPDATE import_jobs SET parsed_json=? WHERE id=?').run(JSON.stringify(parsed), job.id);
  res.json({ ok: true, uploaded: (req.files || []).length, images: parsed.uploaded_images });
});

// Remove one staged image from a pending job by its array index.
// Best-effort unlink — if the file is already gone (e.g. uploads/ got
// wiped) we still update the JSON to keep the queue consistent.
r.delete('/import/:id(\\d+)/images/:idx(\\d+)', requireAdmin, (req, res) => {
  const job = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  if (job.status !== 'pending') return res.status(400).json({ error: 'not_pending' });
  const parsed = JSON.parse(job.parsed_json || '{}');
  const idx = parseInt(req.params.idx, 10);
  if (!Array.isArray(parsed.uploaded_images) || idx < 0 || idx >= parsed.uploaded_images.length) {
    return res.status(404).json({ error: 'image_not_found' });
  }
  const [removed] = parsed.uploaded_images.splice(idx, 1);
  if (removed && removed.startsWith('/uploads/')) {
    // path.resolve(removed) would escape the uploads dir; use basename
    // join so a malicious path can't traverse out.
    const filename = path.basename(removed);
    try { fs.unlinkSync(path.join(UPLOADS, filename)); } catch {}
  }
  db.prepare('UPDATE import_jobs SET parsed_json=? WHERE id=?').run(JSON.stringify(parsed), job.id);
  res.json({ ok: true });
});

r.get('/import/queue', requireAdmin, (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : 'pending';
  const rows = db.prepare(
    `SELECT id, source, raw_json, parsed_json, status, notes, created_at,
            reviewed_at, listing_id
     FROM import_jobs WHERE status=? ORDER BY created_at DESC, id DESC LIMIT 500`,
  ).all(status);
  res.json(rows.map((row) => ({
    ...row,
    raw: JSON.parse(row.raw_json || '{}'),
    parsed: JSON.parse(row.parsed_json || '{}'),
  })));
});

r.patch('/import/:id(\\d+)', requireAdmin, (req, res) => {
  const job = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  if (job.status !== 'pending') return res.status(400).json({ error: 'not_pending' });
  // Merge incoming fields into parsed_json. Whitelist keys so the
  // operator can't sneak in arbitrary listing columns via this PATCH.
  const allowed = ['phone', 'whatsapp', 'display_name', 'brand', 'model',
                   'storage', 'asking_price', 'governorate', 'city',
                   'description', 'image_urls', 'warnings'];
  const cur = JSON.parse(job.parsed_json || '{}');
  for (const k of allowed) {
    if (k in (req.body || {})) cur[k] = req.body[k];
  }
  db.prepare('UPDATE import_jobs SET parsed_json=? WHERE id=?')
    .run(JSON.stringify(cur), job.id);
  res.json({ ok: true, parsed: cur });
});

r.post('/import/:id(\\d+)/reject', requireAdmin, (req, res) => {
  const job = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  if (job.status !== 'pending') return res.status(400).json({ error: 'not_pending' });
  const notes = (req.body?.notes || '').toString().slice(0, 500);
  db.prepare('UPDATE import_jobs SET status=?, notes=?, reviewed_at=? WHERE id=?')
    .run('rejected', notes || null, now(), job.id);
  res.json({ ok: true });
});

r.post('/import/:id(\\d+)/approve', requireAdmin, (req, res) => {
  const job = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  if (job.status !== 'pending') return res.status(400).json({ error: 'not_pending' });
  const p = JSON.parse(job.parsed_json || '{}');

  // Validate the minimum required fields so we don't approve junk into
  // phone_listings. The admin must fix the row first.
  const missing = [];
  if (!p.phone) missing.push('phone');
  if (!p.brand) missing.push('brand');
  if (!p.model) missing.push('model');
  if (!Number.isInteger(p.asking_price) || p.asking_price <= 0) missing.push('asking_price');
  if (!p.governorate) missing.push('governorate');
  if (missing.length) return res.status(400).json({ error: 'missing_required', missing });

  // find-or-create the seller user keyed on phone (same logic as the
  // createUsersFromListingPhones.js migration). If a user with this
  // phone exists, reuse them; if not, create a non-guest account with
  // no password (phone-login is the only entry — same shape as the
  // batch-migrated accounts).
  let seller = db.prepare('SELECT * FROM users WHERE phone=?').get(p.phone);
  if (!seller) {
    const displayName = (p.display_name && p.display_name.trim())
      || `مستخدم ${p.phone.slice(-4)}`;
    const id = db.prepare(
      `INSERT INTO users(phone, password_hash, display_name, governorate,
                          seller_type, is_guest, created_at)
       VALUES(?, '', ?, ?, 'individual', 0, ?)`,
    ).run(p.phone, displayName.slice(0, 50), p.governorate, now()).lastInsertRowid;
    seller = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  }

  // Insert the listing. We don't have condition/battery_health from the
  // CSV — default condition='used' (most-common case for FB resale) and
  // leave the other detail fields null. The admin can edit the listing
  // later via the Listings page if needed.
  const TTL_MS = 730 * 24 * 60 * 60 * 1000; // 2 years, same as Samsung seed
  const t = now();
  const insListing = db.prepare(`
    INSERT INTO phone_listings(
      seller_id, brand, model, storage, color, condition,
      battery_health, warranty_status, accessories_json, asking_price,
      governorate, city, description, status,
      contact_phone, contact_whatsapp,
      created_at, expires_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const listingId = insListing.run(
    seller.id, p.brand, p.model, p.storage || null, null, 'used',
    null, null, '[]', p.asking_price,
    p.governorate, p.city || null, (p.description || '').slice(0, 4000), 'active',
    p.phone, p.whatsapp || null,
    t, t + TTL_MS, t,
  ).lastInsertRowid;

  // Attach any staged images uploaded via /admin/import/:id/images.
  // The files are already on disk under uploads/; we just need to
  // record one listing_images row per path with sequential position.
  if (Array.isArray(p.uploaded_images) && p.uploaded_images.length > 0) {
    const insImage = db.prepare(
      'INSERT INTO listing_images(listing_id, image_path, position, created_at) VALUES(?,?,?,?)',
    );
    p.uploaded_images.forEach((imgPath, idx) => {
      insImage.run(listingId, imgPath, idx, t);
    });
  }

  db.prepare('UPDATE import_jobs SET status=?, reviewed_at=?, listing_id=? WHERE id=?')
    .run('approved', t, listingId, job.id);
  res.json({
    ok: true,
    listing_id: listingId,
    seller_id: seller.id,
    images_attached: (p.uploaded_images || []).length,
  });
});

// ─── banners CRUD ────────────────────────────────────────────────────
// Promotional banners shown on the mobile feed (placement='home', injected
// at slot 2) and on brand-filtered views (placement='brand'; brand=NULL =
// "every brand", a brand name = that brand only). Image is uploaded to
// /uploads through the same multer pipeline as listing images. Public read
// surface is routes/banners.js (enabled rows only).
const BANNER_PLACEMENTS = new Set(['home', 'brand']);
const BANNER_LINK_TYPES = new Set(['listing', 'external']);

// Best-effort cleanup of a just-uploaded file when validation rejects the
// request — otherwise a bad POST/PATCH leaves an orphan in /uploads.
function dropUpload(file) {
  if (file && file.path) { try { fs.unlinkSync(file.path); } catch { /* ignore */ } }
}

// `enabled` arrives as a string from multipart create ('0'/'1') and as a
// JSON number/bool from the toggle PATCH (0/1, false/true) — treat all the
// falsey shapes as "off".
function isOff(v) {
  return v === 0 || v === '0' || v === false || v === 'false';
}

// A listing link must point at a real listing; an external link must be a
// plain http(s) URL. Returns an error code string, or null when valid.
function validateBannerLink(link_type, link_value) {
  if (!link_value) return 'bad_link';
  if (link_type === 'listing') {
    const lid = Number(link_value);
    if (!Number.isInteger(lid) || lid <= 0) return 'bad_link';
    const exists = db.prepare('SELECT id FROM phone_listings WHERE id=?').get(lid);
    return exists ? null : 'listing_not_found';
  }
  return /^https?:\/\/.+/i.test(link_value) ? null : 'bad_link';
}

r.get('/banners', requireAdmin, (_req, res) => {
  res.json(db.prepare('SELECT * FROM banners ORDER BY placement ASC, position ASC, id ASC').all());
});

r.post('/banners', requireAdmin, imageUpload.single('image'), (req, res) => {
  const b = req.body || {};
  const fail = (code) => { dropUpload(req.file); return res.status(400).json({ error: code }); };

  if (!req.file) return res.status(400).json({ error: 'image_required' });

  const placement = String(b.placement || '').trim();
  if (!BANNER_PLACEMENTS.has(placement)) return fail('bad_placement');

  // brand only applies to brand placement; blank = "every brand" (NULL).
  const brand = (placement === 'brand' && b.brand) ? String(b.brand).trim() : null;
  if (brand && !isBrand(brand)) return fail('bad_brand');

  // governorate applies to every placement; blank = all governorates (NULL).
  const govRaw = b.governorate ? String(b.governorate).trim() : '';
  const governorate = govRaw ? normalizeGovernorate(govRaw) : null;
  if (govRaw && !governorate) return fail('bad_governorate');

  const link_type = String(b.link_type || '').trim();
  if (!BANNER_LINK_TYPES.has(link_type)) return fail('bad_link_type');

  const link_value = String(b.link_value || '').trim();
  const linkErr = validateBannerLink(link_type, link_value);
  if (linkErr) return fail(linkErr);

  const lastPos = db.prepare('SELECT COALESCE(MAX(position),0) AS p FROM banners').get().p;
  const position = (b.position !== undefined && Number.isFinite(Number(b.position)) && Number(b.position) >= 0)
    ? Math.floor(Number(b.position)) : lastPos + 1;
  const enabled = isOff(b.enabled) ? 0 : 1;
  const image_path = `/uploads/${req.file.filename}`;

  const id = db.prepare(
    `INSERT INTO banners(placement, brand, governorate, image_path, link_type, link_value, enabled, position, created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(placement, brand, governorate, image_path, link_type, link_value, enabled, position, now()).lastInsertRowid;

  res.json(db.prepare('SELECT * FROM banners WHERE id=?').get(id));
});

r.patch('/banners/:id(\\d+)', requireAdmin, imageUpload.single('image'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM banners WHERE id=?').get(id);
  if (!row) { dropUpload(req.file); return res.status(404).json({ error: 'not_found' }); }

  const b = req.body || {};
  const fail = (code) => { dropUpload(req.file); return res.status(400).json({ error: code }); };
  const fields = [];
  const params = [];

  const placement = b.placement !== undefined ? String(b.placement).trim() : row.placement;
  if (b.placement !== undefined) {
    if (!BANNER_PLACEMENTS.has(placement)) return fail('bad_placement');
    fields.push('placement=?'); params.push(placement);
  }
  if (b.brand !== undefined) {
    const brand = b.brand ? String(b.brand).trim() : null;
    if (brand && !isBrand(brand)) return fail('bad_brand');
    // brand is meaningless for the home placement — store NULL there.
    fields.push('brand=?'); params.push(placement === 'brand' ? brand : null);
  }
  if (b.governorate !== undefined) {
    const govRaw = b.governorate ? String(b.governorate).trim() : '';
    const governorate = govRaw ? normalizeGovernorate(govRaw) : null;
    if (govRaw && !governorate) return fail('bad_governorate');
    fields.push('governorate=?'); params.push(governorate);
  }
  const link_type = b.link_type !== undefined ? String(b.link_type).trim() : row.link_type;
  if (b.link_type !== undefined) {
    if (!BANNER_LINK_TYPES.has(link_type)) return fail('bad_link_type');
    fields.push('link_type=?'); params.push(link_type);
  }
  if (b.link_value !== undefined) {
    const linkErr = validateBannerLink(link_type, String(b.link_value).trim());
    if (linkErr) return fail(linkErr);
    fields.push('link_value=?'); params.push(String(b.link_value).trim());
  } else if (b.link_type !== undefined) {
    // Type changed but value left as-is — make sure the old value still fits.
    const linkErr = validateBannerLink(link_type, row.link_value);
    if (linkErr) return fail(linkErr);
  }
  if (b.enabled !== undefined) {
    fields.push('enabled=?'); params.push(isOff(b.enabled) ? 0 : 1);
  }
  if (b.position !== undefined) {
    const p = Number(b.position);
    if (!Number.isFinite(p) || p < 0) return fail('bad_position');
    fields.push('position=?'); params.push(Math.floor(p));
  }

  // A new file replaces the image; we unlink the old one after the update.
  let oldImage = null;
  if (req.file) {
    fields.push('image_path=?'); params.push(`/uploads/${req.file.filename}`);
    oldImage = row.image_path;
  }

  if (fields.length === 0) return res.json(row);
  db.prepare(`UPDATE banners SET ${fields.join(', ')} WHERE id=?`).run(...params, id);
  if (oldImage) { try { fs.unlinkSync(path.join(UPLOADS, path.basename(oldImage))); } catch { /* ignore */ } }
  res.json(db.prepare('SELECT * FROM banners WHERE id=?').get(id));
});

r.delete('/banners/:id(\\d+)', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM banners WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM banners WHERE id=?').run(id);
  try { fs.unlinkSync(path.join(UPLOADS, path.basename(row.image_path))); } catch { /* ignore */ }
  res.json({ ok: true });
});

// ─── featured-listing requests ───────────────────────────────────────
// Sellers transfer airtime to the owner and file a request (routes/features.js).
// The owner reconciles the transfer, then approves here — which pins the
// listing (featured_until + the boost schedule) — or rejects it.
const DAY_MS = 24 * 60 * 60 * 1000;

r.get('/feature-requests', requireAdmin, (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : 'pending';
  const rows = db.prepare(
    `SELECT f.*, l.brand, l.model, l.asking_price, l.governorate, l.featured_until,
            u.display_name AS user_name, u.phone AS user_phone
     FROM feature_requests f
     JOIN phone_listings l ON l.id = f.listing_id
     JOIN users u ON u.id = f.user_id
     WHERE f.status=? ORDER BY f.created_at DESC LIMIT 300`,
  ).all(status);
  res.json(rows);
});

r.post('/feature-requests/:id(\\d+)/approve', requireAdmin, (req, res) => {
  const fr = db.prepare('SELECT * FROM feature_requests WHERE id=?').get(req.params.id);
  if (!fr) return res.status(404).json({ error: 'not_found' });
  if (fr.status !== 'pending') return res.status(400).json({ error: 'not_pending' });

  // Snapshot fields are stored on the request; fall back to the live tier if
  // the catalog changed since the seller submitted.
  const tier = tierFor(fr.tier) || { days: fr.days, boosts_per_day: fr.boosts_per_day };
  const { durationMs, boostIntervalMs } = tierTiming(tier);
  const t = now();

  // Extend (don't truncate) any featured time the listing still has left.
  const listing = db.prepare('SELECT featured_until FROM phone_listings WHERE id=?').get(fr.listing_id);
  if (!listing) return res.status(404).json({ error: 'listing_gone' });
  const base = listing.featured_until && listing.featured_until > t ? listing.featured_until : t;
  const featured_until = base + durationMs;

  db.prepare(
    `UPDATE phone_listings
     SET featured_until=?, feature_tier=?, boosted_at=?, next_boost_at=?, boost_interval_ms=?
     WHERE id=?`,
  ).run(featured_until, fr.tier, t, t + boostIntervalMs, boostIntervalMs, fr.listing_id);
  db.prepare('UPDATE feature_requests SET status=?, reviewed_at=? WHERE id=?')
    .run('approved', t, fr.id);

  notify(fr.user_id, 'feature.approved',
    { listing_id: fr.listing_id, tier: fr.tier, featured_until },
    { title: 'تم تفعيل إعلانك المميّز ✨', body: 'إعلانك الآن في أعلى القائمة' });

  res.json({ ok: true, listing_id: fr.listing_id, featured_until });
});

r.post('/feature-requests/:id(\\d+)/reject', requireAdmin, (req, res) => {
  const fr = db.prepare('SELECT * FROM feature_requests WHERE id=?').get(req.params.id);
  if (!fr) return res.status(404).json({ error: 'not_found' });
  if (fr.status !== 'pending') return res.status(400).json({ error: 'not_pending' });
  db.prepare('UPDATE feature_requests SET status=?, reviewed_at=? WHERE id=?')
    .run('rejected', now(), fr.id);
  notify(fr.user_id, 'feature.rejected', { listing_id: fr.listing_id },
    { title: 'طلب التمييز', body: 'لم تتم الموافقة على طلب تمييز إعلانك — تواصل معنا للمزيد' });
  res.json({ ok: true });
});

// ─── shops ────────────────────────────────────────────────────────────
// Shops are users with seller_type='shop'. Admin can list them, flag an
// account as a shop (find-or-create by phone), edit the shop profile, grant a
// featured window (shop_featured_until), or revert to an individual account.
r.get('/shops', requireAdmin, (req, res) => {
  const q = req.query.q ? String(req.query.q).slice(0, 64) : '';
  let sql = `
    SELECT u.id, u.phone, u.display_name, u.shop_name, u.governorate, u.city,
           u.shop_phone, u.shop_whatsapp, u.shop_bio, u.shop_address,
           u.shop_image_path, u.shop_featured_until, u.verified, u.created_at,
           COALESCE(u.shop_hidden,0) AS shop_hidden,
           COALESCE(u.shop_no_contact,0) AS shop_no_contact,
           COALESCE(u.shop_orders_enabled,0) AS shop_orders_enabled,
           COALESCE(u.shop_shipping_fee,5000) AS shop_shipping_fee,
           COALESCE(u.shop_delivery_days_min,2) AS shop_delivery_days_min,
           COALESCE(u.shop_delivery_days_max,4) AS shop_delivery_days_max,
           (SELECT COUNT(*) FROM phone_listings l
            WHERE l.seller_id = u.id AND l.status != 'removed') AS listing_count
    FROM users u WHERE u.seller_type='shop'`;
  const params = [];
  if (q) {
    sql += ' AND (u.phone LIKE ? OR u.display_name LIKE ? OR u.shop_name LIKE ?)';
    const like = '%' + q + '%';
    params.push(like, like, like);
  }
  sql += ' ORDER BY (CASE WHEN u.shop_featured_until > ? THEN 1 ELSE 0 END) DESC, u.created_at DESC LIMIT 300';
  params.push(now());
  res.json(db.prepare(sql).all(...params).map((u) => ({
    ...u,
    verified: !!u.verified,
    is_featured: !!(u.shop_featured_until && u.shop_featured_until > now()),
  })));
});

r.post('/shops', requireAdmin, (req, res) => {
  const phone = normalizeIraqiPhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'bad_phone' });
  const shop_name = String(req.body?.shop_name || '').trim().slice(0, 60);
  if (shop_name.length < 2) return res.status(400).json({ error: 'bad_shop_name' });
  const governorate = normalizeGovernorate(req.body?.governorate);
  if (!governorate) return res.status(400).json({ error: 'bad_governorate' });
  const shop_bio = req.body?.shop_bio ? String(req.body.shop_bio).trim().slice(0, 500) : null;
  const shop_address = req.body?.shop_address ? String(req.body.shop_address).trim().slice(0, 200) : null;
  const shop_phone = req.body?.shop_phone ? normalizeIraqiPhone(req.body.shop_phone) : null;
  const shop_whatsapp = req.body?.shop_whatsapp ? normalizeIraqiPhone(req.body.shop_whatsapp) : null;

  let user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  const t = now();
  if (!user) {
    const id = db.prepare(
      `INSERT INTO users(phone, password_hash, display_name, governorate,
                          seller_type, is_guest, created_at,
                          shop_name, shop_bio, shop_phone, shop_whatsapp, shop_address, shop_created_at)
       VALUES(?, '', ?, ?, 'shop', 0, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(phone, shop_name, governorate, t, shop_name, shop_bio, shop_phone, shop_whatsapp, shop_address, t).lastInsertRowid;
    user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  } else {
    db.prepare(
      `UPDATE users SET seller_type='shop', shop_name=?, shop_bio=?, shop_phone=?,
              shop_whatsapp=?, shop_address=?, governorate=?,
              shop_created_at=COALESCE(shop_created_at, ?)
       WHERE id=?`,
    ).run(shop_name, shop_bio, shop_phone, shop_whatsapp, shop_address, governorate, t, user.id);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  }
  res.json({ ok: true, id: user.id });
});

r.patch('/shops/:id(\\d+)', requireAdmin, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const fields = [];
  const params = [];
  const b = req.body || {};
  if (b.shop_name !== undefined) {
    const v = String(b.shop_name).trim().slice(0, 60);
    if (v.length < 2) return res.status(400).json({ error: 'bad_shop_name' });
    fields.push('shop_name=?'); params.push(v);
  }
  if (b.shop_bio !== undefined) { fields.push('shop_bio=?'); params.push(b.shop_bio ? String(b.shop_bio).trim().slice(0, 500) : null); }
  if (b.shop_address !== undefined) { fields.push('shop_address=?'); params.push(b.shop_address ? String(b.shop_address).trim().slice(0, 200) : null); }
  if (b.shop_phone !== undefined) {
    const p = b.shop_phone ? normalizeIraqiPhone(b.shop_phone) : null;
    if (b.shop_phone && !p) return res.status(400).json({ error: 'bad_shop_phone' });
    fields.push('shop_phone=?'); params.push(p);
  }
  if (b.shop_whatsapp !== undefined) {
    const p = b.shop_whatsapp ? normalizeIraqiPhone(b.shop_whatsapp) : null;
    if (b.shop_whatsapp && !p) return res.status(400).json({ error: 'bad_shop_whatsapp' });
    fields.push('shop_whatsapp=?'); params.push(p);
  }
  if (b.shop_phones !== undefined) {
    const list = parseShopPhones(b.shop_phones);
    fields.push('shop_phones=?'); params.push(JSON.stringify(list));
    fields.push('shop_phone=?'); params.push(list[0] || null); // keep legacy primary in sync
  }
  if (b.shop_facebook !== undefined) { fields.push('shop_facebook=?'); params.push(sanitizeUrl(b.shop_facebook)); }
  if (b.shop_instagram !== undefined) { fields.push('shop_instagram=?'); params.push(sanitizeUrl(b.shop_instagram)); }
  if (b.shop_hidden !== undefined) { fields.push('shop_hidden=?'); params.push(b.shop_hidden ? 1 : 0); }
  if (b.shop_no_contact !== undefined) { fields.push('shop_no_contact=?'); params.push(b.shop_no_contact ? 1 : 0); }
  // Delegate the shop's inbox to a personal account, addressed by phone
  // (that's what the operator knows — nobody knows their own user id).
  // Empty string clears the delegation. The target must be an existing,
  // different account: pointing a shop at itself would make notify()'s
  // fan-out a no-op in the best case and a loop risk in the worst.
  if (b.shop_manager_phone !== undefined) {
    if (!b.shop_manager_phone) { fields.push('shop_manager_id=?'); params.push(null); }
    else {
      const p = normalizeIraqiPhone(b.shop_manager_phone);
      const mgr = p && db.prepare('SELECT id FROM users WHERE phone=?').get(p);
      if (!mgr) return res.status(400).json({ error: 'manager_not_found' });
      if (mgr.id === u.id) return res.status(400).json({ error: 'manager_is_shop' });
      fields.push('shop_manager_id=?'); params.push(mgr.id);
    }
  }
  // Storefront mode: add-to-cart + COD checkout on this shop's listings.
  if (b.shop_orders_enabled !== undefined) {
    fields.push('shop_orders_enabled=?'); params.push(b.shop_orders_enabled ? 1 : 0);
  }
  if (b.shop_shipping_fee !== undefined) {
    const fee = Math.round(Number(b.shop_shipping_fee));
    // 0 is legitimate (free delivery); negative or non-numeric is not.
    if (!Number.isFinite(fee) || fee < 0) return res.status(400).json({ error: 'bad_shipping_fee' });
    fields.push('shop_shipping_fee=?'); params.push(fee);
  }
  // Delivery window in days. Stated to the buyer beside the fee, because
  // "how much" was answered three times over and "when" never once.
  for (const [key, col] of [['shop_delivery_days_min', 'shop_delivery_days_min'],
                            ['shop_delivery_days_max', 'shop_delivery_days_max']]) {
    if (b[key] === undefined) continue;
    const d = Math.round(Number(b[key]));
    if (!Number.isFinite(d) || d < 1 || d > 60) return res.status(400).json({ error: 'bad_delivery_days' });
    fields.push(`${col}=?`); params.push(d);
  }
  if (b.shop_delivery_days_min !== undefined && b.shop_delivery_days_max !== undefined
      && Number(b.shop_delivery_days_min) > Number(b.shop_delivery_days_max)) {
    return res.status(400).json({ error: 'bad_delivery_range' });
  }
  if (b.governorate !== undefined) {
    const g = normalizeGovernorate(b.governorate);
    if (!g) return res.status(400).json({ error: 'bad_governorate' });
    fields.push('governorate=?'); params.push(g);
  }
  // featured_days: number of days to feature from now (0 / null clears it).
  if (b.featured_days !== undefined) {
    const d = Number(b.featured_days);
    if (!Number.isFinite(d) || d < 0) return res.status(400).json({ error: 'bad_featured_days' });
    fields.push('shop_featured_until=?'); params.push(d > 0 ? now() + d * DAY_MS : null);
  }
  if (fields.length === 0) return res.json({ ok: true });
  params.push(u.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...params);
  res.json({ ok: true });
});

// Admin-managed shop price-list images (append / remove). Mirrors the
// self-serve /shops/me/images endpoints but keyed by shop id.
r.post('/shops/:id(\\d+)/images', requireAdmin, imageUpload.array('images', 12), (req, res) => {
  const cleanup = () => { for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch {} } };
  const u = db.prepare("SELECT id FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  if (!u) { cleanup(); return res.status(404).json({ error: 'not_found' }); }
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'no_files' });
  const existing = db.prepare('SELECT COUNT(*) AS n FROM shop_images WHERE shop_id=?').get(u.id).n;
  if (existing + req.files.length > 20) { cleanup(); return res.status(400).json({ error: 'too_many_images' }); }
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM shop_images WHERE shop_id=?').get(u.id).p;
  const ins = db.prepare('INSERT INTO shop_images(shop_id, image_path, position, created_at) VALUES(?,?,?,?)');
  const t = now();
  req.files.forEach((f, i) => ins.run(u.id, '/uploads/' + f.filename, maxPos + 1 + i, t));
  res.json({ ok: true, images: shopImages(u.id) });
});

r.delete('/shops/:id(\\d+)/images/:imgId(\\d+)', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id, image_path FROM shop_images WHERE id=? AND shop_id=?').get(req.params.imgId, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM shop_images WHERE id=?').run(row.id);
  try { fs.unlinkSync(path.join(UPLOADS, path.basename(row.image_path))); } catch {}
  res.json({ ok: true, images: shopImages(req.params.id) });
});

// Ingest a shop image (logo or gallery) from a remote URL. The server
// fetches the bytes itself, so it isn't subject to the browser's CORS wall
// on Facebook's CDN — used to seed a shop's page from its public FB photos.
// `as:'logo'` sets shop_image_path; anything else appends to the shop_images
// gallery (price-list boards). Validates content-type is a real image and
// writes it under the shared lst_<hex> filename shape.
r.post('/shops/:id(\\d+)/ingest-image', requireAdmin, async (req, res) => {
  const u = db.prepare("SELECT id FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const url = String(req.body?.url || '').trim();
  const as = req.body?.as === 'logo' ? 'logo' : 'gallery';
  if (!/^https:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'bad_url' });
  const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IQMobileBot/1.0)' }, redirect: 'follow' });
    if (!resp.ok) return res.status(400).json({ error: 'fetch_failed', status: resp.status });
    const ctype = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!MIME_EXT[ctype]) return res.status(400).json({ error: 'not_image', ctype });
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 100 || buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'bad_size', bytes: buf.length });
    const filename = 'lst_' + crypto.randomBytes(12).toString('hex') + MIME_EXT[ctype];
    fs.writeFileSync(path.join(UPLOADS, filename), buf);
    // Store the public URL prefix the app resolves via fullImageUrl
    // (getBaseUrl()+path), same shape as listing images: /uploads/<file>.
    const storedPath = '/uploads/' + filename;
    if (as === 'logo') {
      db.prepare('UPDATE users SET shop_image_path=? WHERE id=?').run(storedPath, u.id);
      return res.json({ ok: true, as, image_path: storedPath });
    }
    const existing = db.prepare('SELECT COUNT(*) AS n FROM shop_images WHERE shop_id=?').get(u.id).n;
    if (existing >= 20) { try { fs.unlinkSync(path.join(UPLOADS, filename)); } catch {} return res.status(400).json({ error: 'too_many_images' }); }
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM shop_images WHERE shop_id=?').get(u.id).p;
    db.prepare('INSERT INTO shop_images(shop_id, image_path, position, created_at) VALUES(?,?,?,?)').run(u.id, storedPath, maxPos + 1, now());
    return res.json({ ok: true, as, image_path: storedPath, images: shopImages(u.id) });
  } catch (e) {
    return res.status(500).json({ error: 'ingest_failed', message: String((e && e.message) || e).slice(0, 200) });
  }
});

// Pull a device photo into a listing from a URL. Same hygiene as the shop
// ingest above (https only, real image content-type, size bounds) — used to
// give catalogue-style listings a product shot when the source had none.
// `replace` swaps the existing photos rather than appending, so re-running a
// backfill doesn't stack duplicates.
r.post('/listings/:id(\\d+)/ingest-image', requireAdmin, async (req, res) => {
  const l = db.prepare('SELECT id FROM phone_listings WHERE id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'not_found' });
  const url = String(req.body?.url || '').trim();
  if (!/^https:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'bad_url' });
  const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IQMobileBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return res.status(400).json({ error: 'fetch_failed', status: resp.status });
    const ctype = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!MIME_EXT[ctype]) return res.status(400).json({ error: 'not_image', ctype });
    const buf = Buffer.from(await resp.arrayBuffer());
    // Lower bound is deliberately well above the shop ingest's: search results
    // sometimes hand back a tracking pixel or a spinner, and those pass the
    // content-type check while being useless as a product photo.
    if (buf.length < 4000 || buf.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'bad_size', bytes: buf.length });
    }
    const filename = 'lst_' + crypto.randomBytes(12).toString('hex') + MIME_EXT[ctype];
    fs.writeFileSync(path.join(UPLOADS, filename), buf);
    const storedPath = '/uploads/' + filename;
    if (req.body?.replace) {
      for (const old of db.prepare('SELECT image_path FROM listing_images WHERE listing_id=?').all(l.id)) {
        if (old.image_path?.startsWith('/uploads/')) {
          try { fs.unlinkSync(path.join(UPLOADS, path.basename(old.image_path))); } catch {}
        }
      }
      db.prepare('DELETE FROM listing_images WHERE listing_id=?').run(l.id);
    }
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM listing_images WHERE listing_id=?').get(l.id).p;
    db.prepare('INSERT INTO listing_images(listing_id, image_path, position, created_at) VALUES(?,?,?,?)')
      .run(l.id, storedPath, maxPos + 1, now());
    db.prepare('UPDATE phone_listings SET updated_at=? WHERE id=?').run(now(), l.id);
    return res.json({ ok: true, listing_id: l.id, image_path: storedPath, bytes: buf.length });
  } catch (e) {
    return res.status(500).json({ error: 'ingest_failed', message: String((e && e.message) || e).slice(0, 200) });
  }
});

// Set/replace a shop's logo (shop_image_path) from an uploaded file. Stored
// with the /uploads/ prefix the app resolves via fullImageUrl.
r.post('/shops/:id(\\d+)/logo', requireAdmin, imageUpload.single('image'), (req, res) => {
  const u = db.prepare("SELECT id, shop_image_path FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  if (!u) { if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} } return res.status(404).json({ error: 'not_found' }); }
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  // Drop the previous logo file (only if it lived in our uploads dir).
  if (u.shop_image_path && u.shop_image_path.startsWith('/uploads/')) {
    try { fs.unlinkSync(path.join(UPLOADS, path.basename(u.shop_image_path))); } catch {}
  }
  const p = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET shop_image_path=? WHERE id=?').run(p, u.id);
  res.json({ ok: true, image_path: p });
});

r.post('/shops/:id(\\d+)/unshop', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE users SET seller_type='individual', shop_featured_until=NULL WHERE id=?").run(u.id);
  res.json({ ok: true });
});

// Shops registered since a timestamp — drives the dashboard's "new shop"
// notification. The client passes the last-seen shop_created_at it has, and
// gets back anything newer. shop_created_at is stamped once, on first
// registration, so this is exactly the "a new shop just joined" signal.
r.get('/shops/recent', requireAdmin, (req, res) => {
  const since = Number(req.query.since) || 0;
  const shops = db.prepare(
    `SELECT id, shop_name, display_name, governorate, phone, shop_created_at
     FROM users
     WHERE seller_type='shop' AND shop_created_at IS NOT NULL AND shop_created_at > ?
     ORDER BY shop_created_at DESC LIMIT 50`,
  ).all(since);
  res.json({ shops, count: shops.length });
});

// ─── Contact & Demand analytics ──────────────────────────────────────
// One endpoint feeds the whole "تحليل التواصل والطلب" page so it re-fetches
// once per filter change. Query params:
//   period      = today | 7d | 30d   (rolling window over ACTIVITY)
//   governorate = optional English gov name
//   brand       = optional brand name
//
// Model:
//   • Base listing set = all non-removed listings (gov/brand filtered). Not
//     period-bound — a listing from weeks ago can still be contacted today.
//   • Contact = chat (from `chats`, retroactive) + call + WhatsApp (from
//     `events`; those two stay 0 until the app ships tap-reporting).
//   • Demand (searches) is global (period only) — tying a free-text search
//     to a governorate/brand isn't meaningful, and the spec asked for that
//     linkage only "لو أمكن".
r.get('/analytics', requireAdmin, (req, res) => {
  const DAYS = { today: 1, '7d': 7, '30d': 30 };
  const period = DAYS[req.query.period] ? req.query.period : '7d';
  const since = Date.now() - DAYS[period] * 86400000;

  const gov = normalizeGovernorate(req.query.governorate) || null;
  const brand = req.query.brand && isBrand(String(req.query.brand)) ? String(req.query.brand) : null;

  // Base listing filter (shared shape for the listing-anchored sections).
  const lConds = ["l.status != 'removed'"];
  const lp = {};
  if (gov) { lConds.push('l.governorate = @gov'); lp.gov = gov; }
  if (brand) { lConds.push('l.brand = @brand'); lp.brand = brand; }
  const lWhere = lConds.join(' AND ');

  const listings = db.prepare(
    `SELECT l.id, l.brand, l.model, l.governorate, l.status, l.created_at, l.sold_at,
            u.display_name AS seller_name, u.phone AS seller_phone
     FROM phone_listings l JOIN users u ON u.id = l.seller_id
     WHERE ${lWhere}`,
  ).all(lp);
  const byId = new Map(listings.map((l) => [l.id, { ...l, calls: 0, whatsapps: 0, chats: 0 }]));

  // Chat contact — retroactive, straight from the chats table.
  for (const c of db.prepare('SELECT listing_id, COUNT(*) AS n FROM chats WHERE created_at >= ? GROUP BY listing_id').all(since)) {
    const row = byId.get(c.listing_id); if (row) row.chats = c.n;
  }
  // Call / WhatsApp contact — from the event log.
  for (const e of db.prepare(
    "SELECT listing_id, type, COUNT(*) AS n FROM events WHERE type IN ('contact_call','contact_whatsapp') AND created_at >= ? GROUP BY listing_id, type",
  ).all(since)) {
    const row = byId.get(e.listing_id); if (!row) continue;
    if (e.type === 'contact_call') row.calls = e.n; else row.whatsapps = e.n;
  }

  const rows = [...byId.values()].map((l) => ({ ...l, total: l.calls + l.whatsapps + l.chats }));
  const withContact = rows.filter((l) => l.total > 0);
  const totalContacts = rows.reduce((a, l) => a + l.total, 0);
  // Sold WITHIN THE SELECTED PERIOD. This used to be a plain
  // `status === 'sold'` count over every listing ever, so the KPI showed
  // the same all-time number whether you picked today, 7d or 30d while
  // every metric beside it moved — it looked broken because it was.
  // Rows sold before sold_at existed carry a backfilled approximation
  // (see db.js); `sold_total` is the honest all-time figure.
  const soldCount = rows.filter((l) => l.status === 'sold' && l.sold_at && l.sold_at >= since).length;
  const soldTotal = rows.filter((l) => l.status === 'sold').length;

  const kpis = {
    total_listings: rows.length,
    listings_with_contact: withContact.length,
    listings_with_contact_pct: rows.length ? Math.round((withContact.length / rows.length) * 1000) / 10 : 0,
    listings_without_contact: rows.length - withContact.length,
    avg_contact_attempts: rows.length ? Math.round((totalContacts / rows.length) * 100) / 100 : 0,
    sold_count: soldCount,
    sold_total: soldTotal,
  };

  // Most-contacted listings (the engaged ones), and the at-risk list of
  // ACTIVE listings with zero contact — oldest first, since a listing that's
  // sat longest without a single tap is the seller most likely to give up.
  const contact_per_listing = withContact
    .sort((a, b) => b.total - a.total)
    .slice(0, 50)
    .map((l) => ({ id: l.id, brand: l.brand, model: l.model, governorate: l.governorate, calls: l.calls, whatsapps: l.whatsapps, chats: l.chats, total: l.total }));

  const noContactAll = rows.filter((l) => l.status === 'active' && l.total === 0)
    .sort((a, b) => a.created_at - b.created_at);
  const listings_without_contact = noContactAll.slice(0, 100)
    .map((l) => ({ id: l.id, brand: l.brand, model: l.model, governorate: l.governorate, seller_name: l.seller_name, seller_phone: l.seller_phone, created_at: l.created_at }));

  // ── Demand (global, period only) ──
  const top_searches = db.prepare(
    "SELECT query, COUNT(*) AS n FROM events WHERE type='search' AND created_at >= ? AND query IS NOT NULL AND query != '' GROUP BY query ORDER BY n DESC LIMIT 25",
  ).all(since);
  const zero_result_searches = db.prepare(
    "SELECT query, COUNT(*) AS n FROM events WHERE type='search' AND created_at >= ? AND result_count = 0 AND query IS NOT NULL AND query != '' GROUP BY query ORDER BY n DESC LIMIT 25",
  ).all(since);

  // Most-viewed — join view events back to current listings, honouring the
  // gov/brand filter through the listing set.
  const viewRows = db.prepare(
    "SELECT listing_id, COUNT(*) AS n FROM events WHERE type='view' AND created_at >= ? GROUP BY listing_id ORDER BY n DESC",
  ).all(since);
  const most_viewed = [];
  for (const v of viewRows) {
    const l = byId.get(v.listing_id);
    if (!l) continue; // filtered out by gov/brand, or a since-removed listing
    most_viewed.push({ id: l.id, brand: l.brand, model: l.model, governorate: l.governorate, views: v.n });
    if (most_viewed.length >= 20) break;
  }

  // Sellers who registered (real accounts) but never posted a live listing —
  // the nudge list. Not gov/brand or period bound (they have no listings).
  const sellersWithout = db.prepare(
    `SELECT u.id, u.display_name, u.phone, u.created_at
     FROM users u
     WHERE u.is_guest = 0
       AND NOT EXISTS (SELECT 1 FROM phone_listings l WHERE l.seller_id = u.id AND l.status != 'removed')
     ORDER BY u.created_at DESC LIMIT 100`,
  ).all();
  const sellersWithoutTotal = db.prepare(
    `SELECT COUNT(*) AS n FROM users u
     WHERE u.is_guest = 0
       AND NOT EXISTS (SELECT 1 FROM phone_listings l WHERE l.seller_id = u.id AND l.status != 'removed')`,
  ).get().n;

  res.json({
    filters: { period, governorate: gov, brand },
    kpis,
    contact_per_listing,
    listings_without_contact,
    listings_without_contact_total: noContactAll.length,
    demand: { top_searches, zero_result_searches, most_viewed },
    sellers_without_listings: sellersWithout,
    sellers_without_listings_total: sellersWithoutTotal,
  });
});

// ─── Work queue ──────────────────────────────────────────────────────
// Every "someone is waiting on you" count in one call, so the overview can
// lead with outstanding work instead of the operator having to remember to
// visit five pages. One request rather than five also means the header can
// poll it cheaply.
//
// Only genuinely actionable things belong here. A number that can't be
// cleared trains people to ignore the whole row.
r.get('/work-queue', requireAdmin, (_req, res) => {
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  res.json({
    // Flagged listings awaiting a human verdict. Matches the الفحص queue's
    // filter — a 'clean' verdict is logged for audit, never for review.
    inspection: count(
      "SELECT COUNT(*) AS n FROM listing_inspections WHERE status='pending' AND verdict != 'clean'",
    ),
    inspection_errors: count("SELECT COUNT(*) AS n FROM listing_inspections WHERE status='error'"),
    devices: count("SELECT COUNT(*) AS n FROM device_suggestions WHERE status='pending'"),
    reports: count("SELECT COUNT(*) AS n FROM reports WHERE status='open'"),
    feature_requests: count("SELECT COUNT(*) AS n FROM feature_requests WHERE status='pending'"),
    // Orders nobody has acted on yet. The most time-critical queue here —
    // a COD customer is waiting on a phone call.
    orders: count("SELECT COUNT(*) AS n FROM orders WHERE status='pending'"),
    // Shops that registered in the last 7 days — not a queue exactly, but the
    // thing an operator most often wants to greet or verify.
    new_shops: count(
      "SELECT COUNT(*) AS n FROM users WHERE seller_type='shop' AND created_at >= ?",
      Date.now() - 7 * 86400000,
    ),
  });
});

// ─── Daily users ─────────────────────────────────────────────────────
// Two series, because "active users" means two different things and the gap
// between them IS the signal:
//   opened  — made any API call that day (user_active_days, one row per
//             user per Baghdad day)
//   engaged — searched, viewed a listing, or tapped call/WhatsApp (events)
// A wide opened/engaged gap means people are launching the app and bouncing.
//
// Days are Baghdad days so the dashboard's "today" matches the operator's.
r.get('/analytics/daily', requireAdmin, (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
  const OFFSET = 3 * 60 * 60 * 1000; // Baghdad, UTC+3, no DST
  const dayOf = (ts) => new Date(ts + OFFSET).toISOString().slice(0, 10);

  // Build the full date axis first so days with zero activity are real zeros
  // rather than gaps the chart would silently interpolate over.
  const today = dayOf(Date.now());
  const axis = [];
  for (let i = days - 1; i >= 0; i--) axis.push(dayOf(Date.now() - i * 86400000));
  const blank = () => Object.fromEntries(axis.map((d) => [d, 0]));
  // Epoch ms for 00:00 Baghdad on the first day of the window.
  const windowStart = new Date(axis[0] + 'T00:00:00Z').getTime() - OFFSET;

  const opened = blank();
  for (const r2 of db.prepare(
    'SELECT day, COUNT(DISTINCT user_id) AS n FROM user_active_days WHERE day >= ? GROUP BY day',
  ).all(axis[0])) if (r2.day in opened) opened[r2.day] = r2.n;

  // 'engaged' is derived from events with a user_id. Anonymous events exist
  // (guests browse before signing in) and are counted separately rather than
  // silently dropped or double-counted as a user.
  // Distinct users per day, so a set per day rather than a running count —
  // one person searching twenty times is one engaged user.
  const engaged = blank();
  const ENGAGED_TYPES = "('search','view','contact_call','contact_whatsapp')";
  const engagedSets = new Map(axis.map((d) => [d, new Set()]));
  for (const r2 of db.prepare(
    `SELECT created_at, user_id FROM events
      WHERE type IN ${ENGAGED_TYPES} AND user_id IS NOT NULL AND created_at >= ?`,
  ).all(windowStart)) {
    engagedSets.get(dayOf(r2.created_at))?.add(r2.user_id);
  }
  for (const d of axis) engaged[d] = engagedSets.get(d).size;

  const signups = blank();
  for (const r2 of db.prepare('SELECT created_at FROM users WHERE created_at >= ?').all(windowStart)) {
    const d = dayOf(r2.created_at);
    if (d in signups) signups[d] += 1;
  }

  const listings = blank();
  for (const r2 of db.prepare('SELECT created_at FROM phone_listings WHERE created_at >= ?').all(windowStart)) {
    const d = dayOf(r2.created_at);
    if (d in listings) listings[d] += 1;
  }

  const series = axis.map((d) => ({
    day: d, opened: opened[d], engaged: engaged[d],
    signups: signups[d], listings: listings[d],
  }));

  // Rolling reach. WAU/MAU come from the same table, counted over windows
  // rather than summed from the daily series (a user active on 5 days is one
  // weekly user, not five).
  const windowUsers = (n) => db.prepare(
    'SELECT COUNT(DISTINCT user_id) AS n FROM user_active_days WHERE day >= ?',
  ).get(dayOf(Date.now() - (n - 1) * 86400000)).n;

  const dau = opened[today] || 0;
  const mau = windowUsers(30);
  res.json({
    series,
    totals: {
      dau,
      engaged_today: engaged[today] || 0,
      wau: windowUsers(7),
      mau,
      // Stickiness: what share of the monthly base shows up on a given day.
      // 20%+ is strong for a marketplace; low single digits means people come
      // back only when they happen to need a phone.
      dau_mau_pct: mau ? Math.round((dau / mau) * 1000) / 10 : 0,
    },
    platforms: db.prepare(
      `SELECT COALESCE(platform,'unknown') AS platform, COUNT(DISTINCT user_id) AS users
         FROM user_active_days WHERE day >= ? GROUP BY 1 ORDER BY users DESC`,
    ).all(dayOf(Date.now() - 29 * 86400000)),
    app_versions: db.prepare(
      `SELECT COALESCE(app_version,'unknown') AS version, COUNT(DISTINCT user_id) AS users
         FROM user_active_days WHERE day >= ? GROUP BY 1 ORDER BY users DESC LIMIT 12`,
    ).all(dayOf(Date.now() - 29 * 86400000)),
  });
});

// ─── Social publishing (Buffer → Facebook + Instagram) ───────────────
// Daily cap: number of publish actions allowed per calendar day. One action
// = one listing pushed to all connected channels. Tunable via the
// SOCIAL_DAILY_CAP env (default 3) so it can change without a deploy.
function socialDailyCap() {
  const n = Number(process.env.SOCIAL_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}
function socialStartOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function socialUsedToday() {
  return db.prepare('SELECT COUNT(*) AS n FROM social_posts WHERE created_at >= ?')
    .get(socialStartOfDay()).n;
}

// Daily posting slots, in Baghdad local time. Iraq is UTC+3 year-round (no
// DST), so a Baghdad hour H maps to UTC hour H-3. Each publish is scheduled
// at the earliest upcoming slot not already claimed by a pending post, so
// three publishes a day land at 10:00, 15:00, 18:00 exactly.
const SOCIAL_SLOTS_BAGHDAD = [10, 15, 18];
const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
function nextSocialSlot() {
  const now = Date.now();
  const taken = new Set(
    db.prepare('SELECT scheduled_for FROM social_posts WHERE scheduled_for IS NOT NULL AND scheduled_for > ?')
      .all(now).map((r) => r.scheduled_for),
  );
  const bagh = new Date(now + BAGHDAD_OFFSET_MS); // read Y/M/D as they are in Baghdad
  for (let d = 0; d < 21; d++) {
    for (const h of SOCIAL_SLOTS_BAGHDAD) {
      const slot = Date.UTC(bagh.getUTCFullYear(), bagh.getUTCMonth(), bagh.getUTCDate() + d, h - 3, 0, 0);
      if (slot > now + 2 * 60 * 1000 && !taken.has(slot)) return slot;
    }
  }
  return now + 60 * 60 * 1000; // safety fallback: 1h out
}

// Status for the dashboard: whether Buffer is wired up, which channels are
// connected, and how much of today's quota is left. Drives the button state.
r.get('/social/status', requireAdmin, (_req, res) => {
  const cap = socialDailyCap();
  const used = socialUsedToday();
  res.json({
    configured: bufferConfigured(),
    channels: (() => { const c = bufferChannels(); return { facebook: !!c.fb, instagram: !!c.ig }; })(),
    cap,
    used_today: used,
    remaining: Math.max(0, cap - used),
  });
});

// One-click publish: the dashboard sends the composed branded image + the
// caption; we host the image (Buffer fetches it by URL), post to every
// connected channel, and log the action for the cap + audit.
r.post('/listings/:id(\\d+)/publish', requireAdmin, imageUpload.single('image'), async (req, res) => {
  const cleanup = () => { if (req.file) try { fs.unlinkSync(req.file.path); } catch {} };

  if (!bufferConfigured()) { cleanup(); return res.status(400).json({ error: 'buffer_not_configured' }); }

  const cap = socialDailyCap();
  if (socialUsedToday() >= cap) { cleanup(); return res.status(429).json({ error: 'daily_cap_reached', cap }); }

  const listing = db.prepare('SELECT id FROM phone_listings WHERE id=?').get(req.params.id);
  if (!listing) { cleanup(); return res.status(404).json({ error: 'not_found' }); }
  if (!req.file) return res.status(400).json({ error: 'no_image' });

  const caption = String(req.body?.caption || '').slice(0, 5000);
  if (!caption.trim()) { cleanup(); return res.status(400).json({ error: 'no_caption' }); }

  // Public URL Buffer will fetch. The dashboard is served from the same
  // host, so the default matches; override with PUBLIC_BASE_URL if the API
  // ever moves behind a different public origin.
  const base = (process.env.PUBLIC_BASE_URL || 'https://api.iqmobile.org').replace(/\/+$/, '');
  const imagePath = `/uploads/${req.file.filename}`;
  const imageUrl = `${base}${imagePath}`;

  // Schedule at the next free 10am / 3pm / 6pm Baghdad slot so posts land at
  // good engagement times and spread out instead of all firing at once. We
  // reserve the slot in social_posts.scheduled_for so back-to-back publishes
  // step to the following slot.
  const slot = nextSocialSlot();
  const dueAt = new Date(slot).toISOString();

  const { any, results } = await publishToChannels(caption, imageUrl, dueAt);
  if (!any) {
    // Every channel failed — log the exact per-channel reasons + the image
    // URL Buffer was asked to fetch (diagnostic; Buffer errors are opaque
    // from the client side), then drop the image so we don't leave an orphan
    // for a post that never went out.
    console.warn(`[social] publish failed listing=${listing.id} img=${imageUrl} :: ${JSON.stringify(results)}`);
    cleanup();
    return res.status(502).json({ error: 'publish_failed', results });
  }
  console.log(`[social] published listing=${listing.id} due=${dueAt} :: ${results.map((r) => `${r.channel}:${r.ok ? 'ok' : r.error}`).join(', ')}`);

  db.prepare(
    'INSERT INTO social_posts(listing_id, image_path, caption, channels, scheduled_for, created_at) VALUES(?,?,?,?,?,?)',
  ).run(listing.id, imagePath, caption, JSON.stringify(results), slot, now());

  res.json({ ok: true, results, scheduled_for: dueAt, remaining: Math.max(0, cap - socialUsedToday()) });
});

// ─── orders (COD storefront) ──────────────────────────────────────────
// Fulfilment queue for order-enabled shops. The lifecycle is deliberately
// linear — pending → confirmed → shipped → delivered — with cancel available
// until it's delivered. Anything else (delivered → shipped, resurrecting a
// cancelled order) is a mistake, not a workflow, so the transition map
// rejects it rather than letting the dashboard write an impossible state.
const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const ORDER_NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

r.get('/orders', requireAdmin, (req, res) => {
  const status = ORDER_STATUSES.includes(req.query.status) ? req.query.status : '';
  const q = String(req.query.q || '').trim().slice(0, 60);
  const conds = [];
  const params = [];
  if (status) { conds.push('o.status=?'); params.push(status); }
  if (q) {
    const like = `%${q}%`;
    conds.push('(o.code LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.address LIKE ?)');
    params.push(like, like, like, like);
  }
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o${where}`).get(...params).n;
  const rows = db.prepare(
    `SELECT o.*, u.shop_name, u.display_name AS shop_display_name
       FROM orders o JOIN users u ON u.id = o.shop_id${where}
      ORDER BY o.created_at DESC LIMIT 200`,
  ).all(...params);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id ASC');
  res.json({
    total,
    // Counts per status drive the tab badges, and must ignore the status
    // filter itself or every tab would read as the one you're looking at.
    counts: Object.fromEntries(ORDER_STATUSES.map((s) => [
      s, db.prepare('SELECT COUNT(*) AS n FROM orders WHERE status=?').get(s).n,
    ])),
    orders: rows.map((o) => ({ ...o, shop_name: o.shop_name || o.shop_display_name, items: items.all(o.id) })),
  });
});

r.patch('/orders/:id(\\d+)', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const next = String(req.body?.status || '');
  if (!ORDER_STATUSES.includes(next)) return res.status(400).json({ error: 'bad_status' });
  if (next === o.status) return res.json({ ok: true, order: o });
  if (!ORDER_NEXT[o.status].includes(next)) {
    return res.status(409).json({ error: 'bad_transition', from: o.status, to: next });
  }
  const reason = next === 'cancelled'
    ? (String(req.body?.cancel_reason || '').trim().slice(0, 200) || 'cancelled_by_admin')
    : null;
  const t = now();
  // Cancelling gives the reserved units back to stock (see src/stock.js).
  applyStatusToStock(o, next);
  db.prepare('UPDATE orders SET status=?, cancel_reason=?, updated_at=? WHERE id=?')
    .run(next, reason, t, o.id);
  // Stamp the delivery. 'delivered' alone is a current-state flag; without a
  // timestamp no report can ask what was DELIVERED in a window, only what
  // was ordered in one — the same hole sold_at filled for listings.
  if (next === 'delivered') {
    db.prepare('UPDATE orders SET delivered_at=? WHERE id=? AND delivered_at IS NULL').run(t, o.id);
  }

  // Keep the customer informed. Guest orders have user_id NULL — skip
  // rather than throwing on the notifications FK.
  if (o.user_id) {
    const AR = {
      confirmed: 'تم تأكيد طلبك',
      shipped: 'طلبك في الطريق',
      delivered: 'تم تسليم طلبك',
      cancelled: 'أُلغي طلبك',
    };
    if (AR[next]) {
      // The body was just the order code. "IQ-1042" alone tells the customer
      // nothing on a lock screen — the amount is what they actually need to
      // have ready when the courier knocks.
      const money = `${Number(o.total || 0).toLocaleString('en-US')} د.ع`;
      const body = next === 'shipped' || next === 'confirmed'
        ? `${o.code} · ${money} تُدفع عند الاستلام`
        : `${o.code} · ${money}`;
      notify(o.user_id, 'order.' + next, { order_id: o.id, code: o.code, status: next },
        { title: AR[next], body });
    }
  }
  res.json({ ok: true, order: db.prepare('SELECT * FROM orders WHERE id=?').get(o.id) });
});

// Courier / tracking / real delivery cost. Separate from the status PATCH
// because these are edited while an order sits in one state — the operator
// types the courier name at dispatch, the real fee when the courier invoices
// — and folding them into a transition endpoint would mean pretending a
// status changed just to save a note.
r.patch('/orders/:id(\\d+)/fulfilment', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const fields = [];
  const params = [];

  for (const [key, max] of [['courier', 60], ['tracking_note', 200]]) {
    if (!has(key)) continue;
    const v = String(b[key] ?? '').trim().slice(0, max);
    fields.push(`${key}=?`); params.push(v || null);
  }
  if (has('delivery_cost')) {
    const raw = b.delivery_cost;
    if (raw === null || raw === '') { fields.push('delivery_cost=?'); params.push(null); }
    else {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || n < 0 || n > 10000000) return res.status(400).json({ error: 'bad_delivery_cost' });
      fields.push('delivery_cost=?'); params.push(n);
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'no_fields' });
  fields.push('updated_at=?'); params.push(now(), o.id);
  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id=?`).run(...params);
  res.json({ ok: true, order: db.prepare('SELECT * FROM orders WHERE id=?').get(o.id) });
});

// A return: the order WAS delivered and came back. Modelled as a flag rather
// than a sixth status because orders.status carries a CHECK constraint that
// SQLite can't alter, and rebuilding a live orders table to add an enum
// value is a bad trade. The delivery history stays true; revenue subtracts.
const RETURN_REASONS = ['refused', 'wrong_item', 'damaged', 'changed_mind', 'other'];
r.post('/orders/:id(\\d+)/return', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  if (o.status !== 'delivered') return res.status(409).json({ error: 'not_delivered' });
  if (o.returned_at) return res.status(409).json({ error: 'already_returned' });
  const reason = RETURN_REASONS.includes(req.body?.reason) ? req.body.reason : 'other';
  const t = now();
  // The devices are physically back, so the units are sellable again.
  restoreStockForOrder(o.id);
  db.prepare('UPDATE orders SET returned_at=?, return_reason=?, updated_at=? WHERE id=?')
    .run(t, reason, t, o.id);
  // Tell the customer too — a return recorded silently is how a refund
  // dispute starts.
  if (o.user_id) {
    notify(o.user_id, 'order.returned', { order_id: o.id, code: o.code, reason },
      { title: 'تم تسجيل إرجاع طلبك', body: o.code });
  }
  res.json({ ok: true, order: db.prepare('SELECT * FROM orders WHERE id=?').get(o.id) });
});

// ─── listing-name review queue ────────────────────────────────────────
// The daily name cleanup auto-applies only what it can match against the
// device catalogue with confidence. What's left lands here: names where the
// seller typed the whole ad into the model box, or a device the catalogue
// doesn't know yet. Each row arrives with its transliteration so the
// operator can see WHY it wasn't matched, and the suggestion (when there is
// one) is one click to accept.
r.get('/listings/name-review', requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
  const rows = db.prepare(
    `SELECT l.id, l.brand, l.model, l.status, l.asking_price, l.created_at,
            u.display_name AS seller_name
       FROM phone_listings l JOIN users u ON u.id = l.seller_id
      WHERE l.status='active'
      ORDER BY l.created_at DESC LIMIT 2000`,
  ).all();

  const ARABIC = /[\u0600-\u06FF]/;
  const out = [];
  for (const l of rows) {
    if (!ARABIC.test(l.model || '')) continue;
    const r2 = resolveListingName(l.brand, l.model);
    out.push({
      ...l,
      tokens: r2.tokens.join(' '),
      suggestion: r2.model || null,
      suggested_brand: r2.brand && r2.brand !== l.brand ? r2.brand : null,
      confidence: r2.confidence,
    });
    if (out.length >= limit) break;
  }
  res.json({ total: out.length, listings: out });
});

// ─── device catalog ───────────────────────────────────────────────────
// The post-listing dropdown is driven by `device_catalog` (seeded from a
// GSMArena snapshot). When a seller can't find their device they type it
// manually and a row lands in `device_suggestions` for review here.
// Approving copies the device into the catalog so the next seller finds it.
//
// Until now approving a suggestion was the ONLY way a device entered the
// catalog, which meant fixing a typo in one of the ~4000 seeded names, or
// adding a model nobody had asked for yet, was a SQL job. The CRUD below
// makes the catalog directly editable from the dashboard.

const DEVICE_TYPES = ['phone', 'tablet', 'watch'];

// Shared validation for create + edit so an edit can never write a value the
// create path would have rejected — same principle as PATCH /listings/:id.
function readDeviceFields(body, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body || {}, k);

  if (!partial || has('brand')) {
    const brand = String(body?.brand || '').trim();
    if (!brand) return { error: 'brand_required' };
    // Same guard the suggestion-approve path uses: a catalog entry under a
    // brand the listing form doesn't offer is unreachable in the dropdown.
    if (!isBrand(brand)) return { error: 'unknown_brand' };
    out.brand = brand;
  }
  if (!partial || has('model')) {
    const model = String(body?.model || '').trim().slice(0, 80);
    if (!model) return { error: 'model_required' };
    // A model whose own text names a DIFFERENT brand is filed wrong, and the
    // mistake is invisible afterwards: "Infinix gt 30 pro" sat in the Apple
    // dropdown, offered to every seller picking an iPhone. Only refuse when
    // the foreign brand leads the name — "Galaxy S24 vs iPhone" style
    // comparison text is not a model name anyone types here, but a trailing
    // brand word ("… for Samsung") is a plausible accessory name.
    const brandForCheck = out.brand || String(body?.brand || '').trim();
    const lead = model.toLowerCase().split(/[\s-]+/)[0];
    if (brandForCheck && lead && lead !== brandForCheck.toLowerCase()) {
      const clash = brandNames().find((b) => b.toLowerCase() === lead);
      if (clash) return { error: 'model_names_other_brand' };
    }
    out.model = model;
  }
  if (!partial || has('device_type')) {
    const t = String(body?.device_type || 'phone').trim();
    if (!DEVICE_TYPES.includes(t)) return { error: 'bad_device_type' };
    out.device_type = t;
  }
  if (has('is_active')) out.is_active = body.is_active ? 1 : 0;
  return { fields: out };
}

// UNIQUE(brand, device_type, model) is the only constraint on the table, so a
// SQLITE_CONSTRAINT here always means "this device already exists". Report it
// as 409 rather than letting it surface as a 500.
function isDuplicate(e) {
  return String(e?.code || '').startsWith('SQLITE_CONSTRAINT');
}

r.get('/device-catalog', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const brand = String(req.query.brand || '').trim();
  const type = DEVICE_TYPES.includes(req.query.type) ? req.query.type : '';
  // 'all' shows deactivated rows too; default hides them the way the app does.
  const active = req.query.active === 'all' ? null : req.query.active === '0' ? 0 : 1;
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const conds = [];
  const params = [];
  if (brand) { conds.push('brand = ?'); params.push(brand); }
  if (type) { conds.push('device_type = ?'); params.push(type); }
  if (active !== null) { conds.push('is_active = ?'); params.push(active); }
  if (q) {
    // Escape LIKE metacharacters — an operator pasting "iPhone_15" should not
    // turn the _ into a single-character wildcard across 4000 rows.
    const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    conds.push("(model LIKE ? ESCAPE '\\' COLLATE NOCASE OR brand LIKE ? ESCAPE '\\' COLLATE NOCASE)");
    params.push(`%${esc}%`, `%${esc}%`);
  }
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';

  // Total is the count BEFORE the limit, so the UI can say "showing 200 of
  // 3972" instead of silently implying the catalog is 200 rows deep.
  const total = db.prepare(`SELECT COUNT(*) AS n FROM device_catalog${where}`).get(...params).n;
  const rows = db.prepare(
    `SELECT id, brand, device_type, model, source, is_active, created_at
       FROM device_catalog${where}
      ORDER BY brand COLLATE NOCASE ASC, model COLLATE NOCASE ASC
      LIMIT ?`,
  ).all(...params, limit);

  res.json({ total, limit, devices: rows });
});

r.post('/device-catalog', requireAdmin, (req, res) => {
  const { error, fields } = readDeviceFields(req.body, { partial: false });
  if (error) return res.status(400).json({ error });
  try {
    const id = db.prepare(
      `INSERT INTO device_catalog(brand, device_type, model, source, is_active, created_at)
       VALUES(?,?,?,'manual',1,?)`,
    ).run(fields.brand, fields.device_type, fields.model, now()).lastInsertRowid;
    // The name matcher holds the catalogue in memory; a new device has to be
    // visible to it immediately or the review queue keeps saying "no match"
    // for a device that now exists.
    resetCatalogCache();
    res.json({ ok: true, device: db.prepare('SELECT * FROM device_catalog WHERE id=?').get(id) });
  } catch (e) {
    if (isDuplicate(e)) return res.status(409).json({ error: 'duplicate' });
    throw e;
  }
});

r.patch('/device-catalog/:id(\\d+)', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM device_catalog WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const { error, fields } = readDeviceFields(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: 'no_fields' });

  try {
    db.prepare(`UPDATE device_catalog SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`)
      .run(...keys.map((k) => fields[k]), row.id);
    resetCatalogCache();
    res.json({ ok: true, device: db.prepare('SELECT * FROM device_catalog WHERE id=?').get(row.id) });
  } catch (e) {
    if (isDuplicate(e)) return res.status(409).json({ error: 'duplicate' });
    throw e;
  }
});

// Hard delete is safe: nothing has a foreign key to device_catalog, and a
// listing stores its model as free text rather than a catalog id. Removing a
// row takes the device out of the picker and leaves every existing listing
// exactly as it was. Deactivating (PATCH is_active=0) is the reversible
// option and is what the UI offers first.
r.delete('/device-catalog/:id(\\d+)', requireAdmin, (req, res) => {
  const r2 = db.prepare('DELETE FROM device_catalog WHERE id=?').run(req.params.id);
  resetCatalogCache();
  if (r2.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

r.get('/device-suggestions', requireAdmin, (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : 'pending';
  // LEFT JOIN on users: suggestions are FK-free and outlive the account that
  // filed them, so a deleted user must not drop the row from the queue.
  const rows = db.prepare(
    `SELECT s.*, u.display_name AS user_name, u.phone AS user_phone
     FROM device_suggestions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.status=? ORDER BY s.created_at DESC LIMIT 300`,
  ).all(status);
  res.json(rows);
});

// Badge count for the dashboard nav.
r.get('/device-suggestions/count', requireAdmin, (_req, res) => {
  const n = db.prepare("SELECT COUNT(*) AS n FROM device_suggestions WHERE status='pending'").get().n;
  res.json({ pending: n });
});

r.post('/device-suggestions/:id(\\d+)/approve', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM device_suggestions WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'not_pending' });

  // The admin can correct the seller's spelling/brand before it enters the
  // catalog — that's the whole point of the review step. Fall back to what
  // the seller submitted when a field isn't overridden.
  const brand = String(req.body?.brand || s.brand).trim();
  const model = String(req.body?.model || s.model).trim();
  const type = ['phone', 'tablet', 'watch'].includes(req.body?.device_type)
    ? req.body.device_type : s.device_type;
  if (!brand || !model) return res.status(400).json({ error: 'brand_and_model_required' });
  // Guard the FK-in-spirit link to `brands`: a catalog entry under a brand
  // the listing form doesn't offer would be unreachable in the dropdown.
  if (!isBrand(brand)) return res.status(400).json({ error: 'unknown_brand' });

  const t = now();
  db.prepare(
    `INSERT OR IGNORE INTO device_catalog(brand, device_type, model, source, created_at)
     VALUES(?,?,?,'suggestion',?)`,
  ).run(brand, type, model, t);
  db.prepare('UPDATE device_suggestions SET status=?, reviewed_at=?, brand=?, model=?, device_type=? WHERE id=?')
    .run('approved', t, brand, model, type, s.id);

  // Only notify if the requester still exists. device_suggestions is
  // deliberately FK-free so a row survives its author's deletion — but
  // `notifications` does have an FK to users, so notifying a deleted user
  // throws and would 500 the request *after* the catalog write above has
  // already committed, leaving the admin staring at an error for an
  // approval that actually succeeded.
  const stillThere = s.user_id
    && db.prepare('SELECT 1 FROM users WHERE id=?').get(s.user_id);
  if (stillThere) {
    notify(s.user_id, 'device.approved', { brand, model, device_type: type },
      { title: 'تمت إضافة جهازك ✅', body: `${brand} ${model} صار متوفر في القائمة` });
  }
  res.json({ ok: true, brand, model, device_type: type });
});

r.post('/device-suggestions/:id(\\d+)/reject', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM device_suggestions WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'not_pending' });
  db.prepare('UPDATE device_suggestions SET status=?, reviewed_at=?, note=? WHERE id=?')
    .run('rejected', now(), String(req.body?.note || '').slice(0, 200) || null, s.id);
  // No push on reject: the seller's listing already went through with their
  // typed model, so nothing broke for them — a rejection notice would just
  // be noise about an internal catalog decision.
  res.json({ ok: true });
});

// ─── AI listing inspection ────────────────────────────────────────────
// Drives the dashboard's switches + review queue. `configured` reports
// whether ANTHROPIC_API_KEY exists at all, so the UI can explain *why* the
// switch is unavailable instead of silently doing nothing when flipped.
r.get('/inspection/status', requireAdmin, (_req, res) => {
  res.json({
    configured: inspectionConfigured(),
    // Report the EFFECTIVE state, not the raw setting. The switch can be on
    // while ANTHROPIC_API_KEY is absent, and inspectListingAsync gates on
    // both — so returning the bare setting would have the dashboard announce
    // "الفحص يعمل" for a feature that cannot run.
    enabled: inspectionEnabled(),
    // The stored switch position, so the Settings checkbox still reflects
    // what the operator chose even while the key is missing.
    enabled_setting: getSetting('listing_inspection_enabled') === '1',
    autoreject: getSetting('listing_inspection_autoreject') === '1',
    // Must match the queue's filter below. Counting every pending row meant a
    // listing the model judged CLEAN was counted as "awaiting review" while
    // the queue deliberately hid it — the dashboard said 2 waiting and showed
    // an empty list. A clean verdict is recorded for audit, never for review.
    pending: db.prepare(
      "SELECT COUNT(*) AS n FROM listing_inspections WHERE status='pending' AND verdict != 'clean'",
    ).get().n,
    errors: db.prepare("SELECT COUNT(*) AS n FROM listing_inspections WHERE status='error'").get().n,
  });
});

// The queue. Defaults to flagged-and-unreviewed only — a 'clean' verdict is
// recorded for auditing but is not something anyone needs to look at.
r.get('/inspection/queue', requireAdmin, (req, res) => {
  const status = ['pending', 'approved', 'removed', 'error', 'all'].includes(req.query.status)
    ? req.query.status : 'pending';
  const where = status === 'all' ? '1=1' : 'i.status=?';
  const params = status === 'all' ? [] : [status];
  const rows = db.prepare(
    `SELECT i.*, l.brand, l.model, l.asking_price, l.governorate, l.description,
            l.status AS listing_status, l.seller_id, u.display_name AS seller_name
       FROM listing_inspections i
       JOIN phone_listings l ON l.id = i.listing_id
       JOIN users u ON u.id = l.seller_id
      WHERE ${where} AND (i.verdict != 'clean' OR i.status='error')
      ORDER BY i.created_at DESC LIMIT 200`,
  ).all(...params);
  res.json(rows.map((r2) => ({
    ...r2,
    defects: (() => { try { return JSON.parse(r2.defects_json); } catch { return []; } })(),
    images: db.prepare('SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC')
      .all(r2.listing_id).map((im) => im.image_path),
  })));
});

// Operator decision on a flagged listing. 'approve' clears the flag and
// leaves the listing up; 'remove' takes it down.
r.post('/inspection/:id(\\d+)/:action(approve|remove)', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM listing_inspections WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const t = now();
  if (req.params.action === 'remove') {
    db.prepare("UPDATE phone_listings SET status='removed', updated_at=? WHERE id=?").run(t, row.listing_id);
    db.prepare("UPDATE listing_inspections SET status='removed', reviewed_at=? WHERE id=?").run(t, row.id);
  } else {
    db.prepare("UPDATE listing_inspections SET status='approved', reviewed_at=? WHERE id=?").run(t, row.id);
  }
  res.json({ ok: true });
});

// Re-run the check on one listing — useful after the seller swaps photos, or
// to sanity-check the model on a listing you already know the answer for.
r.post('/inspection/listing/:id(\\d+)/rerun', requireAdmin, (req, res) => {
  // Report the real reason rather than answering "queued" for a call that the
  // gate in inspectListingAsync would silently drop.
  if (!inspectionConfigured()) return res.status(400).json({ error: 'not_configured' });
  if (!inspectionEnabled()) return res.status(400).json({ error: 'not_enabled' });
  const listing = db.prepare('SELECT id FROM phone_listings WHERE id=?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'not_found' });
  setImmediate(() => inspectListingAsync(listing.id));
  res.json({ ok: true, queued: true });
});

// Store management (KPIs, customers) lives in its own module — this file is
// already the marketplace-wide admin surface and the storefront is a
// different job with different questions.
r.use('/', registerStoreRoutes(requireAdmin, imageUpload, UPLOADS));

export default r;
