import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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
-- Daily-active users, one row per user per Baghdad day (see src/activity.js).
-- Deliberately NOT an events row per request: this table grows with
-- users×days, so a year of a few thousand users stays small, while a
-- request-level log would be millions of rows nobody queries individually.
CREATE TABLE IF NOT EXISTS user_active_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  -- Activity pings, NOT request count: the tracker writes at most once per
  -- user per 10 minutes, so this is roughly "10-minute windows in which the
  -- user was doing something", a rough session-length proxy. Reading it as
  -- requests would undercount by orders of magnitude.
  requests INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  platform TEXT,
  app_version TEXT,
  PRIMARY KEY(user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_active_days_day ON user_active_days(day);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_listing ON events(listing_id, type);
CREATE INDEX IF NOT EXISTS idx_events_search ON events(type, query);

-- Saved searches + alerts. A user stores browse criteria (brand, price
-- range, governorate, condition, free-text); when alerts_enabled they get a
-- push the moment a new listing matches. criteria_json holds the same filter
-- shape the browse endpoint accepts. last_notified_at throttles the push so
-- a broad search can't spam on a burst of new listings.
CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  criteria_json TEXT NOT NULL,
  alerts_enabled INTEGER NOT NULL DEFAULT 1,
  last_notified_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_searches_alerts ON saved_searches(alerts_enabled);

-- Price-drop watches on a specific listing. price_at_watch is the LOWEST
-- price this watcher has been told about (starts at the price when they
-- tapped watch): an alert fires only when the listing's price falls below
-- it, and the column is then updated to the new price. That makes repeat
-- drops alert once per new low, and a seller bouncing the price up and
-- down can't re-trigger the same alert.
CREATE TABLE IF NOT EXISTS price_watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES phone_listings(id) ON DELETE CASCADE,
  price_at_watch INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_price_watches_listing ON price_watches(listing_id);

-- Wish list: "I want THIS device at THIS price or less". One row per wanted
-- device (exact catalog model) with the buyer's price ceiling. Fires when a
-- matching listing appears — either newly posted, or an existing listing
-- whose price drops through the ceiling. Distinct from saved_searches:
-- a wish is a specific device + budget, not stored browse filters.
CREATE TABLE IF NOT EXISTS wishlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  max_price INTEGER NOT NULL,
  last_notified_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, brand, model)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist_items(user_id, created_at DESC);

-- AI listing inspection results (see src/listingInspect.js). One row per
-- listing — a re-inspection after new photos replaces the previous verdict,
-- hence the UNIQUE. status tracks the human decision on top of the model's:
--   pending  = flagged, waiting for an operator to look
--   approved = operator judged it fine; listing stays up
--   removed  = listing was taken down (by the operator, or auto-reject)
--   error    = the inspection call itself failed; error holds why
CREATE TABLE IF NOT EXISTS listing_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES phone_listings(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,
  confidence TEXT NOT NULL,
  defects_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(listing_id)
);
CREATE INDEX IF NOT EXISTS idx_listing_inspections_queue ON listing_inspections(status, created_at DESC);

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
  scheduled_for INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_posts_time ON social_posts(created_at DESC);

-- Structured device catalog (brand → device name), seeded from the bundled
-- GSMArena snapshot in src/data/deviceCatalog.json (2017+ devices). Powers
-- the post-listing "which device?" dropdown: the seller picks a brand, then
-- their exact device, instead of free-typing a model string that then has to
-- be parsed/normalized. Storage and RAM are deliberately NOT catalog rows —
-- they're variants of one device and stay separate form fields.
--   device_type: 'phone' | 'tablet' | 'watch', drives the app's type toggle
--   source:      'gsmarena' (seeded) | 'suggestion' (approved user request)
--   is_active:   lets an admin retire an entry without deleting history
CREATE TABLE IF NOT EXISTS device_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'phone' CHECK(device_type IN ('phone','tablet','watch')),
  model TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'gsmarena',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(brand, device_type, model)
);
CREATE INDEX IF NOT EXISTS idx_device_catalog_lookup ON device_catalog(brand, device_type, is_active);

-- "My device isn't in the list" queue. When a seller can't find their device
-- they type it manually — the listing still posts with that free-text model,
-- and a row lands here for an admin to review on the dashboard. Approving
-- copies it into device_catalog so the next seller finds it in the dropdown.
-- FK-free like the events table: a suggestion is a historical fact that
-- should outlive deletion of the user or listing that triggered it.
CREATE TABLE IF NOT EXISTS device_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  brand TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'phone' CHECK(device_type IN ('phone','tablet','watch')),
  model TEXT NOT NULL,
  listing_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  note TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_device_suggestions_status ON device_suggestions(status, created_at DESC);

-- ─── direct orders (cash on delivery) ────────────────────────────────
-- The marketplace is otherwise contact-only: a buyer rings the seller and
-- they settle it between themselves. An order-enabled shop is different —
-- the buyer checks out in-app and the shop ships to them.
--
-- Prices are SNAPSHOTTED onto order_items at checkout. A listing's
-- asking_price can change (or the listing can be deleted) long before the
-- order is delivered, and the customer owes what they were quoted, not
-- whatever the row says later. Same reason the device name is copied in:
-- an order must stay readable after its listing is gone.
--
-- Money is stored in whole IQD, matching phone_listings.asking_price. No
-- payment integration — COD only, so the total is what the courier collects.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Human-facing reference the customer quotes on the phone ("IQ-1042").
  code TEXT NOT NULL UNIQUE,
  shop_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL for a guest checkout. Orders outlive accounts, so this is
  -- deliberately not a hard requirement.
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  governorate TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT,
  subtotal INTEGER NOT NULL,
  shipping_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cod' CHECK(payment_method IN ('cod')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','confirmed','shipped','delivered','cancelled')),
  cancel_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

-- listing_id keeps NO foreign key on purpose: deleting a listing must never
-- delete or blank a historical order line. The snapshot columns below are
-- the source of truth once the order exists.
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id INTEGER,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  storage TEXT,
  color TEXT,
  image_path TEXT,
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`);

// Additive column migrations — safe to run every boot (PRAGMA-guarded so
// each no-ops once applied). Used to add new nullable columns to tables
// that already exist in a deployed database. Table/column names here are
// hardcoded literals, never user input.
for (const [table, column, type] of [
  ['banners', 'governorate', 'TEXT'],
  ['social_posts', 'scheduled_for', 'INTEGER'],
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
// Hidden shops don't appear in the public Shops directory but stay reachable
// by direct id (e.g. a promo banner deep-linking to an aggregator shop).
addColumnIfMissing('users', 'shop_hidden INTEGER NOT NULL DEFAULT 0');
// Suppresses every contact channel for a seller — the shop page's call/WhatsApp
// buttons and the phone on each of its listings. Built for the aggregator price
// shop, which republishes OTHER shops' numbers: those belong to the source
// shops, so the aggregator must not become a contact channel for them. The
// numbers stay in the DB and are only omitted from responses, so clearing the
// flag restores them. Suppressing server-side also means apps already on the
// stores stop showing the buttons without needing an update.
addColumnIfMissing('users', 'shop_no_contact INTEGER NOT NULL DEFAULT 0');
// A shop operated from someone's personal account. When set on a shop row,
// that user receives every notification addressed to the shop (chat messages
// first and foremost) and can read/reply in the shop's chats from their own
// login. Built for the aggregator price shop: its own login (a placeholder
// phone) is never signed in anywhere, so buyer messages were landing in an
// inbox nobody looked at.
addColumnIfMissing('users', 'shop_manager_id INTEGER');
// Turns a shop into an order-taking storefront: its listings get an
// add-to-cart button and the app offers COD checkout instead of "call the
// seller". Off for every existing shop, so this changes nothing until a
// shop is explicitly opted in from the dashboard.
addColumnIfMissing('users', 'shop_orders_enabled INTEGER NOT NULL DEFAULT 0');
// Flat delivery charge in IQD, added once per order regardless of basket
// size. Per-shop rather than a global setting so a second storefront can
// price delivery differently later.
addColumnIfMissing('users', 'shop_shipping_fee INTEGER NOT NULL DEFAULT 5000');

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

// "Last known price" marker for the price-aggregator shop. Set (to the ms
// timestamp it dropped off the sources' price lists) when a device is no
// longer being priced anywhere, so the app can grey the card + badge it
// "آخر سعر معروف · غير متوفر حالياً" instead of pretending it's in stock.
// null = a live, in-stock price. The expirer removes rows stale > 6 months.
addColumnIfMissing('phone_listings', 'stale_since INTEGER');

// What KIND of thing this listing is: 'phone' | 'tablet' | 'accessory'.
// NULL means phone — the marketplace is overwhelmingly phones and every row
// predating this column is one, so the default costs no backfill.
//
// It exists because the storefront sells tablets and earbuds alongside
// phones, and brand chips alone can't express that: "Honor" spans a phone, a
// tablet and five pairs of earbuds. Derived from the model name at import
// time rather than at query time, so the dashboard can correct the guesses —
// the supplier's own sheet files a Reno14F as a tablet.
addColumnIfMissing('phone_listings', 'product_type TEXT');

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

// Migration v6: add Redmi + Itel to the brand catalog. Both ship in the
// device-catalog snapshot below (Redmi alone is ~210 devices — GSMArena
// files it under Xiaomi, but Iraqi buyers shop it as its own brand), so
// without this a seller could pick a Redmi device whose brand doesn't
// exist in `brands` and the listing POST would reject it.
{
  const done = db.prepare("SELECT value FROM app_settings WHERE key='migration_v6_redmi_itel'").get();
  if (!done) {
    const t = Date.now();
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM brands').get().m;
    const ins = db.prepare('INSERT OR IGNORE INTO brands(name, display_ar, position, created_at) VALUES(?,?,?,?)');
    ['Redmi', 'Itel'].forEach((n, i) => ins.run(n, null, maxPos + i + 1, t));
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('migration_v6_redmi_itel','done')").run();
    console.log('[iqmobile] migration v6: Redmi + Itel brands added');
  }
}

// Migration v7: repair ×1000 price typos. Before the client-side price
// nudge shipped, sellers often typed prices in "thousands" (250 meaning
// 250,000 IQD), and those listings poison the price_asc sort. Multiply
// every sub-1000 price ≥ 40 by 1000 — 999 IQD is below any real device
// price, and ×1000 lands every such row in the realistic market band.
// (The one row below 40 — a placeholder price of 1 — stays untouched:
// ×1000 would still be junk and the real price is unknowable.) Two active
// flagship listings priced 1350/1365 (iPhone 16 Pro Max; market comps
// 1.3–1.45M) are repaired by explicit id, each with a < 2000 guard so
// even a re-run could never multiply them twice.
{
  const done = db.prepare("SELECT value FROM app_settings WHERE key='migration_v7_price_backfill'").get();
  if (!done) {
    let general, explicit;
    db.transaction(() => {
      general = db.prepare(
        'UPDATE phone_listings SET asking_price = asking_price*1000 WHERE asking_price >= 40 AND asking_price < 1000',
      ).run();
      explicit = db.prepare(
        'UPDATE phone_listings SET asking_price = asking_price*1000 WHERE id IN (738, 727) AND asking_price < 2000',
      ).run();
    })();
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('migration_v7_price_backfill','done')").run();
    console.log(`[iqmobile] migration v7: price ×1000 backfill — ${general.changes} sub-1000 rows + ${explicit.changes} explicit rows repaired`);
  }
}

// Seed the device catalog from the bundled GSMArena snapshot (~4k rows for
// 20 brands, 2017→present). One transaction, flag-guarded so it runs exactly
// once. INSERT OR IGNORE means a later re-seed (bump the flag key to
// device_catalog_seed_v2 when shipping a refreshed snapshot) tops up new
// devices without clobbering admin edits, deactivations, or entries that
// came from approved user suggestions.
//
// Path is resolved from import.meta.url rather than cwd — pm2/systemd can
// start us from anywhere, and the repo path contains spaces so the URL must
// go through fileURLToPath (a raw .pathname would keep the %20).
{
  const done = db.prepare("SELECT value FROM app_settings WHERE key='device_catalog_seed_v1'").get();
  if (!done) {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'deviceCatalog.json');
    if (!fs.existsSync(file)) {
      console.warn(`[iqmobile] device catalog snapshot missing at ${file} — dropdown will be empty until it ships`);
    } else {
      const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ins = db.prepare(
        `INSERT OR IGNORE INTO device_catalog(brand, device_type, model, source, created_at)
         VALUES(?,?,?,'gsmarena',?)`,
      );
      const t = Date.now();
      let n = 0;
      db.transaction(() => {
        for (const [brand, byType] of Object.entries(snapshot)) {
          for (const [type, models] of Object.entries(byType)) {
            for (const model of models) { ins.run(brand, type, model, t); n++; }
          }
        }
      })();
      db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('device_catalog_seed_v1','done')").run();
      console.log(`[iqmobile] device catalog seeded: ${n} devices across ${Object.keys(snapshot).length} brands`);
    }
  }
}

// seed default settings
const setSetting = db.prepare('INSERT OR IGNORE INTO app_settings(key, value) VALUES(?,?)');
setSetting.run('listing_ttl_days', String(process.env.LISTING_TTL_DAYS || 30));
setSetting.run('reserve_on_confirm', '1'); // 1 = reserved, 0 = sold
setSetting.run('shops_unlimited_listings', '1'); // 1 = shops bypass the create rate limit, 0 = shops capped like individuals
setSetting.run('listings_never_expire', '1'); // 1 = show all listings, ignore TTL; 0 = expire after listing_ttl_days
// AI listing inspection. Both default OFF: the feature does nothing until an
// operator turns it on in the dashboard (and it needs ANTHROPIC_API_KEY too).
// Enabling the first switch only flags listings for review; removing a listing
// automatically is a separate, deliberate second opt-in.
setSetting.run('listing_inspection_enabled', '0');
setSetting.run('listing_inspection_autoreject', '0');

// Minimum supported app version. Both default to '0' = nothing enforced, so
// shipping this changes nothing until an operator sets a floor.
//   min_supported_version — below this the app blocks with an update wall.
//     Set it only for a genuinely breaking change: it locks people out.
//   nag_below_version     — below this the app shows a dismissible prompt.
// Server-controlled so the threshold can move without another release.
setSetting.run('min_supported_version', '0');
setSetting.run('nag_below_version', '0');

// Home overlay — a dashboard-controlled interstitial shown over the listing
// feed (sponsor, promo, service notice). Off by default; everything about it
// is a setting so the copy, link and image change without a deploy.
setSetting.run('overlay_enabled', '0');
setSetting.run('overlay_title', '');
setSetting.run('overlay_body', '');
setSetting.run('overlay_image', '');
setSetting.run('overlay_cta_label', '');
setSetting.run('overlay_cta_url', '');
// Bumping this makes the overlay reappear for everyone who dismissed the
// previous one — without it, editing the copy would show a new message only
// to people who had never seen the old one.
setSetting.run('overlay_version', '1');
// 'once' = until dismissed, 'always' = every cold start. 'always' is for an
// urgent notice only; it is hostile as a permanent setting.
setSetting.run('overlay_frequency', 'once');

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
