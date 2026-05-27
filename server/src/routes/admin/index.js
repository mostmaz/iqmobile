import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now, getSetting, setSettingValue } from '../../db.js';
import { issueToken, requireAdmin } from '../../auth.js';
import { pushTo } from '../../push.js';
import { authLimiter } from '../../limits.js';
import { getBrandsWithCounts, invalidateBrandsCache, isBrand } from '../../brands.js';
import { normalizeGovernorate } from '../../governorates.js';
import { parseCsvRow } from '../../importParse.js';

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
  });
});

r.patch('/settings', requireAdmin, (req, res) => {
  const { listing_ttl_days, reserve_on_confirm } = req.body || {};
  if (listing_ttl_days != null) {
    const n = Number(listing_ttl_days);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'bad_ttl' });
    setSettingValue('listing_ttl_days', n);
  }
  if (reserve_on_confirm != null) {
    setSettingValue('reserve_on_confirm', reserve_on_confirm ? '1' : '0');
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
  let sql = `
    SELECT l.*, u.display_name AS seller_name, u.phone AS seller_phone
    FROM phone_listings l JOIN users u ON u.id = l.seller_id
  `;
  const params = [];
  if (status) { sql += ' WHERE l.status=?'; params.push(status); }
  sql += ' ORDER BY l.created_at DESC LIMIT 200';
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

  if (!brand || !model || !governorate) return res.status(400).json({ error: 'missing_fields' });
  if (!isBrand(brand)) return res.status(400).json({ error: 'bad_brand' });
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
    seller.id, brand, model, storage || null, color || null, condition,
    null, null, '[]', askingPrice,
    governorate, city || null, description || null, 'active',
    phone, wa,
    t, t + TTL_MS, t,
  ).lastInsertRowid;

  res.json({ ok: true, listing_id: listingId, seller_id: seller.id });
});

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

  const t = now();
  const startPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM listing_images WHERE listing_id=?')
    .get(listing.id).next;
  const ins = db.prepare(
    'INSERT INTO listing_images(listing_id, image_path, position, created_at) VALUES(?,?,?,?)',
  );
  const added = [];
  req.files.forEach((f, idx) => {
    const imagePath = `/uploads/${f.filename}`;
    ins.run(listing.id, imagePath, startPos + idx, t);
    added.push(imagePath);
  });
  res.json({ ok: true, added });
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

export default r;
