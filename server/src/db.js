import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import 'dotenv/config';
import { GOVERNORATES } from './governorates.js';
import { detectBrand } from './importParse.js';

const dbPath = process.env.DB_PATH || './data/iqmobile.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── schema ──────────────────────────────────────────────────────────
// One unified user model — buyer/seller is per-action, not per-account.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  governorate TEXT NOT NULL,
  city TEXT,
  profile_image_path TEXT,
  rating_avg REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  -- 'individual' = personal seller, 'shop' = a phone store / dealer.
  -- After the unified-account redesign this is no longer surfaced in the
  -- UI; we keep the column to preserve historical signal and to allow
  -- shops to opt back into a "shop badge" feature later.
  seller_type TEXT NOT NULL DEFAULT 'individual' CHECK(seller_type IN ('individual','shop')),
  shop_years INTEGER,
  -- 1 = synthetic account created via /auth/guest. We let guests browse,
  -- post listings, save, and chat freely; we'll prompt them to attach a
  -- real phone number once we make seller signup mandatory.
  is_guest INTEGER NOT NULL DEFAULT 0,
  expo_push_token TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phone_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  storage TEXT,
  color TEXT,
  -- No CHECK constraint here on purpose. Route-level validation
  -- (CONDITIONS in routes/listings.js) is the source of truth so we can
  -- add new conditions (e.g. repaired) without a migration. The original
  -- DDL had CHECK(condition IN (new,used,sealed,refurbished)) which
  -- rejected repaired until migration v2 ran -- pointlessly racy on a
  -- brand-new DB. Migration v2 below mirrors this same relaxed schema.
  condition TEXT NOT NULL,
  battery_health INTEGER,
  warranty_status TEXT,
  accessories_json TEXT NOT NULL DEFAULT '[]',
  asking_price INTEGER NOT NULL,
  governorate TEXT NOT NULL,
  city TEXT,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','reserved','sold','expired','removed')),
  -- Contact info captured at post time. Phones are public — buyers can
  -- tap-to-call, tap-to-WhatsApp (when whatsapp is set), or open the
  -- in-app chat. Each listing can have its own contact pair so a seller
  -- can route different listings to different lines.
  contact_phone TEXT,
  contact_whatsapp TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON phone_listings(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON phone_listings(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_brand ON phone_listings(brand, model);
CREATE INDEX IF NOT EXISTS idx_listings_gov ON phone_listings(governorate, status);

CREATE TABLE IF NOT EXISTS listing_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES phone_listings(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Shop "price list" images shown on the shop page (e.g. photographed price
-- tables). Owned by the shop's user row; cascade-deleted with the account.
CREATE TABLE IF NOT EXISTS shop_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_images_shop ON shop_images(shop_id, position);
CREATE INDEX IF NOT EXISTS idx_listing_images ON listing_images(listing_id, position);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES phone_listings(id) ON DELETE CASCADE,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  UNIQUE(listing_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS idx_chats_buyer ON chats(buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_seller ON chats(seller_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT,
  image_path TEXT,
  masked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON chat_messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES phone_listings(id) ON DELETE CASCADE,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  final_price INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'proposed','buyer_accepted','seller_confirmed','rejected','cancelled','expired'
  )),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_chat ON deals(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_buyer ON deals(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_seller ON deals(seller_id, status);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(deal_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_reviewed ON ratings(reviewed_user_id);

CREATE TABLE IF NOT EXISTS saved_listings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES phone_listings(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('listing','user','chat')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN (
    'fake_listing','wrong_specs','scam_attempt','inappropriate_chat','bypass_attempt','other'
  )),
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS bypass_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  matched_pattern TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bypass_user ON bypass_attempts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Brand catalog. Moved out of the hardcoded BRANDS array in
-- governorates.js so admin operators can add/rename/remove brands from
-- the dashboard without an APK rebuild. 'name' is the canonical English
-- identifier we store in phone_listings.brand; 'display_ar' is the
-- optional Arabic label the mobile UI prefers when set.
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_ar TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brands_position ON brands(position);

-- Promotional banners, dashboard-managed. Three surfaces driven by
-- (placement, brand):
--   placement='home'                   → the main feed (injected at slot 2)
--   placement='brand', brand=NULL      → shows on EVERY brand-filtered view
--   placement='brand', brand='Samsung' → shows only when that brand is filtered
-- Each banner is an uploaded image that links to either an in-app listing
-- (link_type='listing', link_value=listing id) or an external site
-- (link_type='external', link_value=https URL). The enabled column is the
-- on/off toggle; mobile only ever fetches enabled rows.
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  placement TEXT NOT NULL CHECK(placement IN ('home','brand')),
  brand TEXT,
  -- Geo target: NULL = all governorates, else a canonical English name
  -- ('Baghdad', 'Mosul', …). Lets a shop run a Baghdad banner and a
  -- separate Mosul one for the same placement.
  governorate TEXT,
  image_path TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK(link_type IN ('listing','external')),
  link_value TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_banners_lookup ON banners(placement, enabled, position);

-- Listing-import staging queue. The admin uploads a CSV of scraped FB
-- posts; each row lands here as a pending job with a best-effort parse
-- (phone/price/storage/brand). The dashboard's Import page lets an
-- operator review, edit any field inline, then Approve (creates a real
-- phone_listings row + finds-or-creates the seller user keyed on
-- contact_phone) or Reject (just marks done, no listing). Avoids the
-- previous pattern of writing one-off seed scripts per CSV and lets us
-- bring messy Facebook data into a real moderation flow.
--   raw_json:    the original CSV row, JSON-encoded — kept for audit
--   parsed_json: {phone, brand, model, storage, asking_price,
--                 governorate, city, description, display_name,
--                 image_urls[]}
--   status:      pending | approved | rejected
--   listing_id:  set on approve → links to the phone_listings row
CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  notes TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  listing_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status, created_at DESC);

-- Featured-listing payment requests. No gateway: the seller transfers airtime
-- to the owner's number and files a request here; an admin approves it from the
-- dashboard, which pins the listing (sets phone_listings.featured_until etc.).
--   tier:          'bronze' | 'silver' | 'gold' (see featureTiers.js)
--   amount/days/boosts_per_day: snapshot of the tier at request time
--   carrier:       'asiacell' | 'korek' the seller paid from
--   sender_phone:  the number they sent the airtime from (so the owner can
--                  match the incoming transfer)
--   status:        pending | approved | rejected
CREATE TABLE IF NOT EXISTS feature_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES phone_listings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  amount INTEGER NOT NULL,
  days INTEGER NOT NULL,
  boosts_per_day INTEGER NOT NULL,
  carrier TEXT NOT NULL,
  sender_phone TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_requests_user ON feature_requests(user_id, created_at DESC);

-- Analytics event log for the "Contact & Demand" dashboard. Deliberately
-- schema-light and FK-free: an event is an immutable historical fact, so it
-- must survive deletion of the listing/user it references (a contact attempt
-- on a since-removed listing is still a real data point). brand + governorate
-- are denormalized at write time so the dashboard can filter/group without a
-- join back to a row that may no longer exist.
--   type: 'view' | 'search' | 'contact_call' | 'contact_whatsapp'
--   (chat contact + sold conversions come from the chats / phone_listings
--    tables directly, so they're retroactive and need no event rows.)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  listing_id INTEGER,
  user_id INTEGER,
  brand TEXT,
  governorate TEXT,
  query TEXT,
  result_count INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_listing ON events(listing_id, type);
CREATE INDEX IF NOT EXISTS idx_events_search ON events(type, query);

-- Social publish log. One row per "Publish to FB + IG" action from the
-- dashboard, used both as an audit trail and to enforce the per-day cap
-- (count today's rows). channels holds the per-platform Buffer result JSON.
-- FK-free like events — a publish is a historical fact.
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER,
  image_path TEXT,
  caption TEXT,
  channels TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_posts_time ON social_posts(created_at DESC);
`);

// Additive column migrations — safe to run every boot (PRAGMA-guarded so
// each no-ops once applied). Used to add new nullable columns to tables
// that already exist in a deployed database. Table/column names here are
// hardcoded literals, never user input.
for (const [table, column, type] of [
  ['banners', 'governorate', 'TEXT'],
]) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`[iqmobile] migration: ${table}.${column} added`);
  }
}

// ─── migrations ──────────────────────────────────────────────────────
// Migration v2: drop the restrictive CHECK on condition so 'repaired' (and
// any future condition) is accepted. Route-level validation handles this now.
{
  const done = db.prepare("SELECT value FROM app_settings WHERE key='migration_v2_condition'").get();
  if (!done) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec('ALTER TABLE phone_listings RENAME TO _phone_listings_v1');
      db.exec(`
        CREATE TABLE phone_listings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          storage TEXT,
          color TEXT,
          condition TEXT NOT NULL,
          battery_health INTEGER,
          warranty_status TEXT,
          accessories_json TEXT NOT NULL DEFAULT '[]',
          asking_price INTEGER NOT NULL,
          governorate TEXT NOT NULL,
          city TEXT,
          description TEXT,
          status TEXT NOT NULL CHECK(status IN ('active','reserved','sold','expired','removed')),
          contact_phone TEXT,
          contact_whatsapp TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      // Explicit column list — column order in the physical file may differ
      // from the new schema if contact_phone/whatsapp were added via ALTER.
      db.exec(`
        INSERT INTO phone_listings(
          id, seller_id, brand, model, storage, color, condition,
          battery_health, warranty_status, accessories_json, asking_price,
          governorate, city, description, status,
          contact_phone, contact_whatsapp,
          created_at, expires_at, updated_at
        ) SELECT
          id, seller_id, brand, model, storage, color, condition,
          battery_health, warranty_status, accessories_json, asking_price,
          governorate, city, description, status,
          contact_phone, contact_whatsapp,
          created_at, expires_at, updated_at
        FROM _phone_listings_v1
      `);
      db.exec('DROP TABLE _phone_listings_v1');
    })();
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_listings_status ON phone_listings(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_listings_seller ON phone_listings(seller_id, status);
      CREATE INDEX IF NOT EXISTS idx_listings_brand  ON phone_listings(brand, model);
      CREATE INDEX IF NOT EXISTS idx_listings_gov    ON phone_listings(governorate, status);
    `);
    db.pragma('foreign_keys = ON');
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('migration_v2_condition','done')").run();
    console.log('[iqmobile] migration v2: condition CHECK removed');
  }
}

// Migration v3: repair foreign-key references that v2 left dangling. When
// v2 renamed phone_listings → _phone_listings_v1 (then dropped it), SQLite
// rewrote the REFERENCES clauses in dependent tables to point to the
// renamed table. After the drop those references became invalid, breaking
// any INSERT that triggers an FK check (e.g. uploading listing images).
//
// Fix: rewrite sqlite_master.sql in-place via PRAGMA writable_schema to
// flip _phone_listings_v1 back to phone_listings. This is the SQLite-
// recommended escape hatch for FK-reference repair (see sqlite.org docs
// on "Making Other Kinds Of Table Schema Changes").
{
  const done = db.prepare("SELECT value FROM app_settings WHERE key='migration_v3_fk_repair'").get();
  if (!done) {
    const broken = db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE sql LIKE '%_phone_listings_v1%'",
    ).get().n;
    if (broken > 0) {
      // better-sqlite3 wraps the C library with a "safe mode" that blocks
      // writes to sqlite_master even when writable_schema is ON. The
      // documented escape hatch is db.unsafeMode(true) — required ONLY
      // for this targeted repair, immediately revoked afterwards.
      db.unsafeMode(true);
      db.pragma('foreign_keys = OFF');
      db.pragma('writable_schema = ON');
      db.exec(
        `UPDATE sqlite_master
         SET sql = REPLACE(sql, '_phone_listings_v1', 'phone_listings')
         WHERE sql LIKE '%_phone_listings_v1%'`,
      );
      db.pragma('writable_schema = OFF');
      db.pragma('foreign_keys = ON');
      db.unsafeMode(false);
      console.log(`[iqmobile] migration v3: repaired ${broken} dangling FK references`);
    }
    db.prepare(
      "INSERT OR REPLACE INTO app_settings(key,value) VALUES('migration_v3_fk_repair','done')",
    ).run();
  }
}

// Idempotent column adds — reserved for future migrations.
//
// We swallow "duplicate column name" errors (the expected case when the
// column already exists), but log anything else loudly. The previous
// bare `catch {}` masked real failures (disk full, lock contention,
// genuinely bad SQL) and the app would boot into a half-migrated state
// where route code expecting the column crashed later with a confusing
// "no such column" instead of failing at startup.
function addColumnIfMissing(table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/duplicate column name/i.test(msg)) return; // expected, normal idempotent path
    console.error(`[db] addColumnIfMissing ${table}.(${columnDef}) failed:`, msg);
  }
}
addColumnIfMissing('users', 'profile_image_path TEXT');
addColumnIfMissing('users', 'verified INTEGER NOT NULL DEFAULT 0');
// seller_type defaults to 'individual' so existing rows don't need backfill.
addColumnIfMissing('users', "seller_type TEXT NOT NULL DEFAULT 'individual'");
addColumnIfMissing('users', 'shop_years INTEGER');
addColumnIfMissing('users', 'is_guest INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('phone_listings', 'contact_phone TEXT');
addColumnIfMissing('phone_listings', 'contact_whatsapp TEXT');
// Profile-completion flow + edit limits. profile_completed flips to 1
// when the user finishes the first-login form (name, plus shop fields if
// seller_type='shop'). After that, each tracked field can be changed
// at most twice — counters increment on each PATCH that mutates them.
addColumnIfMissing('users', 'profile_completed INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'name_edit_count INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'shop_image_path TEXT');
addColumnIfMissing('users', 'shop_image_edit_count INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'shop_lat REAL');
addColumnIfMissing('users', 'shop_lng REAL');
addColumnIfMissing('users', 'shop_location_edit_count INTEGER NOT NULL DEFAULT 0');

// One-time repair: early shop-gallery and logo writes stored a bare filename
// ("lst_x.jpg") instead of the "/uploads/<file>" path the app resolves via
// fullImageUrl(getBaseUrl()+path) — so those images 404'd to a placeholder.
// Prefix any bare path. Idempotent: guards skip already-correct and remote
// (http) values, so re-running on every boot is a no-op.
db.exec(
  `UPDATE shop_images SET image_path='/uploads/'||image_path
   WHERE image_path IS NOT NULL AND image_path NOT LIKE '/uploads/%' AND image_path NOT LIKE 'http%'`,
);
db.exec(
  `UPDATE users SET shop_image_path='/uploads/'||shop_image_path
   WHERE shop_image_path IS NOT NULL AND shop_image_path NOT LIKE '/uploads/%' AND shop_image_path NOT LIKE 'http%'`,
);

// Soft-suspension marker. Non-null = user is banned from the API
// (requireAuth() rejects them with 403 'user_suspended'). null = active.
// Toggled from the admin dashboard's Users page.
addColumnIfMissing('users', 'suspended_at INTEGER');

// ─── revenue: featured listings ──────────────────────────────────────
// A listing is "featured" while featured_until > now. It then sorts above
// non-featured listings in every view it matches, ordered by boosted_at
// (re-stamped boosts_per_day times daily by the expirer). next_boost_at +
// boost_interval_ms drive that re-stamp; feature_tier records which tier
// paid for it. All null = a normal, non-featured listing.
addColumnIfMissing('phone_listings', 'featured_until INTEGER');
addColumnIfMissing('phone_listings', 'feature_tier TEXT');
addColumnIfMissing('phone_listings', 'boosted_at INTEGER');
addColumnIfMissing('phone_listings', 'next_boost_at INTEGER');
addColumnIfMissing('phone_listings', 'boost_interval_ms INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_listings_featured ON phone_listings(featured_until)');

// ─── revenue: shops ──────────────────────────────────────────────────
// A "shop" is a user with seller_type='shop'. These columns hold the shop
// profile shown in the Shops directory + shop page. shop_featured_until > now
// pins the shop to the top of its governorate (admin-granted, free for now).
addColumnIfMissing('users', 'shop_name TEXT');
addColumnIfMissing('users', 'shop_bio TEXT');
addColumnIfMissing('users', 'shop_phone TEXT');
addColumnIfMissing('users', 'shop_whatsapp TEXT');
addColumnIfMissing('users', 'shop_address TEXT');
addColumnIfMissing('users', 'shop_featured_until INTEGER');
addColumnIfMissing('users', 'shop_created_at INTEGER');
// Extra contact channels for the shop page. shop_phones is a JSON array of
// normalized numbers (shops often have several branch lines); shop_phone
// stays the legacy primary. shop_facebook / shop_instagram hold profile URLs.
addColumnIfMissing('users', 'shop_phones TEXT');
addColumnIfMissing('users', 'shop_facebook TEXT');
addColumnIfMissing('users', 'shop_instagram TEXT');

// Seed the brands table on first boot. Mirrors the historical hardcoded
// list from governorates.js so existing listings stay valid. Skips if
// any brand row exists (so re-runs / restarts don't double-insert and
// don't fight an admin-edited table).
{
  const have = db.prepare('SELECT COUNT(*) AS n FROM brands').get().n;
  if (have === 0) {
    const ins = db.prepare(
      'INSERT INTO brands(name, display_ar, position, created_at) VALUES(?,?,?,?)',
    );
    const t = Date.now();
    const SEED = [
      'Apple', 'Samsung', 'Xiaomi', 'Realme', 'Tecno', 'Huawei',
      'OPPO', 'Vivo', 'OnePlus', 'Google', 'Nokia', 'Motorola',
      'Honor', 'Infinix', 'POCO', 'Nubia', 'Oukitel', 'Blackview', 'Other',
    ];
    db.transaction(() => {
      SEED.forEach((name, i) => ins.run(name, null, i + 1, t));
    })();
    console.log(`[db] seeded ${SEED.length} brands`);
  }
}

// Migration v4: add POCO/Nubia/Oukitel to the brand catalog + re-file any
// existing "Other" listing whose model text clearly names a real brand.
// Runs AFTER the seed block so a fresh DB seeds its full list first (and
// this then no-ops). On an existing DB the seed is skipped, so this is the
// path that adds the newer brands + backfills. Guarded by a settings flag
// so it runs exactly once. detectBrand is the same keyword matcher the CSV
// importer uses; we only reassign to a brand that actually exists in the
// catalog, so an unknown detection (or a brand we haven't added) stays
// "Other" rather than creating a dangling brand value.
{
  const done = db.prepare("SELECT value FROM app_settings WHERE key='migration_v4_brand_backfill'").get();
  if (!done) {
    const t = Date.now();
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM brands').get().m;
    const insBrand = db.prepare('INSERT OR IGNORE INTO brands(name, display_ar, position, created_at) VALUES(?,?,?,?)');
    ['Honor', 'Infinix', 'POCO', 'Nubia', 'Oukitel'].forEach((n, i) => insBrand.run(n, null, maxPos + i + 1, t));

    const valid = new Set(db.prepare('SELECT name FROM brands').all().map((r) => r.name));
    const others = db.prepare("SELECT id, model, description FROM phone_listings WHERE brand='Other'").all();
    const upd = db.prepare('UPDATE phone_listings SET brand=?, updated_at=? WHERE id=?');
    let n = 0;
    db.transaction(() => {
      for (const r of others) {
        const guess = detectBrand(`${r.model} ${r.description || ''}`, null);
        if (guess && guess !== 'Other' && valid.has(guess)) { upd.run(guess, t, r.id); n++; }
      }
    })();
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('migration_v4_brand_backfill','done')").run();
    console.log(`[iqmobile] migration v4: brand catalog topped up, backfilled ${n} 'Other' listings`);
  }
}

// Migration v5: add Blackview + re-file any "Other" listing that names it.
// Same idempotent shape as v4 — a separate flag so it runs once on existing
// DBs (fresh DBs already seed Blackview above and this no-ops).
{
  const done = db.prepare("SELECT value FROM app_settings WHERE key='migration_v5_blackview'").get();
  if (!done) {
    const t = Date.now();
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM brands').get().m;
    db.prepare('INSERT OR IGNORE INTO brands(name, display_ar, position, created_at) VALUES(?,?,?,?)')
      .run('Blackview', null, maxPos + 1, t);
    const valid = new Set(db.prepare('SELECT name FROM brands').all().map((r) => r.name));
    const others = db.prepare("SELECT id, model, description FROM phone_listings WHERE brand='Other'").all();
    const upd = db.prepare('UPDATE phone_listings SET brand=?, updated_at=? WHERE id=?');
    let n = 0;
    db.transaction(() => {
      for (const r of others) {
        const guess = detectBrand(`${r.model} ${r.description || ''}`, null);
        if (guess && guess !== 'Other' && valid.has(guess)) { upd.run(guess, t, r.id); n++; }
      }
    })();
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('migration_v5_blackview','done')").run();
    console.log(`[iqmobile] migration v5: Blackview added, backfilled ${n} 'Other' listings`);
  }
}

// seed default settings
const setSetting = db.prepare('INSERT OR IGNORE INTO app_settings(key, value) VALUES(?,?)');
setSetting.run('listing_ttl_days', String(process.env.LISTING_TTL_DAYS || 30));
setSetting.run('reserve_on_confirm', '1'); // 1 = reserved, 0 = sold
setSetting.run('shops_unlimited_listings', '1'); // 1 = shops bypass the create rate limit, 0 = shops capped like individuals
setSetting.run('listings_never_expire', '1'); // 1 = show all listings, ignore TTL; 0 = expire after listing_ttl_days

// reference: governorate list lives in code; no row needed
void GOVERNORATES;

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);
  return row?.value;
}

export function setSettingValue(key, value) {
  db.prepare(
    'INSERT INTO app_settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ).run(key, String(value));
}

export function now() {
  return Date.now();
}
