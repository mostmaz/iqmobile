// Seed prod with the 13 real Samsung listings parsed from
// ~/Downloads/samsung_selling_posts.xlsx. Replaces the 100 GSMArena demo
// listings so the catalog reflects authentic Facebook-marketplace
// inventory (real prices, descriptions, governorates, posters).
//
// Source data is in `samsung-posts.json` (one row per listing — parsed
// offline). Images are expected at `server/scripts/samsung-images/`,
// gitignored — `scp` them onto the droplet before running this.
//
// Idempotent: every run wipes the existing seed:demo_listings rows AND
// any previous seed:samsung:* rows, then re-inserts cleanly.
//
// Run from server/ on the droplet:  node scripts/seedSamsungPosts.js

import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || './data/iqmobile.db';
const UPLOADS_DIR = path.resolve('./uploads');
const IMAGES_DIR = path.join(__dirname, 'samsung-images');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const POSTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'samsung-posts.json'), 'utf8'),
);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function now() { return Date.now(); }

// ── wipe previous seed runs ────────────────────────────────────────────
// 1) Drop the 100 GSMArena demo listings (seed:demo_listings user stays —
//    no listings means it surfaces nowhere). listing_images cascades.
// 2) Drop any prior seed:samsung:* listings + users (full re-seed).
console.log('Wiping previous seed listings…');
const demoSeller = db.prepare("SELECT id FROM users WHERE phone=?").get('seed:demo_listings');
if (demoSeller) {
  const r = db.prepare('DELETE FROM phone_listings WHERE seller_id=?').run(demoSeller.id);
  console.log(`  deleted ${r.changes} GSMArena demo listings`);
}
const oldSamsung = db.prepare("SELECT id FROM users WHERE phone LIKE 'seed:samsung:%'").all();
if (oldSamsung.length > 0) {
  const ids = oldSamsung.map((u) => u.id);
  const place = ids.map(() => '?').join(',');
  const rL = db.prepare(`DELETE FROM phone_listings WHERE seller_id IN (${place})`).run(...ids);
  const rU = db.prepare(`DELETE FROM users WHERE id IN (${place})`).run(...ids);
  console.log(`  deleted ${rL.changes} listings + ${rU.changes} previous samsung users`);
}

// ── seller upsert ──────────────────────────────────────────────────────
// Synthetic phone like `seed:samsung:ita_flippy` keeps these out of the
// real-phone namespace. display_name is the original Excel poster name.
function getOrCreateSeller(post) {
  const syntheticPhone = `seed:samsung:${post.poster_slug}`;
  let row = db.prepare('SELECT * FROM users WHERE phone=?').get(syntheticPhone);
  if (row) return row;
  const id = db.prepare(
    `INSERT INTO users(phone, password_hash, display_name, governorate, seller_type, is_guest, created_at)
     VALUES(?,?,?,?,?,?,?)`,
  ).run(
    syntheticPhone, '', post.poster_name, post.governorate, 'individual', 0, now(),
  ).lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

// ── image copy helper ──────────────────────────────────────────────────
// Looks for selling_<id>_imgN.jpg in samsung-images/, copies each to
// uploads/lst_<16hex>.<ext>, returns the array of /uploads/... paths.
function stageImages(postId) {
  const out = [];
  if (!fs.existsSync(IMAGES_DIR)) return out;
  const files = fs.readdirSync(IMAGES_DIR)
    .filter((f) => f.startsWith(`${postId}_img`))
    .sort();
  for (const f of files) {
    const ext = (path.extname(f) || '.jpg').toLowerCase();
    const safeExt = ext === '.jpeg' ? '.jpg' : ext;
    const hex = crypto.randomBytes(12).toString('hex');
    const dest = path.join(UPLOADS_DIR, `lst_${hex}${safeExt}`);
    fs.copyFileSync(path.join(IMAGES_DIR, f), dest);
    out.push(`/uploads/lst_${hex}${safeExt}`);
  }
  return out;
}

// ── insert listings ────────────────────────────────────────────────────
// 2-year TTL matches the seedListings.js fix from commit e878bb4 so these
// listings don't silently expire weeks after launch.
const TTL_MS = 730 * 24 * 60 * 60 * 1000;

const insListing = db.prepare(`
  INSERT INTO phone_listings(
    seller_id, brand, model, storage, color, condition,
    battery_health, warranty_status, accessories_json, asking_price,
    governorate, city, description, status,
    contact_phone, contact_whatsapp,
    created_at, expires_at, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const insImage = db.prepare(`
  INSERT INTO listing_images(listing_id, image_path, position, created_at)
  VALUES (?, ?, ?, ?)
`);

const stats = { listings: 0, images: 0, withPhone: 0, withoutPhone: 0 };

const seedAll = db.transaction(() => {
  // Spread created_at across a 30-day window so the browse grid (sorted
  // DESC) shows realistic recency rather than all-same-timestamp.
  const baseCreated = now();
  POSTS.forEach((post, i) => {
    const seller = getOrCreateSeller(post);
    const created = baseCreated - i * 60 * 60 * 1000; // each 1 hour older
    const expires = created + TTL_MS;
    const id = insListing.run(
      seller.id,
      post.brand,
      post.model,
      post.storage,
      post.color,
      post.condition,
      null,                    // battery_health: not provided in Excel
      null,                    // warranty_status
      '[]',                    // accessories
      post.asking_price,
      post.governorate,
      post.city,
      post.description,
      'active',
      post.contact_phone,
      post.contact_whatsapp,
      created,
      expires,
      created,
    ).lastInsertRowid;

    const imgs = stageImages(post.post_id);
    imgs.forEach((p, idx) => insImage.run(id, p, idx, created));

    stats.listings++;
    stats.images += imgs.length;
    if (post.contact_phone) stats.withPhone++;
    else stats.withoutPhone++;
    console.log(
      `  + ${post.post_id.padEnd(12)} ${post.brand.padEnd(9)} ${post.model.padEnd(30)} ` +
      `${String(post.asking_price).padStart(10)} ${imgs.length} imgs`,
    );
  });
});

console.log(`\nInserting ${POSTS.length} listings…`);
seedAll();

console.log('\nDone.');
console.table(stats);
