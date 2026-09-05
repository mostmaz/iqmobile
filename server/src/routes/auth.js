import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { hashPassword, verifyPassword, issueToken, requireAuth, optionalAuth } from '../auth.js';
import { isGovernorate } from '../governorates.js';
import { authLimiter, guestLimiter } from '../limits.js';
import { sendCode, checkCode, otpRequired, otpConfigured } from '../otp.js';

const r = Router();

const UP = path.resolve('./uploads');
fs.mkdirSync(UP, { recursive: true });

// Same image hygiene as routes/listings.js — see the long comment there
// for the SVG → stored-XSS rationale. Photos only; no SVGs, no GIFs, no
// pretending image/jpeg via a .svg file extension.
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
function pickSafeExt(originalname, mimetype) {
  const ext = (path.extname(originalname || '') || '').toLowerCase();
  if (ALLOWED_IMAGE_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}

const profileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    const ext = pickSafeExt(file.originalname, file.mimetype);
    cb(null, 'pf_' + crypto.randomBytes(10).toString('hex') + ext);
  },
});
const profileUpload = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) return cb(new Error('not_image'));
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (ext && !ALLOWED_IMAGE_EXT.has(ext)) return cb(new Error('not_image'));
    cb(null, true);
  },
});

// Display-name cap. Without it, a long name DoSes every browse-row payload.
const MAX_DISPLAY_NAME = 50;

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
    // Shop profile + contact channels, so the shop owner's Edit screen can
    // seed its inputs (individuals leave these null).
    shop_name: row.shop_name || null,
    shop_bio: row.shop_bio || null,
    shop_address: row.shop_address || null,
    shop_phone: row.shop_phone || null,
    shop_whatsapp: row.shop_whatsapp || null,
    shop_phones: (() => { try { const a = JSON.parse(row.shop_phones || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } })(),
    shop_facebook: row.shop_facebook || null,
    shop_instagram: row.shop_instagram || null,
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
r.post('/register', authLimiter, (req, res) => {
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
  const trimmedName = display_name ? String(display_name).trim().slice(0, MAX_DISPLAY_NAME) : '';
  const finalName = trimmedName || `مستخدم ${phone.slice(-4)}`;
  const finalGov = governorate || 'Baghdad';

  const exists = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
  if (exists) return res.status(409).json({ error: 'phone_taken' });

  const hash = hashPassword(password);
  // A shop born here enters review exactly like one from POST /shops/register.
  // shop_status defaults to 'approved' at the column level, so staying silent
  // about it publishes the shop immediately — which is how signup quietly
  // became a way around the review gate.
  const isShop = sellerType === 'shop';
  const ins = db
    .prepare(
      `INSERT INTO users(phone, password_hash, display_name, governorate, city, seller_type, shop_years, created_at,
                         shop_status, shop_origin, shop_created_at, registered_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(phone, hash, finalName, finalGov, city || null, sellerType, shopYears, now(),
      isShop ? 'pending' : 'approved',
      isShop ? 'self' : null,
      isShop ? now() : null, now());
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
r.post('/guest', guestLimiter, (req, res) => {
  const { governorate } = req.body || {};
  const gov = governorate && isGovernorate(governorate) ? governorate : 'Baghdad';
  // 26 hex chars — unique-enough to never collide with the 11-digit Iraqi
  // mobile namespace, and prefixed so admin tooling can spot guests.
  const syntheticPhone = `guest:${crypto.randomBytes(13).toString('hex')}`;
  // Append a 4-digit suffix to "ضيف" so when a seller receives a chat
  // from a guest buyer, their inbox shows e.g. "ضيف 4382" instead of
  // every guest collapsing to the same "ضيف" label. The suffix is the
  // user's eventual id (looked up after INSERT) so it's stable + unique.
  // Until the row exists we can't know the id, so insert with a
  // placeholder then UPDATE — cheap, runs once per guest.
  const ins = db
    .prepare(
      `INSERT INTO users(phone, password_hash, display_name, governorate, seller_type, is_guest, created_at, guest_created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(syntheticPhone, '', 'ضيف', gov, 'individual', 1, now(), now());
  const guestSuffix = String(ins.lastInsertRowid).padStart(4, '0').slice(-4);
  db.prepare('UPDATE users SET display_name=? WHERE id=?')
    .run(`ضيف ${guestSuffix}`, ins.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(ins.lastInsertRowid);
  const token = issueToken({ id: user.id });
  res.json({ token, user: publicUser(user) });
});

r.post('/login', authLimiter, (req, res) => {
  const { password } = req.body || {};
  const phone = normalizePhone(req.body?.phone);
  if (!phone || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!row || !verifyPassword(password, row.password_hash))
    return res.status(401).json({ error: 'bad_credentials' });
  const token = issueToken({ id: row.id });
  res.json({ token, user: publicUser(row) });
});

// Look up or provision the account for a phone number:
//   - if a real user exists → return it (log-in path)
//   - if the caller is currently a guest AND the phone is unclaimed →
//     promote the guest row in place (preserves saves/chats/ratings)
//   - otherwise → INSERT a fresh user
// Shared by /phone-login (when OTP is off) and /otp/verify (when it's on).
function upsertPhoneAccount(req, phone) {
  const existing = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (existing) return existing;

  if (req.user) {
    const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (me?.is_guest) {
      const isSyntheticGuestName = !me.display_name
        || me.display_name === 'ضيف'
        || /^ضيف\s+\d+$/.test(me.display_name);
      const finalName = isSyntheticGuestName
        ? `مستخدم ${phone.slice(-4)}`
        : me.display_name;
      db.prepare('UPDATE users SET phone=?, is_guest=0, display_name=?, registered_at=? WHERE id=?')
        .run(phone, finalName, now(), me.id);
      return db.prepare('SELECT * FROM users WHERE id=?').get(me.id);
    }
  }

  const finalName = `مستخدم ${phone.slice(-4)}`;
  const ins = db.prepare(
    `INSERT INTO users(phone, password_hash, display_name, governorate, seller_type, created_at, registered_at)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(phone, '', finalName, 'Baghdad', 'individual', now(), now());
  return db.prepare('SELECT * FROM users WHERE id=?').get(ins.lastInsertRowid);
}

// Passwordless phone-as-username flow.
//
// Two modes, gated by the OTP_REQUIRED env flag:
//   1. flag off  → legacy trust-on-first-use: immediately upsert the account
//                  and return { token, user }.
//   2. flag on   → send a code via Twilio Verify and respond with
//                  { otp_required: true, channel }, echoing back the channel
//                  actually used. The client collects the code and POSTs it
//                  to /auth/otp/verify.
//
// Channel: WhatsApp is the default. An Iraqi SMS costs ~10× a WhatsApp
// auth message on Twilio and WhatsApp lands more reliably on this audience,
// so we only send SMS when the client explicitly asks (the OTP screen's
// "send via SMS instead" fallback) OR when a WhatsApp dispatch hard-fails,
// in which case we transparently retry over SMS so nobody is left without a
// code. The returned `channel` tells the client which one actually went out.
//
// Note: when OTP is on we do NOT upsert on this call, so a bad phone can't
// squat on a row before verification.
r.post('/phone-login', authLimiter, optionalAuth(), async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'bad_phone' });

  if (otpRequired()) {
    if (!otpConfigured()) return res.status(500).json({ error: 'otp_not_configured' });
    const requested = req.body?.channel === 'sms' ? 'sms' : 'whatsapp';
    let channel = requested;
    let send = await sendCode(phone, channel);
    // WhatsApp couldn't be dispatched (channel misconfig / provider error) —
    // fall back to SMS rather than blocking sign-in. A *silent* WhatsApp
    // non-delivery (recipient has no WhatsApp) can't be detected here since
    // Twilio returns 'pending'; that case is covered by the client's manual
    // "send via SMS instead" button.
    if (!send.ok && requested === 'whatsapp') {
      channel = 'sms';
      send = await sendCode(phone, channel);
    }
    if (!send.ok) return res.status(400).json({ error: send.error });
    return res.json({ otp_required: true, channel });
  }

  const user = upsertPhoneAccount(req, phone);
  const token = issueToken({ id: user.id });
  res.json({ token, user: publicUser(user) });
});

// Verify a Twilio-issued OTP and complete sign-in.
// Rate-limited via authLimiter — Twilio has its own per-service rate limits
// but a cheap 429 at our edge stops the loudest abusers before they hit
// the API. optionalAuth so a guest can be promoted in place on success.
r.post('/otp/verify', authLimiter, optionalAuth(), async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!phone) return res.status(400).json({ error: 'bad_phone' });
  if (!/^\d{4,10}$/.test(code)) return res.status(400).json({ error: 'bad_code' });
  if (!otpConfigured()) return res.status(500).json({ error: 'otp_not_configured' });

  const check = await checkCode(phone, code);
  if (!check.ok) return res.status(502).json({ error: check.error });
  if (!check.approved) return res.status(401).json({ error: 'bad_code' });

  const user = upsertPhoneAccount(req, phone);
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
  // Becoming a SHOP must go through the shop-registration flow (which sets
  // up the shop profile and enters review) — not a free-form profile edit.
  // Allowing seller_type='shop' here let any user self-promote and inherit
  // the shop rate-limit exemptions (unlimited listings). Downgrading a shop
  // back to individual is harmless and still allowed.
  if (seller_type === 'individual' && me.seller_type !== 'individual') {
    fields.push('seller_type=?'); params.push('individual');
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

  // Same gate as signup and POST /shops/register: becoming a shop here is a
  // first registration, so it enters review rather than going straight live.
  // Only stamp the review fields when this is genuinely a NEW shop — an
  // already-approved shop re-running profile completion must not be delisted.
  const wasShop = db.prepare('SELECT seller_type FROM users WHERE id=?')
    .get(req.user.id)?.seller_type === 'shop';
  const entersReview = sellerType === 'shop' && !wasShop;

  const setCols = [
    'display_name=?', 'seller_type=?',
    'shop_image_path=?', 'shop_lat=?', 'shop_lng=?',
    'profile_completed=1',
  ];
  const setVals = [name, sellerType, shopImagePath, shopLat, shopLng];
  if (entersReview) {
    setCols.push('shop_status=?', 'shop_origin=?',
      'shop_created_at=COALESCE(shop_created_at, ?)');
    setVals.push('pending', 'self', now());
  }
  db.prepare(`UPDATE users SET ${setCols.join(', ')} WHERE id=?`)
    .run(...setVals, req.user.id);

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

// Account deletion — required by Play Store + App Store policy. The
// user row, all their listings, chats, deals, ratings, saves,
// notifications, reports, and bypass-attempts cascade out via the
// ON DELETE CASCADE clauses in the schema. We additionally rm the
// disk files (profile pic, shop sign, listing photos) so we don't
// leave orphan media taking up space.
//
// Not reversible. The mobile UI gates this behind a destructive
// confirmation dialog.
r.delete('/me', requireAuth(), (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!me) return res.status(404).json({ error: 'not_found' });

  // Collect every file path *before* the DELETE cascade wipes the rows.
  const files = [];
  if (me.profile_image_path) files.push(path.basename(me.profile_image_path));
  if (me.shop_image_path) files.push(path.basename(me.shop_image_path));
  const listingImgs = db
    .prepare(`SELECT li.image_path FROM listing_images li
              JOIN phone_listings l ON l.id = li.listing_id
              WHERE l.seller_id = ?`)
    .all(req.user.id);
  for (const r of listingImgs) if (r.image_path) files.push(path.basename(r.image_path));

  // Cascade-delete via the user row.
  db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);

  // Best-effort disk cleanup. Failures here aren't fatal — the user
  // account is gone, orphan files just waste disk and a future
  // janitor cron can sweep them.
  for (const f of files) {
    try { fs.unlinkSync(path.join(UP, f)); } catch {}
  }

  console.log(`[auth] deleted account user=${me.id} files=${files.length}`);
  res.json({ ok: true });
});

export default r;
