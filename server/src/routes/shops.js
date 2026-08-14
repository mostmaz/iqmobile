import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now, getSetting } from '../db.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { isGovernorate, normalizeGovernorate } from '../governorates.js';
import { pushToAdmins } from '../adminPush.js';
import { uploadLimiter } from '../limits.js';
import { logEvent } from '../eventLog.js';

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
  // Contact suppression (users.shop_no_contact) blanks every number below.
  const noContact = !!u.shop_no_contact;
  // Matches the shop page's listing set: everything but 'removed' (sold and
  // expired show with badges), so the directory count equals the page.
  const listing_count = db.prepare(
    "SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND status IN ('active','reserved','sold','expired')",
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
    shop_phone: noContact ? null : (u.shop_phone || u.phone || null),
    shop_whatsapp: noContact ? null : (u.shop_whatsapp || null),
    // Full list of public numbers (branch lines). Falls back to the single
    // legacy shop_phone / account phone so older shops still show a number.
    // Note the account-phone fallback: a contact-suppressed shop must return
    // an empty list, or it would leak the login phone it was registered with.
    shop_phones: (() => {
      if (noContact) return [];
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
    // Storefront mode. The app shows add-to-cart + COD checkout instead of
    // the call/WhatsApp row when this is on. Shipping is a flat per-order
    // charge, sent alongside so the cart can show the total before checkout.
    orders_enabled: !!u.shop_orders_enabled,
    shipping_fee: u.shop_orders_enabled ? (Number(u.shop_shipping_fee) || 0) : null,
  };
}

// ─── shop directory ──────────────────────────────────────────────────
// Public. Optional ?governorate= filter (Arabic or English accepted). Featured
// shops first, then by rating, then by inventory size.
r.get('/shops', (req, res) => {
  const nowTs = Date.now();
  // Approved only. shop_hidden stays a separate, admin-only lever — the
  // aggregator shop is hidden but approved, and a pending shop is neither.
  let sql = `SELECT * FROM users WHERE seller_type='shop'
    AND COALESCE(shop_hidden,0)=0 AND COALESCE(shop_status,'approved')='approved'`;
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
r.get('/shops/:id(\\d+)', optionalAuth(), (req, res) => {
  const nowTs = Date.now();
  const u = db.prepare("SELECT * FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  // A shop awaiting review is visible to its owner only — he can preview
  // exactly what buyers will get, which is the whole point of letting him
  // keep working while we look. To everyone else it does not exist yet.
  // 404 rather than 403: a stranger has no business learning the shop is
  // merely pending as opposed to absent.
  if ((u.shop_status || 'approved') !== 'approved' && req.user?.id !== u.id) {
    return res.status(404).json({ error: 'not_found' });
  }
  // A shop-page open is the classic-shop twin of the storefront's
  // store_browse — it is how the hidden price-book shop gets browsed (the
  // home banner deep-links straight here), so without this row that whole
  // shop is invisible to the traffic page. Owner previews don't count.
  if (req.user?.id !== u.id) {
    logEvent({ type: 'shop_view', shop_id: u.id, user_id: req.user?.id ?? null });
  }
  // Matches the browse feed's default view: sold (مباع) and expired (منتهي)
  // stay visible with badges. The "never expire" toggle (default on)
  // controls the TTL window.
  const neverExpire = getSetting('listings_never_expire') !== '0';
  const statusClause = neverExpire
    ? "status IN ('active','reserved','sold','expired')"
    : "status IN ('active','reserved','sold','expired') AND expires_at > ?";
  // 300, not 100. The app derives the shop page's brand filter from THIS array,
  // so a cap below the shop's real inventory silently drops whole brands from
  // the filter: at 100 the 143-listing price shop showed five brands and hid
  // Honor, Infinix and Apple entirely, because all of their rows fell in the
  // truncated tail. It also contradicted the "143 إعلان" header. Matches the
  // web shop page's limit.
  const listings = db.prepare(
    `SELECT * FROM phone_listings
     WHERE seller_id=? AND ${statusClause}
     ORDER BY
       (CASE WHEN stale_since IS NOT NULL THEN 1 ELSE 0 END) ASC,
       (CASE WHEN featured_until > ? THEN 1 ELSE 0 END) DESC,
       created_at DESC
     LIMIT 300`,
  ).all(...(neverExpire ? [u.id, nowTs] : [u.id, nowTs, nowTs]));
  res.json({
    ...shopCard(u, nowTs),
    shop_images: shopImages(u.id),
    // This is the list the shop page actually renders, so contact suppression
    // has to happen here too — not just on /listings/:id. Without it the cards
    // would still carry the number the shop page itself is hiding.
    listings: attachImages(listings).map((l) => ({
      ...l,
      ...(u.shop_no_contact
        ? { contact_phone: null, contact_whatsapp: null, seller_phone: null, phone_visible: false }
        : {}),
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

  // A FIRST registration enters review. An edit by an already-approved shop
  // does not — re-saving a bio must not delist a working shop, and this
  // route is deliberately idempotent (it doubles as "edit my shop").
  const existing = db.prepare(
    'SELECT seller_type, shop_status FROM users WHERE id=?',
  ).get(req.user.id);
  const isFirstRegistration = existing?.seller_type !== 'shop';

  const fields = [
    'seller_type=?', 'shop_name=?', 'shop_bio=?', 'shop_phone=?',
    'shop_whatsapp=?', 'shop_address=?', 'shop_phones=?', 'shop_facebook=?', 'shop_instagram=?',
  ];
  const params = ['shop', shop_name, shop_bio, shop_phone, shop_whatsapp, shop_address,
    JSON.stringify(shop_phones), shop_facebook, shop_instagram];
  if (governorate) { fields.push('governorate=?'); params.push(governorate); }
  if (isFirstRegistration) {
    fields.push('shop_status=?');
    params.push('pending');
  }
  // Stamp shop_created_at once (first time they register).
  fields.push('shop_created_at=COALESCE(shop_created_at, ?)');
  params.push(now());
  params.push(req.user.id);

  // Was this an upgrade from a personal account, or an edit to a shop that
  // already existed? Only the first is worth waking anyone for — re-saving a
  // bio should not read as a new shop.
  const wasShop = db.prepare(
    'SELECT seller_type FROM users WHERE id=?',
  ).get(req.user.id)?.seller_type === 'shop';

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...params);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);

  if (!wasShop) {
    setImmediate(() => {
      pushToAdmins(
        'shop.new',
        'متجر جديد',
        `${shop_name}${governorate ? ` · ${governorate}` : ''}${shop_phone ? ` · ${shop_phone}` : ''}`,
        { shop_id: u.id },
      ).catch(() => {});
    });
  }

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

// ─── my shop's review status + thread ─────────────────────────────────
// What the owner sees while he waits. Old app builds ignore this endpoint
// entirely and learn the same facts by push, which is why the review note is
// also pushed rather than left to be discovered here.
r.get('/shops/me/review', requireAuth(), (req, res) => {
  const me = db.prepare(
    `SELECT id, seller_type, shop_status, shop_review_note, shop_reviewed_at, shop_created_at
       FROM users WHERE id=?`,
  ).get(req.user.id);
  if (!me || me.seller_type !== 'shop') return res.status(404).json({ error: 'not_a_shop' });

  const messages = db.prepare(
    `SELECT id, author, body, created_at FROM shop_review_messages
      WHERE shop_id=? ORDER BY created_at ASC LIMIT 200`,
  ).all(me.id);

  // Mark the admin side read the moment he opens the thread.
  db.prepare(
    `UPDATE shop_review_messages SET read_by_shop_at=?
      WHERE shop_id=? AND author='admin' AND read_by_shop_at IS NULL`,
  ).run(Date.now(), me.id);

  res.json({
    status: me.shop_status || 'approved',
    note: me.shop_review_note || null,
    reviewed_at: me.shop_reviewed_at || null,
    submitted_at: me.shop_created_at || null,
    messages,
  });
});

// The owner replying to a change request.
r.post('/shops/me/review/messages', requireAuth(), (req, res) => {
  const me = db.prepare("SELECT id, seller_type, shop_name FROM users WHERE id=?").get(req.user.id);
  if (!me || me.seller_type !== 'shop') return res.status(404).json({ error: 'not_a_shop' });
  const body = String(req.body?.body || '').trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: 'empty' });

  db.prepare(
    `INSERT INTO shop_review_messages(shop_id, author, body, created_at)
     VALUES(?, 'shop', ?, ?)`,
  ).run(me.id, body, Date.now());

  // Wake the reviewers on the operator app. Reuses the existing 'shop.new'
  // kind rather than inventing one: reviewers who muted new-shop alerts have
  // said they don't want shop traffic, and a reply is the same conversation.
  pushToAdmins('shop.new', `رد من ${me.shop_name || 'متجر'}`, body.slice(0, 120), {
    screen: 'shop_review', shop_id: me.id,
  }).catch(() => { /* best-effort */ });

  res.json({ ok: true });
});

export default r;
