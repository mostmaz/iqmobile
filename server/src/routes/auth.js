import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { hashPassword, verifyPassword, issueToken, requireAuth, optionalAuth } from '../auth.js';
import { isGovernorate } from '../governorates.js';

const r = Router();

const UP = path.resolve('./uploads');
fs.mkdirSync(UP, { recursive: true });
const profileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 6) || '.jpg';
    cb(null, 'pf_' + crypto.randomBytes(10).toString('hex') + ext);
  },
});
const profileUpload = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('not_image'));
    cb(null, true);
  },
});

// Iraqi mobile: 11 digits starting 07XXXXXXXXX. Accept loose user input
// (spaces, dashes, +964, 00964) and normalise to the local form.
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let d = input.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  if (!d.startsWith('0')) d = '0' + d;
  if (d.length < 10 || d.length > 12) return null;
  return d;
}

function publicUser(row) {
  return {
    id: row.id,
    // Don't surface the synthetic guest:* identifier as a real phone.
    phone: row.is_guest ? null : row.phone,
    display_name: row.display_name,
    governorate: row.governorate,
    city: row.city,
    profile_image_path: row.profile_image_path,
    rating_avg: row.rating_avg,
    rating_count: row.rating_count,
    verified: !!row.verified,
    seller_type: row.seller_type || 'individual',
    shop_years: row.shop_years,
    shop_image_path: row.shop_image_path || null,
    shop_lat: row.shop_lat ?? null,
    shop_lng: row.shop_lng ?? null,
    is_guest: !!row.is_guest,
    // Profile-completion + edit-budget signals so the client knows to
    // gate on the first-login form and disable the "edit" button when
    // the limit is reached.
    profile_completed: !!row.profile_completed,
    name_edits_remaining: Math.max(0, 2 - (row.name_edit_count || 0)),
    shop_image_edits_remaining: Math.max(0, 2 - (row.shop_image_edit_count || 0)),
    shop_location_edits_remaining: Math.max(0, 2 - (row.shop_location_edit_count || 0)),
  };
}

// Minimal signup — phone + password + account type. Display name and
// governorate get sensible defaults so users can finish onboarding without
// a long form; they refine them later in EditProfile. (OTP comes later.)
r.post('/register', (req, res) => {
  const { password, display_name, governorate, city, seller_type, shop_years } = req.body || {};
  const phone = normalizePhone(req.body?.phone);
  if (!phone || !password) return res.status(400).json({ error: 'missing_fields' });
  if (password.length < 6) return res.status(400).json({ error: 'weak_password' });
  if (governorate && !isGovernorate(governorate)) return res.status(400).json({ error: 'bad_governorate' });

  const sellerType = seller_type === 'shop' ? 'shop' : 'individual';
  const shopYears = sellerType === 'shop' && Number.isFinite(Number(shop_years))
    ? Math.max(0, Math.min(99, Math.floor(Number(shop_years))))
    : null;

  // Default display name to the last 4 digits of the phone so the in-app
  // profile reads as "مستخدم 4567" instead of an empty string. Default
  // governorate is Baghdad (largest market) — user changes it later.
  const finalName = (display_name && String(display_name).trim()) || `مستخدم ${phone.slice(-4)}`;
  const finalGov = governorate || 'Baghdad';

  const exists = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
  if (exists) return res.status(409).json({ error: 'phone_taken' });

  const hash = hashPassword(password);
  const ins = db
    .prepare(
      `INSERT INTO users(phone, password_hash, display_name, governorate, city, seller_type, shop_years, created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(phone, hash, finalName, finalGov, city || null, sellerType, shopYears, now());
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(ins.lastInsertRowid);
  const token = issueToken({ id: user.id });
  res.json({ token, user: publicUser(user) });
});

// Legacy alias retained so older builds of the mobile app continue to work
// while users update.
r.post('/signup', (req, res, next) => {
  req.url = '/register';
  next();
});

// Anonymous guest auth — creates a user row with a synthetic phone (never
// shown to other users) and returns a token. Used during the "no auth"
// growth phase: the app silently provisions a guest on first launch so
// every user can post / chat / save without typing credentials. When we
// later require real signup for sellers, the client prompts the guest to
// upgrade and we update the row's phone + password.
r.post('/guest', (req, res) => {
  const { governorate } = req.body || {};
  const gov = governorate && isGovernorate(governorate) ? governorate : 'Baghdad';
  // 26 hex chars — unique-enough to never collide with the 11-digit Iraqi
  // mobile namespace, and prefixed so admin tooling can spot guests.
  const syntheticPhone = `guest:${crypto.randomBytes(13).toString('hex')}`;
  const ins = db
    .prepare(
      `INSERT INTO users(phone, password_hash, display_name, governorate, seller_type, is_guest, created_at)
       VALUES(?,?,?,?,?,?,?)`,
    )
    .run(syntheticPhone, '', 'ضيف', gov, 'individual', 1, now());
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(ins.lastInsertRowid);
  const token = issueToken({ id: user.id });
  res.json({ token, user: publicUser(user) });
});

r.post('/login', (req, res) => {
  const { password } = req.body || {};
  const phone = normalizePhone(req.body?.phone);
  if (!phone || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!row || !verifyPassword(password, row.password_hash))
    return res.status(401).json({ error: 'bad_credentials' });
  const token = issueToken({ id: row.id });
  res.json({ token, user: publicUser(row) });
});

// Passwordless phone-as-username flow. No SMS/OTP yet — that's Phase 2.
// Behavior:
//   - phone is normalized (07XXXXXXXXX form)
//   - if a real user already exists for this phone → log in, return token
//   - if a *guest* session is currently authenticated AND phone is free,
//     upgrade the guest into a real user by writing the phone in-place
//     (preserves their saved listings, chats, ratings)
//   - otherwise create a fresh user
// SECURITY NOTE: this is intentionally trust-on-first-use until SMS OTP
// lands. Anyone who knows your phone number can claim it. Don't ship to
// production without OTP — see the SIM verification discussion below.
r.post('/phone-login', optionalAuth(), (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'bad_phone' });

  const existing = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (existing) {
    // Phone is already attached to a real account — log them straight in.
    const token = issueToken({ id: existing.id });
    return res.json({ token, user: publicUser(existing) });
  }

  // Phone is unclaimed. If the caller is currently a guest, promote that
  // guest to a real account so their session continuity is preserved.
  if (req.user) {
    const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (me?.is_guest) {
      const finalName = me.display_name && me.display_name !== 'ضيف'
        ? me.display_name
        : `مستخدم ${phone.slice(-4)}`;
      db.prepare(
        'UPDATE users SET phone=?, is_guest=0, display_name=? WHERE id=?',
      ).run(phone, finalName, me.id);
      const updated = db.prepare('SELECT * FROM users WHERE id=?').get(me.id);
      const token = issueToken({ id: updated.id });
      return res.json({ token, user: publicUser(updated) });
    }
  }

  // Fresh signup — no existing account, no guest to promote.
  const finalName = `مستخدم ${phone.slice(-4)}`;
  const ins = db.prepare(
    `INSERT INTO users(phone, password_hash, display_name, governorate, seller_type, created_at)
     VALUES(?,?,?,?,?,?)`,
  ).run(phone, '', finalName, 'Baghdad', 'individual', now());
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(ins.lastInsertRowid);
  const token = issueToken({ id: user.id });
  res.json({ token, user: publicUser(user) });
});

r.get('/me', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ user: publicUser(row) });
});

r.patch('/me', requireAuth(), (req, res) => {
  const { display_name, governorate, city, seller_type, shop_years, shop_lat, shop_lng } = req.body || {};
  if (governorate && !isGovernorate(governorate)) return res.status(400).json({ error: 'bad_governorate' });

  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!me) return res.status(404).json({ error: 'not_found' });

  const fields = [];
  const params = [];

  // display_name — bounded to 2 edits after the initial complete-profile setup.
  if (typeof display_name === 'string' && display_name.trim() && display_name.trim() !== me.display_name) {
    if ((me.name_edit_count || 0) >= 2) return res.status(403).json({ error: 'name_edit_limit_reached' });
    fields.push('display_name=?'); params.push(display_name.trim());
    fields.push('name_edit_count=?'); params.push((me.name_edit_count || 0) + 1);
  }
  if (governorate && governorate !== me.governorate) {
    fields.push('governorate=?'); params.push(governorate);
  }
  if (city !== undefined && (city || null) !== (me.city || null)) {
    fields.push('city=?'); params.push(city || null);
  }
  if ((seller_type === 'individual' || seller_type === 'shop') && seller_type !== me.seller_type) {
    fields.push('seller_type=?'); params.push(seller_type);
  }
  if (shop_years !== undefined) {
    const n = Number(shop_years);
    fields.push('shop_years=?');
    params.push(Number.isFinite(n) ? Math.max(0, Math.min(99, Math.floor(n))) : null);
  }
  // Shop location — bounded to 2 edits.
  if (shop_lat !== undefined && shop_lng !== undefined) {
    const lat = Number(shop_lat); const lng = Number(shop_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== me.shop_lat || lng !== me.shop_lng)) {
      if ((me.shop_location_edit_count || 0) >= 2) return res.status(403).json({ error: 'shop_location_edit_limit_reached' });
      fields.push('shop_lat=?'); params.push(lat);
      fields.push('shop_lng=?'); params.push(lng);
      fields.push('shop_location_edit_count=?'); params.push((me.shop_location_edit_count || 0) + 1);
    }
  }

  if (fields.length === 0) return res.json({ user: publicUser(me) });
  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...params);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(row) });
});

// First-login profile completion. Required: display_name. If seller_type
// is 'shop', also required: shop_image (multipart) + shop_lat/shop_lng.
// This is the *initial* setup, NOT counted against the 2-edit budget —
// that budget only applies to subsequent PATCH /me changes.
r.post('/complete-profile', requireAuth(), profileUpload.single('shop_image'), (req, res) => {
  const { display_name, seller_type, shop_lat, shop_lng } = req.body || {};
  const cleanup = () => { if (req.file) try { fs.unlinkSync(req.file.path); } catch {} };

  const name = typeof display_name === 'string' ? display_name.trim() : '';
  if (name.length < 2) { cleanup(); return res.status(400).json({ error: 'name_too_short' }); }

  const sellerType = seller_type === 'shop' ? 'shop' : 'individual';
  let shopImagePath = null, shopLat = null, shopLng = null;

  if (sellerType === 'shop') {
    if (!req.file) return res.status(400).json({ error: 'shop_image_required' });
    const lat = Number(shop_lat), lng = Number(shop_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      cleanup(); return res.status(400).json({ error: 'shop_location_required' });
    }
    shopImagePath = `/uploads/${req.file.filename}`;
    shopLat = lat; shopLng = lng;
  } else {
    cleanup(); // discard any uploaded file if user picked individual
  }

  db.prepare(
    `UPDATE users
     SET display_name=?, seller_type=?,
         shop_image_path=?, shop_lat=?, shop_lng=?,
         profile_completed=1
     WHERE id=?`,
  ).run(name, sellerType, shopImagePath, shopLat, shopLng, req.user.id);

  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(row) });
});

// Update shop image after initial completion (separate endpoint because
// multipart). Bounded to 2 edits.
r.post('/shop-image', requireAuth(), profileUpload.single('shop_image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!me) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(404).json({ error: 'not_found' }); }
  if ((me.shop_image_edit_count || 0) >= 2) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(403).json({ error: 'shop_image_edit_limit_reached' });
  }
  // Delete the old image from disk to avoid orphans.
  if (me.shop_image_path) {
    try { fs.unlinkSync(path.join(UP, path.basename(me.shop_image_path))); } catch {}
  }
  const newPath = `/uploads/${req.file.filename}`;
  db.prepare(
    'UPDATE users SET shop_image_path=?, shop_image_edit_count=? WHERE id=?',
  ).run(newPath, (me.shop_image_edit_count || 0) + 1, req.user.id);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(row) });
});

r.post('/profile-image', requireAuth(), profileUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  if (req.file.size <= 0) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'empty_image' });
  }
  const newPath = `/uploads/${req.file.filename}`;
  const prev = db.prepare('SELECT profile_image_path FROM users WHERE id=?').get(req.user.id);
  if (prev?.profile_image_path) {
    try { fs.unlinkSync(path.join(UP, path.basename(prev.profile_image_path))); } catch {}
  }
  db.prepare('UPDATE users SET profile_image_path=? WHERE id=?').run(newPath, req.user.id);
  res.json({ profile_image_path: newPath });
});

r.post('/push-token', requireAuth(), (req, res) => {
  const { expo_push_token } = req.body || {};
  db.prepare('UPDATE users SET expo_push_token=? WHERE id=?').run(expo_push_token || null, req.user.id);
  res.json({ ok: true });
});

// Diagnostic endpoint — clients call this from registerPushToken with
// the result of each step so we can see WHY token registration is
// failing on a device we can't attach a debugger to. Logs to stdout
// (visible via `pm2 logs iqmobile`). Strip after the issue is solved.
r.post('/push-debug', requireAuth(), (req, res) => {
  const msg = String(req.body?.msg || '').slice(0, 1000);
  console.log(`[push-debug] user=${req.user.id} :: ${msg}`);
  res.json({ ok: true });
});

export default r;
