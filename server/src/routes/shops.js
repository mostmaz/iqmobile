import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { isGovernorate, normalizeGovernorate } from '../governorates.js';

const r = Router();

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
  const listings = db.prepare(
    `SELECT * FROM phone_listings
     WHERE seller_id=? AND status IN ('active','reserved','sold') AND expires_at > ?
     ORDER BY
       (CASE WHEN featured_until > ? THEN 1 ELSE 0 END) DESC,
       created_at DESC
     LIMIT 100`,
  ).all(u.id, nowTs, nowTs);
  res.json({
    ...shopCard(u, nowTs),
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

  const shop_phone = req.body?.shop_phone ? normalizeIraqiPhone(req.body.shop_phone) : null;
  if (req.body?.shop_phone && !shop_phone) return res.status(400).json({ error: 'bad_shop_phone' });
  const shop_whatsapp = req.body?.shop_whatsapp ? normalizeIraqiPhone(req.body.shop_whatsapp) : null;
  if (req.body?.shop_whatsapp && !shop_whatsapp) return res.status(400).json({ error: 'bad_shop_whatsapp' });

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
    'shop_whatsapp=?', 'shop_address=?',
  ];
  const params = ['shop', shop_name, shop_bio, shop_phone, shop_whatsapp, shop_address];
  if (governorate) { fields.push('governorate=?'); params.push(governorate); }
  // Stamp shop_created_at once (first time they register).
  fields.push('shop_created_at=COALESCE(shop_created_at, ?)');
  params.push(now());
  params.push(req.user.id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...params);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json(shopCard(u, Date.now()));
});

export default r;
