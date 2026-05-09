import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import 'dotenv/config';
import { GOVERNORATES } from './governorates.js';

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
  condition TEXT NOT NULL CHECK(condition IN ('new','used','sealed','refurbished')),
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
`);

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

// idempotent column adds — reserved for future migrations
function addColumnIfMissing(table, columnDef) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`); } catch {}
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

// seed default settings
const setSetting = db.prepare('INSERT OR IGNORE INTO app_settings(key, value) VALUES(?,?)');
setSetting.run('listing_ttl_days', String(process.env.LISTING_TTL_DAYS || 30));
setSetting.run('reserve_on_confirm', '1'); // 1 = reserved, 0 = sold

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
