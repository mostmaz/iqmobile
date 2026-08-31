import { Router } from 'express';
import { scalePriceIfThousands } from '../priceScale.js';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, now, getSetting } from '../db.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { isGovernorate, normalizeGovernorate } from '../governorates.js';
import { isBrand } from '../brands.js';
import { detectBrand } from '../importParse.js';
import { checkListingQuality, reviewListingQuality } from '../listingQuality.js';
import { flagListingForReview } from '../listingFlag.js';
import { logEvent } from '../eventLog.js';
import { alertOnNewListing } from './savedSearches.js';
import { pushToAdmins } from '../adminPush.js';
import { alertWishlistOnListing } from './wishlist.js';
import { alertOnPriceChange } from './priceWatches.js';
import { inspectListingAsync } from '../listingInspect.js';
import { newPriceFor } from '../newPriceRef.js';
import { specsFor } from '../deviceSpecs.js';
import { queryTokens, arabicNormalizeSql } from '../searchNormalize.js';
import { uploadLimiter, createLimiter } from '../limits.js';

const r = Router();

const UP = path.resolve('./uploads');
fs.mkdirSync(UP, { recursive: true });

// Allowlist real photo formats only. Without this, an attacker could
// upload an SVG with `mimetype: image/jpeg` (multer trusts the client's
// declared mime) and it'd be served back as `Content-Type: image/svg+xml`
// from /uploads (express.static infers type from the .svg filename),
// triggering JS execution inside any webview that opens the URL.
// Whitelist + filename-extension rewrite kills both attack legs.
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function pickSafeExt(originalname, mimetype) {
  const ext = (path.extname(originalname || '') || '').toLowerCase();
  if (ALLOWED_IMAGE_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  // Derive from mime when the client lied about the extension.
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}

const imgStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    const ext = pickSafeExt(file.originalname, file.mimetype);
    cb(null, 'lst_' + crypto.randomBytes(12).toString('hex') + ext);
  },
});
const imgUpload = multer({
  storage: imgStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Must be an allowed photo mime AND have a recognised extension. We
    // can't fully prevent a forged mime here (the magic-byte sniff would
    // need to read the body) but combined with the rewritten extension
    // above the worst case is "we serve a JPEG named .jpg that was
    // actually a PNG" — harmless.
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) return cb(new Error('not_image'));
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    // Empty ext is OK — pickSafeExt will assign .jpg from the mime.
    if (ext && !ALLOWED_IMAGE_EXT.has(ext)) return cb(new Error('not_image'));
    cb(null, true);
  },
});

// Listing videos — same trust model as images (client mimes are hearsay,
// so extension + mime are both whitelisted and the stored name is ours),
// but bigger: the app compresses to ~720p H.264 before uploading, which
// lands most 30–60s clips between 5 and 20MB. The 50MB ceiling is the
// "client compression failed" backstop, not the expectation.
const ALLOWED_VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v']);
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v']);
const vidStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    cb(null, 'vid_' + crypto.randomBytes(12).toString('hex') + (ALLOWED_VIDEO_EXT.has(ext) ? ext : '.mp4'));
  },
});
const vidUpload = multer({
  storage: vidStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_VIDEO_MIME.has(file.mimetype)) return cb(new Error('not_video'));
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (ext && !ALLOWED_VIDEO_EXT.has(ext)) return cb(new Error('not_video'));
    cb(null, true);
  },
});

// Length caps for free-text fields. Cap is express.json({limit:'256kb'})
// at the top, but individual columns shouldn't be allowed to balloon
// inside that budget — a 200KB description blows up every browse-page
// payload and bloats the DB row forever.
const MAX_MODEL = 80;
const MAX_COLOR = 30;
const MAX_STORAGE = 16;
const MAX_CITY = 60;
const MAX_DESC = 2000;
const MAX_WARRANTY = 60;
function trim(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

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
  const byId = new Map(rows.map((r) => {
    // Raw video columns never leave through a list response: an unapproved
    // clip's path must not be discoverable. Rows keep a has_video flag for
    // the card badge; the detail endpoint alone decides who sees the file.
    const { video_path, video_status, video_uploaded_at, ...pub } = r;
    return [r.id, {
      ...pub,
      has_video: video_status === 'approved',
      images: [],
      accessories: JSON.parse(r.accessories_json || '[]'),
    }];
  }));
  for (const im of imgs) byId.get(im.listing_id)?.images.push(im);
  return Array.from(byId.values());
}

// Sellers with users.shop_no_contact — their phone/WhatsApp is omitted from
// every listing response. Read once per request-ish rather than per row: this
// is consulted on every card in a 50-item feed and changes only when an admin
// toggles the switch, so a short TTL cache beats 50 lookups a page.
let _noContactIds = null;
let _noContactAt = 0;
function noContactSellers() {
  const t = Date.now();
  if (!_noContactIds || t - _noContactAt > 30_000) {
    _noContactIds = new Set(
      db.prepare('SELECT id FROM users WHERE COALESCE(shop_no_contact,0)=1').all().map((r) => r.id),
    );
    _noContactAt = t;
  }
  return _noContactIds;
}

// Blank the contact fields on a listing row whose seller is contact-suppressed.
// The mobile app already hides the call/WhatsApp buttons when these are null
// (it skips the whole action row), so no client change is needed — including
// on builds already installed from the stores.
function stripContact(row) {
  if (!row || !noContactSellers().has(row.seller_id)) return row;
  return { ...row, contact_phone: null, contact_whatsapp: null, seller_phone: null, phone_visible: false };
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
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// How many listings a shop may post FROM THE APP in a rolling week.
// Read per-request from app_settings so it can be tuned from the dashboard
// without a deploy; 0 means unlimited, and a missing/garbage value falls
// back to the default rather than accidentally unlocking the cap.
const SHOP_WEEKLY_DEFAULT = 5;
function shopWeeklyCap() {
  const raw = getSetting('shop_weekly_listing_limit');
  if (raw == null || String(raw).trim() === '') return SHOP_WEEKLY_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : SHOP_WEEKLY_DEFAULT;
}

r.post('/', requireAuth(), createLimiter, (req, res) => {
  const {
    brand, condition, battery_health,
    accessories, asking_price,
    contact_phone, contact_whatsapp,
  } = req.body || {};

  // Per-ACCOUNT throttle: at most one new listing per hour. The IP-based
  // createLimiter above catches burst scripting, but a single spammer on
  // one account posting a listing every few minutes stays under it; this
  // closes that. Shops are exempt while shops_unlimited_listings is on
  // (default) — they post catalogues in bulk, same carve-out the IP
  // limiter uses. Returns retry_after_ms so the app can say "try again
  // in N minutes"; older builds just show the generic rate message.
  const shopsUnlimited = getSetting('shops_unlimited_listings') !== '0';
  let isShop = false;
  try {
    // Self-promotion to shop is blocked in PATCH /me (auth.js), so this flag
    // now reflects a real registered shop.
    isShop = shopsUnlimited && db.prepare('SELECT seller_type FROM users WHERE id=?').get(req.user.id)?.seller_type === 'shop';
  } catch {}
  if (!isShop) {
    const HOUR = 60 * 60 * 1000;
    const last = db.prepare(
      "SELECT created_at FROM phone_listings WHERE seller_id=? AND status != 'removed' ORDER BY created_at DESC LIMIT 1",
    ).get(req.user.id);
    if (last && Date.now() - last.created_at < HOUR) {
      return res.status(429).json({ error: 'listing_hourly_limit', retry_after_ms: HOUR - (Date.now() - last.created_at) });
    }
  } else {
    // Shops keep the exemption from the per-minute and per-hour rules — they
    // post their week's stock in one sitting, and a one-an-hour drip would
    // make that take five hours — but they are capped over the week itself.
    //
    // A ROLLING seven days, not a calendar week: a Sunday-midnight reset
    // trains everyone to dump five listings the moment it flips, which is
    // the burst the cap exists to prevent.
    //
    // This governs the APP's posting form only. The merchant panel, the
    // Excel import and admin quick-add write through their own routes and
    // are deliberately untouched — capping those would break catalogue
    // management, which is what a shop dashboard is for.
    const cap = shopWeeklyCap();
    if (cap > 0) {
      const since = Date.now() - WEEK_MS;
      const used = db.prepare(
        "SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND status != 'removed' AND created_at > ?",
      ).get(req.user.id, since).n;
      if (used >= cap) {
        // Retry when the OLDEST listing in the window ages out, which is the
        // moment a slot actually frees — not a flat seven days from now.
        const oldest = db.prepare(
          "SELECT created_at FROM phone_listings WHERE seller_id=? AND status != 'removed' AND created_at > ? ORDER BY created_at ASC LIMIT 1",
        ).get(req.user.id, since);
        return res.status(429).json({
          error: 'shop_weekly_limit',
          limit: cap,
          retry_after_ms: oldest ? Math.max(0, oldest.created_at + WEEK_MS - Date.now()) : WEEK_MS,
        });
      }
    }
  }
  // Trim every free-text field client-side data could blow up. A 1MB
  // description in a phone listing isn't a feature.
  const model = trim(req.body?.model, MAX_MODEL);
  const storage = trim(req.body?.storage, MAX_STORAGE);
  const color = trim(req.body?.color, MAX_COLOR);
  const city = trim(req.body?.city, MAX_CITY);
  const description = trim(req.body?.description, MAX_DESC);
  const warranty_status = trim(req.body?.warranty_status, MAX_WARRANTY);
  // Accept Arabic governorate names or case-insensitive English; persist
  // the canonical English form so browse + filter joins stay clean.
  const governorate = normalizeGovernorate(req.body?.governorate);
  if (!brand || !model || !condition || !asking_price || !governorate)
    return res.status(400).json({ error: 'missing_fields' });
  if (!isBrand(brand)) return res.status(400).json({ error: 'bad_brand' });
  if (!CONDITIONS.includes(condition)) return res.status(400).json({ error: 'bad_condition' });

  // Brand auto-correct. The mobile posting screen ships a hardcoded brand
  // list that lags the server catalog (no Infinix/Honor/Motorola option),
  // so sellers with those phones are forced to pick "Other". Re-run the
  // same keyword detector the CSV importer uses over the model text and
  // upgrade "Other" to the real brand when we can identify it — this fixes
  // categorisation server-side without waiting on an app update. Only
  // "Other" is touched; an explicit brand choice is always respected.
  let finalBrand = brand;
  if (brand === 'Other') {
    const guess = detectBrand(`${model} ${description || ''}`, null);
    if (guess && guess !== 'Other' && isBrand(guess)) finalBrand = guess;
  }

  // Quality gate — refuse a device that is not sellable here at all:
  // doesn't work, stolen, locked to someone else's account. Negation-aware,
  // so "بدون مشكلة" / "مو مقفول" still pass. Admin quick-add is exempt.
  if (checkListingQuality(model, description)) {
    return res.status(400).json({ error: 'listing_quality' });
  }
  // Disclosed damage is a different answer: the listing goes live and an
  // operator sees it. Held until the row exists, since the queue is keyed
  // on the listing id.
  const damage = reviewListingQuality(model, description);
  const rawPrice = Number(asking_price);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return res.status(400).json({ error: 'bad_price' });
  // "500" means 500,000 — see priceScale.js. Applied here rather than in the
  // app so it covers every write path, and because the app's own "did you
  // mean" prompt gets ignored.
  const { price, scaled: priceScaled } = scalePriceIfThousands(rawPrice, {
    name: `${finalBrand} ${model}`,
    sellerId: req.user.id,
  });
  // Marketplace floor: nothing under 100,000 IQD. Checked AFTER the
  // thousands correction — "150" means 150,000 and must not be refused.
  // The app words the refusal in two stages; this is the backstop for
  // every other write path.
  if (price < 100000) return res.status(400).json({ error: 'price_too_low' });

  // Contact phone is required so buyers always have a tap-to-call path.
  // Contact phone is optional — sellers can choose to be reachable only via
  // the in-app chat (especially for sellers who don't want to expose their
  // number publicly). When provided we still normalise + validate, but a
  // missing value is no longer a 400.
  const phone = contact_phone ? normalizeIraqiPhone(contact_phone) : null;
  if (contact_phone && !phone) return res.status(400).json({ error: 'bad_contact_phone' });
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
      req.user.id, finalBrand, model, storage || null, color || null, condition,
      // Battery: nullable. Stays null for non-Apple brands AND for Apple
      // listings where the seller left the field blank. The previous
      // `Number.isFinite(Number(battery_health))` form silently coerced
      // null/undefined/'' to 0 (since `Number(null)` is 0 and finite),
      // which caused the listing detail page to show "Battery: 0%" for
      // every non-Apple listing.
      battery_health == null || battery_health === ''
        ? null
        : Number.isFinite(Number(battery_health)) ? Number(battery_health) : null,
      warranty_status || null,
      JSON.stringify(Array.isArray(accessories) ? accessories : []),
      price, governorate, city || null, description || null,
      'active', phone, wa,
      created, expires, created,
    );
  const row = loadListing(ins.lastInsertRowid);
  // A device suggestion filed from the picker predates the listing, so it
  // was born with listing_id NULL. Now that the listing exists, claim any
  // of this seller's pending suggestions with the same model text — the
  // reviewer then sees the ad behind the name instead of a bare string.
  db.prepare(
    `UPDATE device_suggestions SET listing_id=?
      WHERE user_id=? AND listing_id IS NULL AND status='pending'
        AND model=? COLLATE NOCASE`,
  ).run(row.id, req.user.id, row.model);
  // Fire saved-search + wish-list alerts after the response is sent, so
  // notification fan-out never adds latency to (or can fail) listing creation.
  setImmediate(() => { alertOnNewListing(row); alertWishlistOnListing(row); });
  // Operators watch new listings for junk names, wrong prices and worse.
  setImmediate(() => {
    pushToAdmins(
      'listing.new',
      'إعلان جديد',
      `${row.brand} ${row.model} · ${Number(row.asking_price).toLocaleString('en-US')} د.ع · ${row.governorate}`,
      { listing_id: row.id },
    ).catch(() => {});
  });
  // Multiplying someone's price by a thousand is a big silent edit, so say
  // that it happened — in the log for us, and on the response so the app can
  // tell the seller what their listing actually went up at.
  if (priceScaled) {
    console.log(`[price-scale] listing ${row.id}: ${rawPrice} -> ${price} (${finalBrand} ${model})`);
  }
  // Disclosed damage — live, but queued. The seller is told nothing: they
  // described the phone honestly and the listing worked, which is exactly
  // the behaviour to encourage.
  if (damage) flagListingForReview(row.id, damage.defects);
  res.json({ ...attachImages([row])[0], price_corrected: priceScaled ? rawPrice : null });
});

// ─── browse listings ─────────────────────────────────────────────────
// Public — anonymous visitors can browse before they sign up. Auth only
// kicks in for save / chat / post.
// At most this many featured listings occupy the top of any view; the rest
// of the featured pool falls back to its natural recency position so the
// feed never reads as all-ads.
const FEATURED_CAP = 2;

r.get('/', optionalAuth(), (req, res) => {
  const { brand, model, governorate, condition, storage, color, verified_only, q, seller_type } = req.query;
  const minPrice = Number(req.query.min_price);
  const maxPrice = Number(req.query.max_price);
  // Pagination — defaults are tuned for the mobile browse grid: 15 per page
  // for fast initial render, infinite scroll appends more. Hard-cap at 50
  // so a misbehaving client can't exhaust the table in one shot.
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  // Rotation seed for the featured slots. The client bumps this on every
  // refresh / filter change / tab re-open (same tick that rotates banners),
  // so WHICH two featured listings hold the top slots rotates per refresh
  // while staying stable across the pages of one pagination session.
  const seed = Math.max(0, Math.floor(Number(req.query.seed) || 0));

  // Sort order. Default 'new' keeps the featured slots pinned on top (the
  // marketplace's front page). Explicit sorts (price / most-viewed) return a
  // pure ordered list with NO featured pinning — someone sorting by price
  // wants price order, not ads first. 'viewed' ranks by the view events the
  // analytics pipeline records (correlated subquery; the table is small).
  // A "call for price" listing carries asking_price=1 as a sentinel (see
  // shopAdmin.js, where a missing price becomes 1). Sorted on the raw number
  // it wins "cheapest" outright and heads the list at one dinar, so both
  // price sorts push those rows to the end first — the same rule the
  // storefront's own price sort has always used.
  const SORTS = {
    new: 'l.created_at DESC',
    price_asc: 'COALESCE(l.price_on_request,0) ASC, l.asking_price ASC, l.created_at DESC',
    price_desc: 'COALESCE(l.price_on_request,0) ASC, l.asking_price DESC, l.created_at DESC',
    viewed: "(SELECT COUNT(*) FROM events e WHERE e.listing_id=l.id AND e.type='view') DESC, l.created_at DESC",
  };
  const sort = Object.prototype.hasOwnProperty.call(SORTS, req.query.sort) ? req.query.sort : 'new';
  const orderBy = SORTS[sort];

  // Status visibility depends on the view:
  //   - default 'new' feed: active + reserved + sold + expired. Sold shows a
  //     "مباع" badge, expired a "منتهي" badge — the catalog reads as "what
  //     was for sale here" and keeps its sense of market activity.
  //   - explicit sorts (price / most-viewed): buyable inventory only. A
  //     buyer sorting by price wants phones they can actually buy, not
  //     sold/expired rows wedged between live ones.
  // 'removed' (soft-deleted) is never shown. Sellers see every status in
  // /listings/mine. "Never expire" mode (default on) ignores the TTL
  // window; toggle off from admin settings to restore the expires_at filter.
  const neverExpire = getSetting('listings_never_expire') !== '0';
  // available_only: the buyer's opt-out of the sold/expired rows the default
  // feed carries for market context. My Listings has always had status chips
  // for sellers; buyers had no equivalent, so a shopper who only wants things
  // they can actually buy had to read every badge themselves.
  const availableOnly = String(req.query.available_only || '') === '1';
  // How far back a sorted view reaches. Sorting by price over the whole
  // catalogue put month-old listings at the top of "cheapest first" — the
  // oldest stock wins that race, because anything cheap and still listed
  // after a month is usually stale. The home feed sends 10; search does
  // not, because someone hunting one model wants every one of them.
  const maxAgeDays = Number(req.query.max_age_days);
  const ageCutoff = Number.isFinite(maxAgeDays) && maxAgeDays > 0 && maxAgeDays <= 365
    ? Date.now() - Math.floor(maxAgeDays) * 86400000
    : null;
  let where = (sort === 'new' && !availableOnly)
    ? `l.status IN ('active','reserved','sold','expired')`
    : `l.status IN ('active','reserved')`;
  const params = [];
  if (ageCutoff) { where += ' AND l.created_at >= ?'; params.push(ageCutoff); }
  if (!neverExpire) {
    where += ' AND l.expires_at > ?';
    params.push(Date.now());
  }
  if (brand && isBrand(String(brand))) { where += ' AND l.brand=?'; params.push(brand); }
  if (model) { where += ' AND l.model LIKE ?'; params.push('%' + String(model) + '%'); }
  if (governorate && isGovernorate(String(governorate))) { where += ' AND l.governorate=?'; params.push(governorate); }
  if (condition && CONDITIONS.includes(String(condition))) { where += ' AND l.condition=?'; params.push(condition); }
  if (storage) { where += ' AND l.storage=?'; params.push(storage); }
  if (color) { where += ' AND l.color=?'; params.push(color); }
  if (Number.isFinite(minPrice)) { where += ' AND l.asking_price >= ?'; params.push(minPrice); }
  if (Number.isFinite(maxPrice)) { where += ' AND l.asking_price <= ?'; params.push(maxPrice); }
  if (verified_only === '1' || verified_only === 'true') { where += ' AND u.verified=1'; }
  if (seller_type === 'individual' || seller_type === 'shop') {
    where += ' AND u.seller_type=?'; params.push(seller_type);
  } else if (!q) {
    // Default home/browse feed. Shops DO belong here — their stock is real
    // inventory a buyer wants to see. What must stay out is a hidden shop:
    // the aggregator price shop is a catalogue of other shops' lowest prices,
    // reachable on purpose only through its banner, and its 143 rows would
    // bury every individual seller in the feed.
    //
    // Keyed off shop_hidden rather than a hardcoded id, so the existing
    // dashboard checkbox controls feed presence too, and the rule reads the
    // same as the Shops directory's.
    where += ' AND COALESCE(u.shop_hidden,0) = 0';
  }
  if (q) {
    // Smart search. queryTokens() turns the query into normalized tokens —
    // Arabic is transliterated to the Latin catalog ("سامسونج"→samsung,
    // "اس ٢٣"→"s23") and genuine Arabic description words are kept in their
    // normalized form. A listing matches when EVERY token appears in its
    // combined brand+model+description text, so "سامسونج الترا" finds
    // "Samsung S23 Ultra" even though the words aren't adjacent, and
    // "ايفون كفاله" requires both. The haystack is normalized the SAME way
    // as the query (arabicNormalizeSql: digit-fold, orthography-collapse,
    // space-strip) so Arabic descriptions and "s23"↔"S 23" both line up.
    // LIKE on an expression skips indexes, but the table is small.
    const HAYSTACK = arabicNormalizeSql(
      "l.brand || ' ' || l.model || ' ' || COALESCE(l.description,'')",
    );
    const tokens = queryTokens(String(q));
    if (tokens.length) {
      where += ' AND (' + tokens.map(() => `${HAYSTACK} LIKE ?`).join(' AND ') + ')';
      for (const t of tokens) params.push('%' + t + '%');
    }
  }

  const nowTs = Date.now();

  // Featured slots: collect every currently-featured listing matching the
  // same filters (ordered by most recent boost), then rotate the window of
  // FEATURED_CAP ids by the seed. The chosen ids render at the very top of
  // page 1; the rest of the pool stays in the regular recency stream below,
  // so capped-out featured listings are demoted — never hidden.
  const pool = db.prepare(
    `SELECT l.id FROM phone_listings l
     JOIN users u ON u.id = l.seller_id
     WHERE ${where} AND l.featured_until > ?
     ORDER BY l.boosted_at DESC, l.id DESC`,
  ).all(...params, nowTs);
  const chosen = [];
  // Featured slots only apply to the default 'new' sort — an explicit
  // price/most-viewed sort is a pure ordered list.
  if (sort === 'new' && pool.length > 0) {
    const start = seed % pool.length;
    for (let i = 0; i < Math.min(FEATURED_CAP, pool.length); i++) {
      chosen.push(pool[(start + i) % pool.length].id);
    }
  }

  // Regular stream: recency order, minus the listings already shown in the
  // featured slots. Offsets shift by chosen.length because page 1 spent that
  // many of its `limit` rows on the featured slots — `chosen` is recomputed
  // identically on every page of a session (same filters + same seed), so
  // pagination stays consistent.
  const exclude = chosen.length ? ` AND l.id NOT IN (${chosen.map(() => '?').join(',')})` : '';
  const regularSql = `
    SELECT l.* FROM phone_listings l
    JOIN users u ON u.id = l.seller_id
    WHERE ${where}${exclude}
    ORDER BY (l.stale_since IS NOT NULL) ASC, ${orderBy} LIMIT ? OFFSET ?`;

  let rows;
  if (offset === 0) {
    rows = [];
    if (chosen.length > 0) {
      const ph = chosen.map(() => '?').join(',');
      const featRows = db.prepare(`SELECT * FROM phone_listings WHERE id IN (${ph})`).all(...chosen);
      const byId = new Map(featRows.map((r2) => [r2.id, r2]));
      rows.push(...chosen.map((id) => byId.get(id)).filter(Boolean));
    }
    const fill = limit - rows.length;
    if (fill > 0) rows.push(...db.prepare(regularSql).all(...params, ...chosen, fill, 0));
  } else {
    rows = db.prepare(regularSql).all(...params, ...chosen, limit, Math.max(0, offset - chosen.length));
  }

  const withImgs = attachImages(rows);
  // attach a thin seller card + a computed featured flag (so the card can
  // show a "مميز" badge without trusting the client clock).
  const out = withImgs.map((row) => ({
    ...stripContact(row),
    is_featured: !!(row.featured_until && row.featured_until > nowTs),
    seller: sellerCard(row.seller_id),
  }));

  // Log the search for the demand dashboard. Only on the FIRST page of an
  // actual text search (q present, offset 0) — that's one row per query the
  // user submits, not per pagination scroll. We record the total match count
  // (separate COUNT over the same filter, not the paginated page size) so the
  // dashboard can surface zero-result searches — real demand with no supply.
  if (q && String(q).trim() && offset === 0) {
    let resultCount = 0;
    try {
      resultCount = db.prepare(
        `SELECT COUNT(*) AS n FROM phone_listings l JOIN users u ON u.id = l.seller_id WHERE ${where}`,
      ).get(...params).n;
    } catch { /* count is best-effort; fall back to 0 */ }
    logEvent({
      type: 'search',
      query: String(q).trim().slice(0, 100),
      result_count: resultCount,
      brand: brand && isBrand(String(brand)) ? String(brand) : null,
      governorate: governorate && isGovernorate(String(governorate)) ? String(governorate) : null,
      user_id: req.user?.id ?? null,
    });
  }

  res.json(out);
});

// ─── my listings (seller dashboard) ──────────────────────────────────
// Each row carries its own engagement counts (views / calls+whatsapp /
// saves) so a seller sees which listings pull interest and which are dead —
// the nudge to drop a price. Counts come from the same events table the
// demand dashboard reads; saves from saved_listings. All scoped to this
// seller's own listings, so there's no cross-user leak.
r.get('/mine', requireAuth(), (req, res) => {
  const status = req.query.status || 'all';
  let rows;
  if (status === 'all') {
    rows = db.prepare("SELECT * FROM phone_listings WHERE seller_id=? AND status != 'removed' ORDER BY created_at DESC").all(req.user.id);
  } else {
    rows = db.prepare('SELECT * FROM phone_listings WHERE seller_id=? AND status=? ORDER BY created_at DESC').all(req.user.id, status);
  }
  const withImgs = attachImages(rows);
  if (withImgs.length) {
    const ids = withImgs.map((r2) => r2.id);
    const ph = ids.map(() => '?').join(',');
    const ev = new Map();
    for (const e of db.prepare(
      `SELECT listing_id,
              SUM(CASE WHEN type='view' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN type IN ('contact_call','contact_whatsapp') THEN 1 ELSE 0 END) AS contacts
         FROM events WHERE listing_id IN (${ph}) GROUP BY listing_id`,
    ).all(...ids)) ev.set(e.listing_id, e);
    const sv = new Map();
    for (const e of db.prepare(
      `SELECT listing_id, COUNT(*) AS saves FROM saved_listings WHERE listing_id IN (${ph}) GROUP BY listing_id`,
    ).all(...ids)) sv.set(e.listing_id, e.saves);
    for (const r2 of withImgs) {
      r2.stats = {
        views: ev.get(r2.id)?.views || 0,
        contacts: ev.get(r2.id)?.contacts || 0,
        saves: sv.get(r2.id) || 0,
      };
    }
  }
  res.json(withImgs);
});

// ─── listing detail ──────────────────────────────────────────────────
// Public — anonymous visitors see the same listing data, with phone hidden
// (no logged-in user means they can't have a confirmed deal).
// ─── compare ────────────────────────────────────────────────────────
// Two or three listings side by side, with the spec sheet behind each.
//
// One request rather than one per listing: the client is about to render
// them in a single table, and three round trips to build one screen is
// three chances for it to render half-empty.
//
// Deliberately NOT a "which is better" score. The listings differ on axes
// that trade against each other — a cheaper phone with a smaller battery,
// a newer chipset at a worse price — and ranking them would be inventing a
// preference the buyer has not stated. The client marks which rows DIFFER;
// the buyer decides what that is worth.
r.get('/compare', optionalAuth(), (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 4);
  if (ids.length < 2) return res.status(400).json({ error: 'need_two_ids' });

  const ph = ids.map(() => '?').join(',');
  // The same visibility rule the detail route applies. Ids arrive from the
  // query string, so without it anyone could read a soft-deleted listing —
  // or a shop's unpublished draft, which rides status='removed' + is_draft=1
  // precisely so that every public query already excludes it. A row that
  // fails this is simply absent; the compare screen prunes what it asked
  // for and didn't get.
  const rows = db.prepare(`
    SELECT l.id, l.brand, l.model, l.storage, l.color, l.condition, l.battery_health,
           l.asking_price, l.price_on_request, l.governorate, l.city, l.status,
           l.created_at, l.seller_id,
           (SELECT i.image_path FROM listing_images i
             WHERE i.listing_id = l.id ORDER BY i.position, i.id LIMIT 1) AS image_path,
           u.display_name AS seller_name, u.shop_name, u.seller_type, u.verified
      FROM phone_listings l
      JOIN users u ON u.id = l.seller_id
     WHERE l.id IN (${ph})
       AND l.status != 'removed' AND COALESCE(l.is_draft,0) = 0
  `).all(...ids);

  // Preserve the order the buyer picked them in — the table's columns are
  // their columns, not the database's.
  const byId = new Map(rows.map((x) => [x.id, x]));
  const items = ids.map((id) => byId.get(id)).filter(Boolean).map((l) => ({
    ...l,
    shop_name: l.shop_name || null,
    seller_name: l.shop_name || l.seller_name,
    specs: specsFor(l.brand, l.model),
  }));

  res.json({ items });
});

r.get('/:id(\\d+)', optionalAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row || row.status === 'removed') return res.status(404).json({ error: 'not_found' });

  // Log the view for the demand dashboard — but not when the seller opens
  // their own listing (they check it constantly; counting that would drown
  // out real buyer interest). Best-effort; never blocks the response.
  if (!req.user || req.user.id !== row.seller_id) {
    logEvent({
      type: 'view', listing_id: row.id, user_id: req.user?.id ?? null,
      brand: row.brand, governorate: row.governorate,
    });
  }

  const [withImgs] = attachImages([row]);
  const seller = sellerCard(row.seller_id);

  // Whether THIS caller has saved THIS listing — drives the bookmark
  // icon's filled/empty state and the "احفظ"/"محفوظ" button label on
  // the detail screen. Always false for guests (they have no saves).
  let is_saved = false;
  // Whether THIS caller has a price-drop watch on THIS listing — drives the
  // "نبّهني إذا انخفض السعر" toggle on the detail screen.
  let is_price_watched = false;
  if (req.user) {
    is_saved = !!db
      .prepare('SELECT 1 FROM saved_listings WHERE user_id=? AND listing_id=?')
      .get(req.user.id, row.id);
    is_price_watched = !!db
      .prepare('SELECT 1 FROM price_watches WHERE user_id=? AND listing_id=?')
      .get(req.user.id, row.id);
  }

  // Listing-level contact info is public (no deal-confirmation gate). The
  // legacy `seller_phone` / `phone_visible` fields are preserved for old
  // mobile builds — they now point to the listing's own contact_phone.
  // Hide the seller's direct contact (phone + WhatsApp) on SOLD listings
  // from everyone but the owner — buyers shouldn't call/message about an
  // item that's already gone (in-app chat stays available). The DB values
  // are untouched; we only omit them from the response, so restoring the
  // listing to active brings them back, and the owner still sees them for
  // their own management/edit.
  // Reasons to withhold contact: the listing is finished (sold OR expired),
  // or the seller is contact-suppressed outright (shop_no_contact). The owner
  // still sees their own number, but suppression is absolute — it exists to
  // protect numbers that aren't the seller's to publish.
  //
  // 'expired' was missing here, so a two-month-dead listing rendered with
  // call, WhatsApp and chat all live and no warning. The feed still shows
  // expired listings (they're useful as a price record), which made that a
  // steady trickle of calls to sellers about phones long since gone.
  const DEAD = new Set(['sold', 'expired']);
  const isDead = DEAD.has(row.status);
  const hideContact = (isDead && (!req.user || req.user.id !== row.seller_id))
    || noContactSellers().has(row.seller_id);

  // Storefront listings answer on ONE support line instead of per-listing
  // seller contact, and take orders through the cart rather than chat.
  //
  // This deliberately survives shop_no_contact. That flag exists to stop the
  // price aggregator republishing OTHER shops' numbers — numbers that aren't
  // its to publish. A storefront's own support line is the opposite case: it
  // is exactly the number it wants customers to ring.
  const storefrontShop = db.prepare(
    `SELECT shop_phone, phone FROM users
      WHERE id=? AND seller_type='shop' AND COALESCE(shop_orders_enabled,0)=1`,
  ).get(row.seller_id);

  // "Talk to the shop" on price-book listings. The aggregator's rows are
  // no-contact by design — the numbers on them belong to OTHER shops — so
  // buyers looking at a new-device price had nobody to ask. But when the
  // SAME device sits in the storefront's own inventory, there is a real
  // seller with a real support line one query away. Attach the storefront's
  // matching listing so the app can offer a chat that lands on an account
  // someone actually answers. Cheapest variant wins so the chat opens on
  // the price the buyer would actually pay.
  let storeChat = null;
  if (!storefrontShop && noContactSellers().has(row.seller_id)) {
    const store = db.prepare(
      `SELECT id, shop_name, display_name FROM users
        WHERE seller_type='shop' AND COALESCE(shop_orders_enabled,0)=1
        ORDER BY id ASC LIMIT 1`,
    ).get();
    if (store && store.id !== row.seller_id) {
      // Brand equality, with two deliberate loosenings. "Other" is a
      // catch-all bucket, not a manufacturer — [Other] "Smart 20" and
      // [Infinix] "Smart 20" are the same phone filed by two different
      // people, and 12 live price rows were missing their store match for
      // exactly that. And POCO/Redmi are Xiaomi lines the data files under
      // either name; when the model text matches exactly, a family-level
      // brand disagreement is filing noise, not a different device.
      const match = db.prepare(
        `SELECT id, brand FROM phone_listings
          WHERE seller_id=? AND status='active' AND COALESCE(stock_qty,1) > 0
            AND LOWER(TRIM(model))=LOWER(TRIM(?))
            AND (brand=? OR brand='Other' OR ?='Other'
                 OR (brand IN ('Xiaomi','POCO','Redmi') AND ? IN ('Xiaomi','POCO','Redmi')))
          ORDER BY asking_price ASC LIMIT 1`,
      ).get(store.id, row.model, row.brand, row.brand, row.brand);
      if (match) {
        storeChat = {
          listing_id: match.id,
          shop_id: store.id,
          shop_name: store.shop_name || store.display_name,
        };
      }
    }
  }

  // Review-gated video. An approved clip is public; a pending or rejected
  // one exists only for its owner (with its status, so the app can show
  // the "awaiting approval" notice). Everyone else gets null — and the raw
  // columns are stripped below so the SELECT * spread can't leak the path.
  const isOwner = !!req.user && req.user.id === row.seller_id;
  const video = row.video_path && (row.video_status === 'approved' || isOwner)
    ? { path: row.video_path, status: row.video_status }
    : null;
  res.json({
    ...withImgs,
    video,
    orders_enabled: !!storefrontShop,
    store_chat: storeChat,
    // Falls back to null (not the login phone) when no support line is set:
    // the shop's account phone is a placeholder nobody answers.
    storefront_phone: storefrontShop ? (storefrontShop.shop_phone || null) : null,
    // Price-book rows have no one behind them. The numbers are already
    // blanked; this says so explicitly so the app drops the whole contact
    // row instead of leaving a lone chat button pointed at an account that
    // answers nobody. `store_chat` above is the one contact that works.
    contact_suppressed: noContactSellers().has(row.seller_id),
    contact_phone: hideContact ? null : withImgs.contact_phone,
    contact_whatsapp: hideContact ? null : withImgs.contact_whatsapp,
    seller,
    seller_phone: hideContact ? null : (row.contact_phone || null),
    phone_visible: hideContact ? false : !!row.contact_phone,
    is_saved,
    is_price_watched,
    // What this device costs new, when the price shop stocks the same model
    // at the same capacity. Null unless the match is confident — see
    // newPriceRef.js for why every ambiguity resolves to showing nothing.
    new_price_ref: newPriceFor(row),
    // Display size, chipset, RAM, battery, charge speed and cameras for the
    // device this listing is of. Null when nobody has mapped the model yet —
    // the app renders nothing rather than a half-empty table.
    specs: specsFor(row.brand, row.model),
  });
});

// ─── contact tap (call / WhatsApp) ───────────────────────────────────
// The Call and WhatsApp buttons open an external app (tel: / wa.me), so
// the tap is the only signal the server can ever get — the mobile client
// POSTs here right before deep-linking out. Chat contact is NOT recorded
// here: starting a chat inserts a row into `chats`, which the dashboard
// reads directly (and retroactively). optionalAuth so a guest tapping
// "call" is still counted. Best-effort logging; a bad body just 400s.
r.post('/:id(\\d+)/contact', optionalAuth(), (req, res) => {
  const raw = req.body?.channel;
  const channel = raw === 'whatsapp' ? 'whatsapp' : raw === 'call' ? 'call' : null;
  if (!channel) return res.status(400).json({ error: 'bad_channel' });
  const row = db.prepare('SELECT id, seller_id, brand, governorate FROM phone_listings WHERE id=?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  // Don't count a seller tapping the buttons on their own listing.
  if (!req.user || req.user.id !== row.seller_id) {
    logEvent({
      type: channel === 'whatsapp' ? 'contact_whatsapp' : 'contact_call',
      listing_id: row.id, user_id: req.user?.id ?? null,
      brand: row.brand, governorate: row.governorate,
    });
  }
  res.json({ ok: true });
});

// ─── similar listings ────────────────────────────────────────────────
// Shown on the detail page: other AVAILABLE listings of the SAME brand
// priced within ±10% of this one, nearest price first. Cross-seller on
// purpose — the buyer sees the real market for that phone, not just this
// seller's stock. Excludes the listing itself and anything not 'active'
// (a sold/reserved alternative isn't a useful suggestion).
r.get('/:id(\\d+)/similar', optionalAuth(), (req, res) => {
  const row = db.prepare('SELECT id, brand, asking_price FROM phone_listings WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const lo = Math.floor(row.asking_price * 0.9);
  const hi = Math.ceil(row.asking_price * 1.1);
  const rows = db.prepare(
    `SELECT l.* FROM phone_listings l
     WHERE l.brand = ? AND l.id != ? AND l.status = 'active'
       AND l.asking_price BETWEEN ? AND ?
     ORDER BY ABS(l.asking_price - ?) ASC, l.created_at DESC
     LIMIT 12`,
  ).all(row.brand, row.id, lo, hi, row.asking_price);
  // Same shaping rules as the feed: suppressed sellers' numbers stay
  // suppressed here too — this endpoint used to skip stripContact, which
  // quietly republished no-contact numbers on every detail page's rail.
  const out = attachImages(rows).map((r2) => ({
    ...stripContact(r2),
    seller: sellerCard(r2.seller_id),
  }));
  res.json(out);
});

// ─── update listing ──────────────────────────────────────────────────
const EDITABLE = ['storage','color','battery_health','warranty_status','asking_price','description','city','status'];

// Per-field max-length cap on PATCH. POST already has these via trim();
// without the matching guard on PATCH, a seller could edit the listing
// post-creation to a 1MB description and bloat every browse payload
// forever. Keep the keys consistent with the constants up top.
const EDIT_CAPS = {
  storage: MAX_STORAGE,
  color: MAX_COLOR,
  warranty_status: MAX_WARRANTY,
  description: MAX_DESC,
  city: MAX_CITY,
};

r.patch('/:id(\\d+)', requireAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });

  // The same gate the create path applies, against the text as it will read
  // AFTER this edit. Without it the gate was a one-time check at birth: post
  // something clean, then edit the description to say anything. That is not
  // hypothetical — a listing whose description reads "مقفول ايكلود" was live
  // on production, posted three weeks AFTER the gate shipped, and the gate
  // rejects that exact text. The only way in was an edit.
  const nextModel = req.body.model !== undefined ? req.body.model : row.model;
  const nextDesc = req.body.description !== undefined ? req.body.description : row.description;
  const textChanged = req.body.model !== undefined || req.body.description !== undefined;
  if (textChanged && checkListingQuality(nextModel, nextDesc)) {
    return res.status(400).json({ error: 'listing_quality' });
  }

  const fields = [];
  const params = [];
  for (const k of EDITABLE) {
    if (req.body[k] === undefined) continue;
    if (k === 'status' && !['active','reserved','sold','removed'].includes(req.body.status))
      return res.status(400).json({ error: 'bad_status' });
    if (k === 'asking_price') {
      const n = Number(req.body.asking_price);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'bad_price' });
      // Same correction on edit — otherwise a seller "fixes" a scaled price
      // back down to 500 and the listing is broken again.
      const { price: fixed } = scalePriceIfThousands(n, {
        productType: row.product_type,
        name: `${row.brand} ${row.model}`,
        priceOnRequest: !!row.price_on_request,
        sellerId: row.seller_id,
      });
      if (!row.price_on_request && fixed < 100000) {
        return res.status(400).json({ error: 'price_too_low' });
      }
      fields.push('asking_price=?'); params.push(fixed); continue;
    }
    fields.push(`${k}=?`);
    // Apply length cap when this field has one. trim() also nulls out
    // empty strings — matches the POST path so PATCH doesn't accept
    // values POST would have rejected.
    const cap = EDIT_CAPS[k];
    const value = cap ? trim(req.body[k], cap) : req.body[k];
    params.push(value);
  }
  if (Array.isArray(req.body.accessories)) {
    fields.push('accessories_json=?');
    params.push(JSON.stringify(req.body.accessories));
  }
  if (fields.length === 0) return res.json(attachImages([row])[0]);
  // Stamp the moment of sale. Without this, "sold" is only a current-state
  // flag and no report can ask how many sold in a window — which is exactly
  // how the analytics sold KPI ended up showing the all-time total for
  // every period. Re-listing clears it so a revived listing isn't counted
  // as a sale that never un-happened.
  if (req.body.status !== undefined && req.body.status !== row.status) {
    if (req.body.status === 'sold') { fields.push('sold_at=?'); params.push(now()); }
    else if (row.status === 'sold') { fields.push('sold_at=?'); params.push(null); }
  }
  fields.push('updated_at=?');
  params.push(now(), req.params.id);
  db.prepare(`UPDATE phone_listings SET ${fields.join(', ')} WHERE id=?`).run(...params);
  const updatedRow = loadListing(req.params.id);
  // Price went down? Tell listing watchers + saved searches + wish lists.
  // Post-response so alert fan-out can't slow or fail the edit itself.
  if (updatedRow.asking_price < row.asking_price) {
    setImmediate(() => alertOnPriceChange(updatedRow, row.asking_price));
  }
  // Damage added by an edit reaches the queue the same way it would have at
  // creation. Re-checked on every text edit rather than once, because a
  // description that changes after an operator approved it is new
  // information — flagListingForReview decides whether that reopens the row.
  if (textChanged) {
    const damage = reviewListingQuality(updatedRow.model, updatedRow.description);
    if (damage) flagListingForReview(updatedRow.id, damage.defects);
  }
  res.json(attachImages([updatedRow])[0]);
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
r.post('/:id(\\d+)/images', requireAuth(), uploadLimiter, imgUpload.array('images', MAX_IMAGES), (req, res) => {
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
  const insWithHash = db.prepare('INSERT INTO listing_images(listing_id, image_path, position, created_at, image_hash) VALUES(?,?,?,?,?)');
  let pos = existing;
  const out = [];
  for (const f of files) {
    if (f.size <= 0) { try { fs.unlinkSync(f.path); } catch {} continue; }
    const p = `/uploads/${f.filename}`;
    // Hash the bytes for stolen-photo detection. Best-effort — a hash
    // failure must never break the upload, so it degrades to null.
    let hash = null;
    try { hash = crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex'); } catch {}
    const id = insWithHash.run(row.id, p, pos++, t, hash).lastInsertRowid;
    out.push({ id, listing_id: row.id, image_path: p, position: pos - 1 });
  }
  db.prepare('UPDATE phone_listings SET updated_at=? WHERE id=?').run(t, row.id);
  // AI defect check, after the response so the seller's upload is never
  // slowed or broken by it. No-op unless enabled + an API key is configured.
  setImmediate(() => inspectListingAsync(row.id));
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

// ─── listing video (optional, one, review-gated) ─────────────────────
// The upload succeeds instantly for the seller but the clip stays private
// until an operator approves it — the wizard shows that notice up front.
// Re-uploading replaces the old clip and re-enters review.
r.post('/:id(\\d+)/video', requireAuth(), uploadLimiter, vidUpload.single('video'), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) { if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} } return res.status(404).json({ error: 'not_found' }); }
  if (row.seller_id !== req.user.id) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch {} }
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!req.file || req.file.size <= 0) return res.status(400).json({ error: 'no_file' });

  // Replace, not accumulate — one video per listing keeps review humane.
  if (row.video_path) { try { fs.unlinkSync(path.join(UP, path.basename(row.video_path))); } catch {} }
  const p = `/uploads/${req.file.filename}`;
  const t = now();
  db.prepare("UPDATE phone_listings SET video_path=?, video_status='pending', video_uploaded_at=?, updated_at=? WHERE id=?")
    .run(p, t, t, row.id);
  // Operators review from the dashboard queue; the push is the doorbell.
  pushToAdmins(
    'video.new',
    'فيديو بانتظار الموافقة',
    `${row.brand} ${row.model} · إعلان #${row.id}`,
    { listing_id: row.id },
  ).catch(() => {});
  res.json({ ok: true, video: { path: p, status: 'pending' } });
});

r.delete('/:id(\\d+)/video', requireAuth(), (req, res) => {
  const row = loadListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.seller_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (row.video_path) { try { fs.unlinkSync(path.join(UP, path.basename(row.video_path))); } catch {} }
  db.prepare('UPDATE phone_listings SET video_path=NULL, video_status=NULL, video_uploaded_at=NULL, updated_at=? WHERE id=?')
    .run(now(), row.id);
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
  res.json(withImgs.map((r) => ({ ...stripContact(r), seller: sellerCard(r.seller_id) })));
});

export default r;
