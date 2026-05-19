// Attach demo images to seeded listings.
//
// Source: GSMArena product photos at
//   https://fdn2.gsmarena.com/vv/pics/<brand>/<slug>-<N>.jpg
// Per model we try -1.jpg through -5.jpg and stop at the first 404.
//
// The brand pools below are the slugs we verified by hand. We don't try
// to match each Iraqi listing 1:1 to its exact GSMArena slug — instead
// each (Apple/Samsung/Xiaomi/Realme/Tecno) listing draws 3..5 random
// images from that brand's pool, seeded by listing.id so reruns are
// deterministic.
//
// Run from server/ on the droplet:  node scripts/seedListingImages.js

import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';

// ── config ──────────────────────────────────────────────────────────────
const dbPath = process.env.DB_PATH || './data/iqmobile.db';
const UPLOADS_DIR = path.resolve('./uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Slugs verified via direct GET against fdn2.gsmarena.com/vv/pics/<brand>/<slug>-1.jpg
// (See `node scripts/verifySlugs.mjs` — kept as commit history.)
const SLUGS_BY_BRAND = {
  Apple: [
    'apple-iphone-16-pro-max',
    'apple-iphone-16-pro',
    'apple-iphone-16',
    'apple-iphone-16-plus',
    'apple-iphone-16e',
    'apple-iphone-15-pro-max',
    'apple-iphone-15-pro',
    'apple-iphone-15',
    'apple-iphone-15-plus',
    'apple-iphone-14-pro-max',
    'apple-iphone-14-pro',
    'apple-iphone-14-plus',
    'apple-iphone-14',
  ],
  Samsung: [
    'samsung-galaxy-s25-ultra-sm-s938',
    'samsung-galaxy-s25-sm-s931',
    'samsung-galaxy-s25-plus-sm-s936',
    'samsung-galaxy-s24-ultra-5g-sm-s928',
    'samsung-galaxy-s24-plus-5g-sm-s926',
    'samsung-galaxy-s24-5g-sm-s921',
    'samsung-galaxy-s24-fe',
    'samsung-galaxy-a56',
    'samsung-galaxy-a36',
    'samsung-galaxy-a16-5g',
    'samsung-galaxy-a06-5g',
    'samsung-galaxy-m55',
    'samsung-galaxy-z-flip7',
    'samsung-galaxy-z-fold7',
    'samsung-galaxy-s23-fe',
  ],
  Xiaomi: [
    'xiaomi-15',
    'xiaomi-15-pro',
    'xiaomi-14t',
    'xiaomi-14t-pro',
    'xiaomi-redmi-note-14-5g',
    'xiaomi-redmi-14c',
    'xiaomi-redmi-14c-5g',
    'xiaomi-redmi-13',
    'xiaomi-redmi-13c',
    'xiaomi-poco-x7-pro',
    'xiaomi-poco-f7',
    'xiaomi-poco-c75',
  ],
  Realme: [
    'realme-gt-7',
    'realme-13-pro',
    'realme-12-pro',
    'realme-c75',
    'realme-c75x',
    'realme-narzo-70-pro',
  ],
  Tecno: [
    'tecno-camon-40-premier',
    'tecno-spark-30-pro',
    'tecno-spark-30',
    'tecno-spark-30c',
    'tecno-camon-30-pro',
    'tecno-camon-30s',
    'tecno-phantom-x2-pro',
  ],
};

// GSMArena uses URL-encoded brand directories. Special-case the few that differ.
function brandPath(brand) {
  return brand.toLowerCase(); // apple, samsung, xiaomi, realme, tecno — all lowercase
}

// ── HTTP helper ─────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';

function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
        'Referer': 'https://www.gsmarena.com/',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuf(new URL(res.headers.location, url).href).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ── download pool per brand ─────────────────────────────────────────────
async function buildBrandPool(brand, slugs) {
  const local = []; // [{ path: '/uploads/lst_xxx.jpg', size }]
  const bp = brandPath(brand);

  for (const slug of slugs) {
    for (let n = 1; n <= 5; n++) {
      const url = `https://fdn2.gsmarena.com/vv/pics/${bp}/${slug}-${n}.jpg`;
      const hash = crypto.createHash('sha256').update(`${slug}-${n}`).digest('hex').slice(0, 24);
      const filename = `lst_${hash}.jpg`;
      const filepath = path.join(UPLOADS_DIR, filename);
      const webPath = `/uploads/${filename}`;

      if (fs.existsSync(filepath)) {
        const size = fs.statSync(filepath).size;
        if (size > 2000) {
          local.push({ path: webPath, size });
          continue;
        }
        // Tiny file = previous error; refetch.
        fs.unlinkSync(filepath);
      }

      try {
        const buf = await fetchBuf(url);
        if (buf.length < 2000) {
          // Image too small to be a real photo — likely a 1x1 or placeholder.
          break;
        }
        fs.writeFileSync(filepath, buf);
        local.push({ path: webPath, size: buf.length });
        process.stdout.write(`  ${brand}/${slug}-${n}: ${(buf.length / 1024).toFixed(0)} KB\n`);
      } catch (e) {
        // Most 404s appear at -3.jpg or -4.jpg — that's normal, just stop the slug.
        break;
      }
    }
  }
  return local;
}

// ── deterministic PRNG ──────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickN(pool, n, rng) {
  const idxs = pool.map((_, i) => i);
  // Fisher-Yates with seeded RNG
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  return idxs.slice(0, n).map((i) => pool[i]);
}

// ── main ────────────────────────────────────────────────────────────────
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const seller = db.prepare('SELECT id FROM users WHERE phone=?').get('seed:demo_listings');
if (!seller) {
  console.error('Demo seller not found (phone=seed:demo_listings). Run seedListings.js first.');
  process.exit(1);
}
console.log(`Demo seller id: ${seller.id}`);

console.log('\nDownloading brand pools…');
const pools = {};
for (const brand of Object.keys(SLUGS_BY_BRAND)) {
  console.log(`\n[${brand}]`);
  pools[brand] = await buildBrandPool(brand, SLUGS_BY_BRAND[brand]);
  console.log(`  → ${pools[brand].length} images in pool`);
}

// Wipe existing demo images so reruns are idempotent.
const existingImgs = db.prepare(`
  SELECT li.id, li.image_path
  FROM listing_images li
  JOIN phone_listings l ON l.id = li.listing_id
  WHERE l.seller_id = ?
`).all(seller.id);
console.log(`\nDeleting ${existingImgs.length} existing demo listing_images rows…`);
db.prepare(`
  DELETE FROM listing_images
  WHERE listing_id IN (SELECT id FROM phone_listings WHERE seller_id = ?)
`).run(seller.id);

// Attach images per listing.
const listings = db.prepare(`
  SELECT id, brand FROM phone_listings WHERE seller_id = ? ORDER BY id
`).all(seller.id);

const insertImg = db.prepare(`
  INSERT INTO listing_images(listing_id, image_path, position, created_at)
  VALUES (?, ?, ?, ?)
`);

const stats = {};
const attach = db.transaction(() => {
  for (const l of listings) {
    const pool = pools[l.brand] || [];
    if (pool.length === 0) {
      stats[l.brand] = (stats[l.brand] || { listings: 0, images: 0, skipped: 0 });
      stats[l.brand].skipped++;
      continue;
    }
    const rng = mulberry32(l.id * 0x9e3779b1);
    const n = 3 + Math.floor(rng() * 3); // 3..5
    const picks = pickN(pool, Math.min(n, pool.length), rng);
    const now = Date.now();
    picks.forEach((img, i) => {
      insertImg.run(l.id, img.path, i, now);
    });
    stats[l.brand] = stats[l.brand] || { listings: 0, images: 0, skipped: 0 };
    stats[l.brand].listings++;
    stats[l.brand].images += picks.length;
  }
});
attach();

console.log('\nDone. Per-brand totals:');
console.table(stats);
console.log(`\nTotal listings touched: ${listings.length}`);
