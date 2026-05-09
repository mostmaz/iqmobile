// Seed 20 demo listings per brand (Apple, Samsung, Xiaomi, Realme, Tecno).
// Safe to re-run — skips if seed user already owns listings.
// Run from the server/ directory: node scripts/seedListings.js

import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const dbPath = process.env.DB_PATH || './data/iqmobile.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── helpers ────────────────────────────────────────────────────────────
function now() { return Date.now(); }
function ts2025(month, day) {
  // Returns a ms timestamp for a day in 2025
  return new Date(2025, month - 1, day, 10, 0, 0).getTime();
}
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── demo seller ────────────────────────────────────────────────────────
const SEED_PHONE = 'seed:demo_listings';
let seller = db.prepare('SELECT * FROM users WHERE phone=?').get(SEED_PHONE);
if (!seller) {
  const id = db.prepare(
    `INSERT INTO users(phone, password_hash, display_name, governorate, seller_type, is_guest, created_at)
     VALUES(?,?,?,?,?,?,?)`
  ).run(SEED_PHONE, '', 'IQ Demo', 'Baghdad', 'individual', 0, now()).lastInsertRowid;
  seller = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  console.log('Created demo seller id', seller.id);
} else {
  console.log('Using existing demo seller id', seller.id);
}

// Check if already seeded
const existing = db.prepare('SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=?').get(seller.id).n;
if (existing >= 80) {
  console.log(`Already seeded (${existing} listings). Nothing to do.`);
  process.exit(0);
}

// ── data ───────────────────────────────────────────────────────────────
const GOVS = ['Baghdad', 'Basra', 'Erbil', 'Mosul', 'Najaf', 'Karbala', 'Kirkuk', 'Sulaymaniyah', 'Babil', 'Diyala'];
const PHONES = ['07701234567', '07811234567', '07901234567', '07751234567', '07831234567'];
const CONDITIONS = ['new', 'used', 'refurbished', 'repaired'];

// 20 listings per brand — model, storage, color, condition, price (IQD), month, day
const LISTINGS = {
  Apple: [
    ['iPhone 16', '128GB', 'أسود', 'new',        1_450_000, 1, 10],
    ['iPhone 16', '256GB', 'أبيض', 'used',       1_250_000, 2, 5],
    ['iPhone 16 Plus', '128GB', 'أزرق', 'new',   1_650_000, 1, 22],
    ['iPhone 16 Plus', '256GB', 'أسود', 'used',  1_380_000, 3, 14],
    ['iPhone 16 Pro', '128GB', 'تيتانيوم أسود', 'new',    2_100_000, 2, 18],
    ['iPhone 16 Pro', '256GB', 'تيتانيوم طبيعي', 'used',  1_850_000, 4, 3],
    ['iPhone 16 Pro', '512GB', 'تيتانيوم أبيض', 'new',    2_250_000, 1, 30],
    ['iPhone 16 Pro Max', '256GB', 'تيتانيوم أبيض', 'new', 2_600_000, 3, 7],
    ['iPhone 16 Pro Max', '512GB', 'تيتانيوم أسود', 'used', 2_300_000, 5, 20],
    ['iPhone 15', '128GB', 'أخضر', 'used',       1_050_000, 6, 11],
    ['iPhone 15', '256GB', 'أصفر', 'refurbished', 900_000, 7, 4],
    ['iPhone 15 Plus', '128GB', 'أزرق', 'used',  1_150_000, 8, 19],
    ['iPhone 15 Pro', '128GB', 'تيتانيوم أزرق', 'used', 1_500_000, 9, 2],
    ['iPhone 15 Pro', '256GB', 'تيتانيوم طبيعي', 'repaired', 1_300_000, 6, 25],
    ['iPhone 15 Pro Max', '256GB', 'تيتانيوم أسود', 'used', 1_900_000, 10, 8],
    ['iPhone 14', '128GB', 'أرجواني', 'used',    780_000, 11, 13],
    ['iPhone 14 Pro', '128GB', 'بنفسجي عميق', 'refurbished', 1_150_000, 7, 30],
    ['iPhone 14 Pro Max', '256GB', 'ذهبي', 'used', 1_480_000, 4, 16],
    ['iPhone SE 4', '128GB', 'أسود', 'new',      950_000, 2, 28],
    ['iPhone 16e', '128GB', 'أبيض', 'new',       1_100_000, 3, 21],
  ],
  Samsung: [
    ['Galaxy S25', '128GB', 'أسود', 'new',          1_350_000, 1, 15],
    ['Galaxy S25', '256GB', 'أبيض', 'used',         1_150_000, 2, 9],
    ['Galaxy S25+', '256GB', 'أزرق ثلجي', 'new',   1_700_000, 1, 28],
    ['Galaxy S25+', '512GB', 'رمادي', 'used',       1_430_000, 3, 3],
    ['Galaxy S25 Ultra', '256GB', 'تيتانيوم', 'new', 2_400_000, 2, 14],
    ['Galaxy S25 Ultra', '512GB', 'تيتانيوم أسود', 'used', 2_100_000, 4, 22],
    ['Galaxy S24', '128GB', 'زنبقي', 'used',        880_000, 5, 17],
    ['Galaxy S24', '256GB', 'أصفر', 'refurbished',  750_000, 6, 8],
    ['Galaxy S24+', '256GB', 'أرجواني', 'used',     1_100_000, 7, 1],
    ['Galaxy S24 FE', '128GB', 'أزرق', 'new',       820_000, 8, 25],
    ['Galaxy A56', '128GB', 'أخضر', 'new',          540_000, 3, 12],
    ['Galaxy A56', '256GB', 'أسود', 'used',         460_000, 9, 6],
    ['Galaxy A36', '128GB', 'أبيض', 'new',          440_000, 10, 19],
    ['Galaxy A36', '256GB', 'ذهبي وردي', 'used',   370_000, 11, 3],
    ['Galaxy A16', '128GB', 'أسود', 'new',          270_000, 4, 29],
    ['Galaxy M55', '256GB', 'أزرق عميق', 'new',    510_000, 5, 11],
    ['Galaxy Z Flip7', '256GB', 'أصفر', 'new',      1_900_000, 6, 20],
    ['Galaxy Z Fold7', '512GB', 'أسود', 'new',      3_200_000, 7, 14],
    ['Galaxy A06', '64GB', 'أخضر', 'new',           195_000, 8, 7],
    ['Galaxy S23 FE', '256GB', 'رمادي', 'refurbished', 630_000, 9, 30],
  ],
  Xiaomi: [
    ['Xiaomi 15', '256GB', 'أسود', 'new',           1_200_000, 1, 8],
    ['Xiaomi 15', '512GB', 'أبيض', 'used',          1_040_000, 2, 22],
    ['Xiaomi 15 Ultra', '512GB', 'تيتانيوم', 'new', 1_800_000, 1, 17],
    ['Xiaomi 15 Pro', '256GB', 'أسود', 'new',       1_380_000, 3, 5],
    ['Xiaomi 14T', '256GB', 'تيتانيوم أسود', 'used', 840_000, 4, 13],
    ['Xiaomi 14T Pro', '512GB', 'تيتانيوم أزرق', 'new', 1_100_000, 5, 27],
    ['Redmi Note 14', '128GB', 'أخضر عشبي', 'new', 370_000, 6, 4],
    ['Redmi Note 14', '256GB', 'أسود', 'used',      310_000, 7, 18],
    ['Redmi Note 14 Pro', '256GB', 'أرجواني', 'new', 540_000, 8, 9],
    ['Redmi Note 14 Pro+', '512GB', 'أسود', 'new',  690_000, 9, 23],
    ['Redmi Note 14 5G', '128GB', 'أخضر', 'new',   410_000, 10, 7],
    ['Redmi 14C', '128GB', 'أزرق', 'new',           240_000, 11, 15],
    ['Redmi 13', '256GB', 'أسود', 'used',           215_000, 3, 28],
    ['Poco X7', '256GB', 'أخضر معدني', 'new',      490_000, 4, 20],
    ['Poco X7 Pro', '512GB', 'أسود', 'new',         670_000, 5, 3],
    ['Poco F7', '256GB', 'أبيض', 'new',             740_000, 6, 16],
    ['Poco M7', '128GB', 'رمادي', 'new',            275_000, 7, 29],
    ['Poco C75', '128GB', 'أسود', 'new',            195_000, 8, 12],
    ['Redmi 14C 5G', '128GB', 'أزرق', 'new',       295_000, 9, 5],
    ['Redmi A4 5G', '128GB', 'أخضر', 'new',        175_000, 10, 21],
  ],
  Realme: [
    ['Realme GT 7', '256GB', 'أسود', 'new',         740_000, 1, 12],
    ['Realme GT 7 Pro', '512GB', 'تيتانيوم رمادي', 'new', 940_000, 2, 3],
    ['Realme 14 Pro', '256GB', 'أزرق جليدي', 'new', 610_000, 1, 25],
    ['Realme 14 Pro+', '512GB', 'أسود', 'new',      770_000, 3, 18],
    ['Realme 14x', '128GB', 'أخضر', 'new',          340_000, 4, 7],
    ['Realme 14', '128GB', 'أسود', 'new',           315_000, 5, 21],
    ['Realme 13 Pro', '256GB', 'أرجواني', 'used',   470_000, 6, 14],
    ['Realme 13 Pro+', '512GB', 'أسود', 'used',     565_000, 7, 8],
    ['Realme 13', '128GB', 'أخضر', 'new',           295_000, 8, 27],
    ['Realme GT Neo 7', '256GB', 'أسود', 'new',     670_000, 9, 11],
    ['Realme GT 6T', '256GB', 'أزرق', 'used',       520_000, 10, 4],
    ['Realme GT 6', '256GB', 'أسود', 'used',        470_000, 11, 19],
    ['Realme 12 Pro+', '256GB', 'أخضر مرجاني', 'used', 415_000, 3, 30],
    ['Realme 12 Pro', '256GB', 'أزرق', 'used',      355_000, 4, 16],
    ['Realme 11 Pro+', '256GB', 'رمادي', 'refurbished', 375_000, 5, 9],
    ['Realme C75', '128GB', 'أزرق', 'new',          245_000, 6, 22],
    ['Realme C75x', '128GB', 'أخضر', 'new',         225_000, 7, 5],
    ['Realme Narzo 70 Pro', '128GB', 'أزرق', 'new', 275_000, 8, 18],
    ['Realme P3 Pro', '256GB', 'أسود', 'new',       445_000, 9, 1],
    ['Realme C65 5G', '128GB', 'أخضر', 'new',       255_000, 10, 26],
  ],
  Tecno: [
    ['Tecno Phantom X3 Pro', '256GB', 'أسود', 'new',  640_000, 1, 19],
    ['Tecno Phantom X3', '256GB', 'أزرق', 'new',      490_000, 2, 11],
    ['Tecno Phantom V5 Fold', '256GB', 'أسود', 'new', 1_190_000, 1, 28],
    ['Tecno Camon 40 Pro', '256GB', 'أسود', 'new',    415_000, 3, 6],
    ['Tecno Camon 40', '128GB', 'أزرق', 'new',        315_000, 4, 24],
    ['Tecno Camon 40 Premier', '512GB', 'أسود', 'new', 540_000, 5, 17],
    ['Tecno Pova 7 Pro', '256GB', 'أخضر', 'new',      375_000, 6, 10],
    ['Tecno Pova 7', '128GB', 'أسود', 'new',          275_000, 7, 3],
    ['Tecno Spark 30 Ultra', '256GB', 'رمادي', 'new', 345_000, 8, 21],
    ['Tecno Spark 30 Pro', '256GB', 'أزرق', 'new',    295_000, 9, 14],
    ['Tecno Spark 30', '128GB', 'أخضر', 'new',        215_000, 10, 7],
    ['Tecno Spark 30C', '128GB', 'أزرق', 'new',       185_000, 11, 25],
    ['Tecno Spark GO 2025', '64GB', 'أخضر', 'new',    145_000, 3, 19],
    ['Tecno Pop 9', '128GB', 'أسود', 'new',           175_000, 4, 12],
    ['Tecno Mobile AI Pro', '512GB', 'أسود', 'new',   790_000, 5, 5],
    ['Tecno Camon 30 Pro', '256GB', 'رمادي', 'used',  315_000, 6, 28],
    ['Tecno Camon 30S', '128GB', 'أسود', 'refurbished', 245_000, 7, 16],
    ['Tecno Phantom X2 Pro', '256GB', 'أسود', 'refurbished', 395_000, 8, 9],
    ['Tecno Pova 6 Pro', '256GB', 'أزرق', 'used',     275_000, 9, 22],
    ['Tecno Phantom V Fold 2', '256GB', 'رمادي', 'new', 1_050_000, 10, 3],
  ],
};

// ── insert ──────────────────────────────────────────────────────────────
const ins = db.prepare(`
  INSERT INTO phone_listings(
    seller_id, brand, model, storage, color, condition,
    battery_health, warranty_status, accessories_json, asking_price,
    governorate, city, description, status,
    contact_phone, contact_whatsapp,
    created_at, expires_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const seedAll = db.transaction(() => {
  let count = 0;
  for (const [brand, items] of Object.entries(LISTINGS)) {
    for (const [model, storage, color, condition, price, month, day] of items) {
      const gov = rand(GOVS);
      const phone = rand(PHONES);
      const created = ts2025(month, day);
      // Give listings a 2-year TTL so they all show as active for now
      const expires = now() + 60 * 24 * 60 * 60 * 1000;
      const batteryHealth = (brand === 'Apple' && condition !== 'new')
        ? (75 + Math.floor(Math.random() * 25))
        : null;
      const acc = [];
      if (Math.random() > 0.5) acc.push('الشاحن');
      if (Math.random() > 0.7) acc.push('السماعات');
      if (Math.random() > 0.8) acc.push('العلبة الأصلية');

      ins.run(
        seller.id, brand, model, storage, color, condition,
        batteryHealth, null, JSON.stringify(acc), price,
        gov, null, null, 'active',
        phone, null,
        created, expires, created,
      );
      count++;
    }
  }
  return count;
});

const inserted = seedAll();
console.log(`Seeded ${inserted} listings across ${Object.keys(LISTINGS).length} brands.`);
