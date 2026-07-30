import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now, getSetting } from '../db.js';
import { requireAuth } from '../auth.js';
import { isGovernorate, normalizeGovernorate } from '../governorates.js';
import { uploadLimiter } from '../limits.js';

const r = Router();

// Shop price-list image uploads. Same photo-only hygiene as routes/listings.js
// (whitelist mime + rewrite extension so a forged SVG can't be served back).
const UP = path.resolve('./uploads');
fs.mkdirSync(UP, { recursive: true });
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
function pickSafeExt(originalname, mimetype) {
  const ext = (path.extname(originalname || '') || '').toLowerCase();
  if (ALLOWED_IMAGE_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}
const shopImgUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UP),
    filename: (_req, file, cb) =>
      cb(null, 'shp_' + crypto.randomBytes(12).toString('hex') + pickSafeExt(file.originalname, file.mimetype)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) return cb(new Error('not_image'));
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (ext && !ALLOWED_IMAGE_EXT.has(ext)) return cb(new Error('not_image'));
    cb(null, true);
  },
});
const MAX_SHOP_IMAGES = 20;

// Parse a phones payload: accept an array (preferred) or a single string;
// normalize each Iraqi number, drop invalids, de-dup, cap the list.
export function parseShopPhones(input) {
  const list = Array.isArray(input) ? input : input != null ? [input] : [];
  const out = [];
  for (const v of list) {
    const p = normalizeIraqiPhone(v);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= 6) break;
  }
  return out;
}

// Sanitize a social profile URL: trim, cap length, require an http(s) scheme
// (prepend https:// when the user pasted a bare host/handle-looking value).
export function sanitizeUrl(v) {
  if (!v) return null;
  let s = String(v).trim().slice(0, 300);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  return s;
}

// Shop price-list images, ordered.
export function shopImages(shopId) {
  return db.prepare(
    'SELECT id, image_path, position FROM shop_images WHERE shop_id=? ORDER BY position ASC, id ASC',
  ).all(shopId);
}

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

// Minimal image attach (local copy — routes/listings.js keeps its own private
// version). Mutates nothing; returns new rows with an `images` array.
function attachImages(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = rows.map((x) => x.id);
  const ph = ids.map(() => '?').join(',');
  const imgs = db.prepare(
    `SELECT id, listing_id, image_path, position FROM listing_images
     WHERE listing_id IN (${ph}) ORDER BY position ASC, id ASC`,
  ).all(...ids);
  const byId = new Map(rows.map((x) => [x.id, { ...x, images: [], accessories: JSON.parse(x.accessories_json || '[]') }]));
  for (const im of imgs) byId.get(im.listing_id)?.images.push(im);
  return Array.from(byId.values());
}

// Public shop card. Contact falls back to the account phone when no dedicated
// shop_phone was set. Featured shops are flagged so the directory can badge +
// float them.
function shopCard(u, nowTs) {
  // Matches the shop page's listing set: active + reserved + sold visible,
  // expired hidden — so the directory count equals what the page shows.
  const listing_count = db.prepare(
    "SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND status IN ('active','reserved','sold')",
  ).get(u.id).n;
  return {
    id: u.id,
    display_name: u.display_name,
    shop_name: u.shop_name || u.display_name,
    governorate: u.governorate,
    city: u.city || null,
    profile_image_path: u.profile_image_path || null,
    shop_image_path: u.shop_image_path || null,
    shop_bio: u.shop_bio || null,
    shop_address: u.shop_address || null,
    shop_phone: u.shop_phone || u.phone || null,
    shop_whatsapp: u.shop_whatsapp || null,
    // Full list of public numbers (branch lines). Falls back to the single
    // legacy shop_phone / account phone so older shops still show a number.
    shop_phones: (() => {
      let a = [];
      try { const p = JSON.parse(u.shop_phones || '[]'); if (Array.isArray(p)) a = p; } catch {}
      if (!a.length && u.shop_phone) a = [u.shop_phone];
      if (!a.length && u.phone) a = [u.phone];
      return a;
    })(),
    shop_facebook: u.shop_facebook || null,
    shop_instagram: u.shop_instagram || null,
    rating_avg: u.rating_avg,
    rating_count: u.rating_count,
    verified: !!u.verified,
    is_featured: !!(u.shop_featured_until && u.shop_featured_until > nowTs),
    listing_count,
  };
}

// ─── shop directory ──────────────────────────────────────────────────
// Public. Optional ?governorate= filter (Arabic or English accepted). Featured
// shops first, then by rating, then by inventory size.
r.get('/shops', (req, res) => {
  const nowTs = Date.now();
  let sql = "SELECT * FROM users WHERE seller_type='shop'";
  const params = [];
  const gov = req.query.governorate ? normalizeGovernorate(String(req.query.governorate)) : null;
  if (req.query.governorate && gov && isGovernorate(gov)) { sql += ' AND governorate=?'; params.push(gov); }
  sql += `
    ORDER BY
      (CASE WHEN shop_featured_until > ? THEN 1 ELSE 0 END) DESC,
      rating_avg DESC, rating_count DESC
    LIMIT 300`;
  params.push(nowTs);
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((u) => shopCard(u, nowTs)));
});

// ─── shop detail (+ their listings) ──────────────────────────────────
r.get('/shops/:id(\\d+)', (req, res) => {
  const nowTs = Date.now();
  const u = db.prepare("SELECT * FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  // Matches the browse feed: sold stays visible (مباع badge), expired
  // hidden. The "never expire" toggle (default on) controls the TTL window.
  const neverExpire = getSetting('listings_never_expire') !== '0';
  const statusClause = neverExpire
    ? "status IN ('active','reserved','sold')"
    : "status IN ('active','reserved','sold') AND expires_at > ?";
  const listings = db.prepare(
    `SELECT * FROM phone_listings
     WHERE seller_id=? AND ${statusClause}
     ORDER BY
       (CASE WHEN featured_until > ? THEN 1 ELSE 0 END) DESC,
       created_at DESC
     LIMIT 100`,
  ).all(...(neverExpire ? [u.id, nowTs] : [u.id, nowTs, nowTs]));
  res.json({
    ...shopCard(u, nowTs),
    shop_images: shopImages(u.id),
    listings: attachImages(listings).map((l) => ({
      ...l,
      is_featured: !!(l.featured_until && l.featured_until > nowTs),
    })),
  });
});

// ─── self-serve shop registration (free for now) ─────────────────────
// Flips the caller's account to seller_type='shop' and stores the shop
// profile. Idempotent — calling again edits the existing shop. A shop name +
// at least one contact number are required so the directory entry is useful.
r.post('/shops/register', requireAuth(), (req, res) => {
  const shop_name = String(req.body?.shop_name || '').trim().slice(0, 60);
  if (shop_name.length < 2) return res.status(400).json({ error: 'bad_shop_name' });

  const shop_bio = req.body?.shop_bio ? String(req.body.shop_bio).trim().slice(0, 500) : null;
  const shop_address = req.body?.shop_address ? String(req.body.shop_address).trim().slice(0, 200) : null;

  const shop_phones = parseShopPhones(req.body?.shop_phones);
  const explicitPhone = req.body?.shop_phone ? normalizeIraqiPhone(req.body.shop_phone) : null;
  if (req.body?.shop_phone && !explicitPhone) return res.status(400).json({ error: 'bad_shop_phone' });
  if (explicitPhone && !shop_phones.includes(explicitPhone)) shop_phones.unshift(explicitPhone);
  const shop_phone = shop_phones[0] || null; // legacy primary = first in the list
  const shop_whatsapp = req.body?.shop_whatsapp ? normalizeIraqiPhone(req.body.shop_whatsapp) : null;
  if (req.body?.shop_whatsapp && !shop_whatsapp) return res.status(400).json({ error: 'bad_shop_whatsapp' });
  const shop_facebook = sanitizeUrl(req.body?.shop_facebook);
  const shop_instagram = sanitizeUrl(req.body?.shop_instagram);

  // A reachable shop needs at least one public number; fall back to the
  // account phone when the user set neither field explicitly.
  const acct = db.prepare('SELECT phone FROM users WHERE id=?').get(req.user.id);
  if (!shop_phone && !shop_whatsapp && !acct?.phone) {
    return res.status(400).json({ error: 'contact_required' });
  }

  const govRaw = req.body?.governorate ? String(req.body.governorate).trim() : '';
  const governorate = govRaw ? normalizeGovernorate(govRaw) : null;
  if (govRaw && (!governorate || !isGovernorate(governorate))) {
    return res.status(400).json({ error: 'bad_governorate' });
  }

  const fields = [
    'seller_type=?', 'shop_name=?', 'shop_bio=?', 'shop_phone=?',
    'shop_whatsapp=?', 'shop_address=?', 'shop_phones=?', 'shop_facebook=?', 'shop_instagram=?',
  ];
  const params = ['shop', shop_name, shop_bio, shop_phone, shop_whatsapp, shop_address,
    JSON.stringify(shop_phones), shop_facebook, shop_instagram];
  if (governorate) { fields.push('governorate=?'); params.push(governorate); }
  // Stamp shop_created_at once (first time they register).
  fields.push('shop_created_at=COALESCE(shop_created_at, ?)');
  params.push(now());
  params.push(req.user.id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...params);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ ...shopCard(u, Date.now()), shop_images: shopImages(u.id) });
});

// ─── shop price-list images (self-serve) ─────────────────────────────
// The caller must already be a shop. Uploaded images append to their gallery
// (capped at MAX_SHOP_IMAGES). Returns the full ordered list back.
r.post('/shops/me/images', requireAuth(), uploadLimiter, shopImgUpload.array('images', MAX_SHOP_IMAGES), (req, res) => {
  const cleanup = () => { for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch {} } };
  const me = db.prepare('SELECT id, seller_type FROM users WHERE id=?').get(req.user.id);
  if (!me || me.seller_type !== 'shop') { cleanup(); return res.status(403).json({ error: 'not_a_shop' }); }
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'no_files' });

  const existing = db.prepare('SELECT COUNT(*) AS n FROM shop_images WHERE shop_id=?').get(me.id).n;
  if (existing + req.files.length > MAX_SHOP_IMAGES) { cleanup(); return res.status(400).json({ error: 'too_many_images' }); }

  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM shop_images WHERE shop_id=?').get(me.id).p;
  const ins = db.prepare('INSERT INTO shop_images(shop_id, image_path, position, created_at) VALUES(?,?,?,?)');
  const t = now();
  req.files.forEach((f, i) => ins.run(me.id, '/uploads/' + f.filename, maxPos + 1 + i, t));
  res.json({ ok: true, images: shopImages(me.id) });
});

r.delete('/shops/me/images/:id(\\d+)', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT id, image_path FROM shop_images WHERE id=? AND shop_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM shop_images WHERE id=?').run(row.id);
  try { fs.unlinkSync(path.join(UP, path.basename(row.image_path))); } catch {}
  res.json({ ok: true, images: shopImages(req.user.id) });
});

export default r;
