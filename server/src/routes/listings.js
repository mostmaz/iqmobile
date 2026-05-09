import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now, getSetting } from '../db.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { isGovernorate, isBrand } from '../governorates.js';

const r = Router();

const UP = path.resolve('./uploads');
fs.mkdirSync(UP, { recursive: true });
const imgStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 6) || '.jpg';
    cb(null, 'lst_' + crypto.randomBytes(12).toString('hex') + ext);
  },
});
const imgUpload = multer({
  storage: imgStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('not_image'));
    cb(null, true);
  },
});

const CONDITIONS = ['new', 'used', 'repaired', 'refurbished'];
const MAX_IMAGES = 10;

function ttlMs() {
  const days = Number(getSetting('listing_ttl_days')) || 30;
  return days * 24 * 60 * 60 * 1000;
}

function loadListing(id) {
  return db.prepare('SELECT * FROM phone_listings WHERE id=?').get(id);
}

function attachImages(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const imgs = db
    .prepare(`SELECT id, listing_id, image_path, position FROM listing_images WHERE listing_id IN (${placeholders}) ORDER BY position ASC, id ASC`)
    .all(...ids);
  const byId = new Map(rows.map((r) => [r.id, { ...r, images: [], accessories: JSON.parse(r.accessories_json || '[]') }]));
  for (const im of imgs) byId.get(im.listing_id)?.images.push(im);
  return Array.from(byId.values());
}

// Public seller card — drops phone & sensitive bits.
function sellerCard(uid) {
  const u = db.prepare(
    `SELECT id, display_name, governorate, city, profile_image_path, rating_avg, rating_count,
            verified, seller_type, shop_years,
            shop_image_path, shop_lat, shop_lng
     FROM users WHERE id=?`,
  ).get(uid);
  if (!u) return null;
  return {
    ...u,
    verified: !!u.verified,
    seller_type: u.seller_type || 'individual',
    shop_image_path: u.shop_image_path || null,
    shop_lat: u.shop_lat ?? null,
    shop_lng: u.shop_lng ?? null,
  };
}

// Normalise an Iraqi mobile phone — strips separators, accepts +964/00964,
// returns local 0XXXXXXXXXX form. Returns null if it doesn't look like a
// real number; empty input also returns null so optional fields work.
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

// ─── create listing ──────────────────────────────────────────────────
r.post('/', requireAuth(), (req, res) => {
  const {
    brand, model, storage, color, condition, battery_health,
    warranty_status, accessories, asking_price, governorate, city, description,
    contact_phone, contact_whatsapp,
  } = req.body || {};
  if (!brand || !model || !condition || !asking_price || !governorate)
    return res.status(400).json({ error: 'missing_fields' });
  if (!isBrand(brand)) return res.status(400).json({ error: 'bad_brand' });
  if (!CONDITIONS.includes(condition)) return res.status(400).json({ error: 'bad_condition' });
  if (!isGovernorate(governorate)) return res.status(400).json({ error: 'bad_governorate' });
  const price = Number(asking_price);
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'bad_price' });

  // Contact phone is required so buyers always have a tap-to-call path.
  const phone = normalizeIraqiPhone(contact_phone);
  if (!phone) return res.status(400).json({ error: 'bad_contact_phone' });
  // WhatsApp is optional. The mobile post wizard surfaces a "same number"
  // toggle that simply copies contact_phone into this field client-side.
  const wa = contact_whatsapp ? normalizeIraqiPhone(contact_whatsapp) : null;
  if (contact_whatsapp && !wa) return res.status(400).json({ error: 'bad_contact_whatsapp' });

  const created = now();
  const expires = created + ttlMs();
  const ins = db
    .prepare(
      `INSERT INTO phone_listings(
        seller_id, brand, model, storage, color, condition, battery_health,
        warranty_status, accessories_json, asking_price, governorate, city,
        description, status, contact_phone, contact_whatsapp,
        created_at, expires_at, updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      req.user.id, brand, model, storage || null, color || null, condition,
      Number.isFinite(Number(battery_health)) ? Number(battery_health) : null,
      warranty_status || null,
      JSON.stringify(Array.isArray(accessories) ? accessories : []),
      price, governorate, city || null, description || null,
      'active', phone, wa,
      created, expires, created,
    );
  const row = loadListing(ins.lastInsertRowid);
  res.json(attachImages([row])[0]);
});

// ─── browse listings ─────────────────────────────────────────────────
// Public — anonymous visitors can browse before they sign up. Auth only
// kicks in for save / chat / post.
r.get('/', optionalAuth(), (req, res) => {
  const { brand, model, governorate, condition, storage, color, verified_only, q, seller_type } = req.query;
  const minPrice = Number(req.query.min_price);
  const maxPrice = Number(req.query.max_price);
  // Pagination — defaults are tuned for the mobile browse grid: 15 per page
  // for fast initial render, infinite scroll appends more. Hard-cap at 50
  // so a misbehaving client can't exhaust the table in one shot.
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  // Browse shows active + reserved + sold listings. Sold ones stay visible
  // (with a "مباع" badge on the card) so the catalog reads as "what was for
  // sale here", not "live inventory only" — gives the marketplace a sense
  // of activity and helps buyers see what brands/prices have been moving.
  // 'removed' (soft-deleted) and 'expired' are excluded.
  let sql = `
    SELECT l.* FROM phone_listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.status IN ('active','reserved','sold') AND l.expires_at > ?
  `;
  const params = [Date.now()];
  if (brand && isBrand(String(brand))) { sql += ' AND l.brand=?'; params.push(brand); }
  if (model) { sql += ' AND l.model LIKE ?'; params.push('%' + String(model) + '%'); }
  if (governorate && isGovernorate(String(governorate))) { sql += ' AND l.governorate=?'; params.push(governorate); }
  if (condition && CONDITIONS.includes(String(condition))) { sql += ' AND l.condition=?'; params.push(condition); }
  if (storage) { sql += ' AND l.storage=?'; params.push(storage); }
  if (color) { sql += ' AND l.color=?'; params.push(color); }
  if (Number.isFinite(minPrice)) { sql += ' AND l.asking_price >= ?'; params.push(minPrice); }
  if (Number.isFinite(maxPrice)) { sql += ' AND l.asking_price <= ?'; params.push(maxPrice); }
  if (verified_only === '1' || verified_only === 'true') { sql += ' AND u.verified=1'; }
  if (seller_type === 'individual' || seller_type === 'shop') {
    sql += ' AND u.seller_type=?'; params.push(seller_type);
  }
  if (q) {
    sql += ' AND (l.brand LIKE ? OR l.model LIKE ? OR l.description LIKE ?)';
    const like = '%' + String(q) + '%';
    params.push(like, like, like);
  }
  sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params);
  const withImgs = attachImages(rows);
  // attach a thin seller card
  const out = withImgs.map((row) => ({ ...row, seller: sellerCard(row.seller_id) }));
  res.json(out);
});

// ─── my listings (seller dashboard) ──────────────────────────────────
r.get('/mine', requireAuth(), (req, res) => {
  const status = req.query.status || 'all';
  let rows;
  if (status === 'all') {
    rows = db.prepare("SELECT * FROM phone_listings WHERE seller_id=? AND status != 'removed' ORDER BY created_at DESC").all(req.user.id);
  } else {
    rows = db.prepare('SELECT * FROM phone_listings WHERE seller_id=? AND status=? ORDER BY created_at DESC').all(req.user.id, status);
  }
  res.json(attachImages(rows));
});

// ─── listing detail ──────────────────────────────────────────────────
// Public — anonymous visitors see the same listing data, with phone hidden
// (no logged-in user means they can't have a confirmed deal).
r.get('/:id(\\d+)', optionalAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row || row.status === 'removed') return res.status(404).json({ error: 'not_found' });
  const [withImgs] = attachImages([row]);
  const seller = sellerCard(row.seller_id);

  // Listing-level contact info is public (no deal-confirmation gate). The
  // legacy `seller_phone` / `phone_visible` fields are preserved for old
  // mobile builds — they now point to the listing's own contact_phone.
  res.json({
    ...withImgs,
    seller,
    seller_phone: row.contact_phone || null,
    phone_visible: !!row.contact_phone,
  });
});

// ─── update listing ──────────────────────────────────────────────────
const EDITABLE = ['storage','color','battery_health','warranty_status','asking_price','description','city','status'];

r.patch('/:id(\\d+)', requireAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });

  const fields = [];
  const params = [];
  for (const k of EDITABLE) {
    if (req.body[k] === undefined) continue;
    if (k === 'status' && !['active','reserved','sold','removed'].includes(req.body.status))
      return res.status(400).json({ error: 'bad_status' });
    if (k === 'asking_price') {
      const n = Number(req.body.asking_price);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'bad_price' });
      fields.push('asking_price=?'); params.push(n); continue;
    }
    fields.push(`${k}=?`);
    params.push(req.body[k]);
  }
  if (Array.isArray(req.body.accessories)) {
    fields.push('accessories_json=?');
    params.push(JSON.stringify(req.body.accessories));
  }
  if (fields.length === 0) return res.json(attachImages([row])[0]);
  fields.push('updated_at=?');
  params.push(now(), req.params.id);
  db.prepare(`UPDATE phone_listings SET ${fields.join(', ')} WHERE id=?`).run(...params);
  res.json(attachImages([loadListing(req.params.id)])[0]);
});

// ─── renew expired listing ───────────────────────────────────────────
r.post('/:id(\\d+)/renew', requireAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (!['expired','active'].includes(row.status)) return res.status(409).json({ error: 'cannot_renew' });
  const t = now();
  db.prepare("UPDATE phone_listings SET status='active', expires_at=?, updated_at=? WHERE id=?")
    .run(t + ttlMs(), t, row.id);
  res.json(attachImages([loadListing(row.id)])[0]);
});

// ─── delete (soft) ───────────────────────────────────────────────────
r.delete('/:id(\\d+)', requireAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.prepare("UPDATE phone_listings SET status='removed', updated_at=? WHERE id=?").run(now(), row.id);
  res.json({ ok: true });
});

// ─── upload images ───────────────────────────────────────────────────
r.post('/:id(\\d+)/images', requireAuth(), imgUpload.array('images', MAX_IMAGES), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'no_files' });

  const existing = db.prepare('SELECT COUNT(*) AS n FROM listing_images WHERE listing_id=?').get(row.id).n;
  if (existing + files.length > MAX_IMAGES) {
    for (const f of files) { try { fs.unlinkSync(f.path); } catch {} }
    return res.status(400).json({ error: 'too_many_images' });
  }
  const t = now();
  const ins = db.prepare('INSERT INTO listing_images(listing_id, image_path, position, created_at) VALUES(?,?,?,?)');
  let pos = existing;
  const out = [];
  for (const f of files) {
    if (f.size <= 0) { try { fs.unlinkSync(f.path); } catch {} continue; }
    const p = `/uploads/${f.filename}`;
    const id = ins.run(row.id, p, pos++, t).lastInsertRowid;
    out.push({ id, listing_id: row.id, image_path: p, position: pos - 1 });
  }
  db.prepare('UPDATE phone_listings SET updated_at=? WHERE id=?').run(t, row.id);
  res.json(out);
});

// ─── delete a single image ───────────────────────────────────────────
r.delete('/:id(\\d+)/images/:imageId(\\d+)', requireAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const img = db.prepare('SELECT * FROM listing_images WHERE id=? AND listing_id=?').get(req.params.imageId, row.id);
  if (!img) return res.status(404).json({ error: 'not_found' });
  try { fs.unlinkSync(path.join(UP, path.basename(img.image_path))); } catch {}
  db.prepare('DELETE FROM listing_images WHERE id=?').run(img.id);
  res.json({ ok: true });
});

// ─── save / unsave ───────────────────────────────────────────────────
r.post('/:id(\\d+)/save', requireAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare(
    'INSERT OR IGNORE INTO saved_listings(user_id, listing_id, created_at) VALUES(?,?,?)',
  ).run(req.user.id, row.id, now());
  res.json({ ok: true });
});

r.delete('/:id(\\d+)/save', requireAuth(), (req, res) => {
  db.prepare('DELETE FROM saved_listings WHERE user_id=? AND listing_id=?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

r.get('/saved/mine', requireAuth(), (req, res) => {
  const rows = db.prepare(
    `SELECT l.* FROM saved_listings s
     JOIN phone_listings l ON l.id = s.listing_id
     WHERE s.user_id=? AND l.status != 'removed'
     ORDER BY s.created_at DESC LIMIT 100`,
  ).all(req.user.id);
  const withImgs = attachImages(rows);
  res.json(withImgs.map((r) => ({ ...r, seller: sellerCard(r.seller_id) })));
});

export default r;
