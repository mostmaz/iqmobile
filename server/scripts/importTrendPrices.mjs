// A supplier price sheet into the three places it belongs.
//
// Trend Mobile posts a price list; the owner drops it as an xlsx, parsed to
// JSON by the caller (see --file). Three destinations, and they are NOT the
// same set, because they answer different questions:
//
//   #5587 «IQ Mobile»      — the COD storefront. EVERYTHING, including
//                            MacBooks, watches, audio and pencils: it is a
//                            shop and a shop sells what it stocks.
//   #2548 «اسعار الموبايلات» — the hidden price-comparison shop. Phones and
//                            tablets only; it exists to compare DEVICE
//                            prices and an Apple Pencil in it is noise.
//                            Carries TREND's contact, not ours — the price
//                            is theirs, so the buyer who wants it should
//                            reach them. That matches the 61 listings
//                            already in there under a source shop's number.
//   #488  «Trend ترند»     — Trend's own visible shop. Phones and tablets,
//                            for the same reason plus one more: this shop
//                            DOES appear in the browse feed, and 60
//                            accessories posted as phone listings would
//                            show up there as phones.
//
// Prices always override, per the owner: a newer sheet is the truth even
// when the number went up. Worth knowing what that costs — on the 12 Sep
// sheet, 12 of the 17 devices the price shop already carried got MORE
// expensive, +1,102,000 IQD across the overlap. That is the instruction,
// not an accident.
//
//   node scripts/importTrendPrices.mjs --file ~/trend_mobile_prices.xlsx
//   node scripts/importTrendPrices.mjs --file ~/trend_mobile_prices.xlsx --apply
//
// Reverse: every write is journalled to ~/trend-import-backup-<stamp>.json
// with the previous price of each updated row and the id of each created
// one.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
import { db, now, getSetting } from '../src/db.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fileArg = args[args.indexOf('--file') + 1];
if (!fileArg || fileArg.startsWith('--')) {
  console.error('usage: importTrendPrices.mjs --file <sheet.xlsx> [--apply]');
  process.exit(1);
}

// ── the sheet ─────────────────────────────────────────────────────────
//
// Columns: Brand, Category, Item, Storage, Price_IQD, Status, Sheet_Date,
// Source. Parsed here rather than in a separate step on purpose — the two
// bugs this import nearly shipped were both parsing bugs, and a parser that
// lives beside the writer cannot drift from it.

/** Sheet brand → the app's brand vocabulary. Poco ships under Xiaomi here. */
const BRAND = {
  Apple: 'Apple', Samsung: 'Samsung', HONOR: 'Honor', Xiaomi: 'Xiaomi',
  Poco: 'Xiaomi', Huawei: 'Huawei', Tecno: 'Tecno', Infinix: 'Infinix',
};
const TABLET_CATS = new Set(['Tablet', 'iPad']);

/**
 * The ROM out of a storage cell.
 *
 * «12GB + 256GB» is RAM + ROM and the listing model has one storage field,
 * so the LAST capacity wins. That is also why dedupe below exists: two RAM
 * variants of one phone collapse to the same key, and writing both would
 * leave whichever happened to come last.
 */
function rom(cell) {
  if (cell == null || cell === '' || cell === 'None') return null;
  const caps = String(cell).match(/\d+\s*(?:GB|TB)/gi);
  return caps ? caps[caps.length - 1].replace(/\s+/g, '').toUpperCase() : null;
}

function readSheet(file) {
  const wb = xlsx.readFile(file.replace(/^~/, process.env.HOME || '~'));
  const sheet = wb.Sheets[wb.SheetNames.includes('Prices') ? 'Prices' : wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, { defval: null });

  const parsed = [];
  for (const r of raw) {
    const brand = r.Brand;
    const price = Number(r.Price_IQD);
    // Pre-order and out-of-stock rows carry no price, or a price for
    // something nobody can buy yet. Either way they are not a listing.
    if (!brand || !Number.isFinite(price) || price <= 0) continue;
    if (String(r.Status || '').trim() !== 'Available') continue;
    const cat = String(r.Category || '').trim();
    parsed.push({
      brand: BRAND[brand] || brand,
      model: String(r.Item || '').trim(),
      storage: rom(r.Storage),
      price: Math.floor(price),
      kind: TABLET_CATS.has(cat) ? 'tablet' : (cat === 'Phone' ? 'phone' : 'other'),
    });
  }

  // Lowest per brand|model|ROM. The sheet prices RAM variants separately and
  // the listing has nowhere to put RAM, so the cheapest is the honest one to
  // show — the same rule the Free Zone import used.
  const best = new Map();
  let collapsed = 0;
  for (const r of parsed) {
    const k = `${r.brand}|${r.model.toLowerCase()}|${r.storage}`;
    const prev = best.get(k);
    if (!prev) best.set(k, r);
    else { collapsed++; if (r.price < prev.price) best.set(k, r); }
  }
  const out = [...best.values()];
  console.log(`sheet: ${raw.length} rows -> ${parsed.length} available+priced -> ${out.length} unique`
    + ` (${collapsed} RAM variants collapsed to the cheaper)`);
  return out;
}

const rows = readSheet(fileArg);

const STORE = { id: 5587, phone: '07360007001', label: 'IQ Mobile store', all: true };
const PRICE = { id: 2548, phone: '07360007000', label: 'price shop', all: false, contact: '07811000038' };
const TREND = { id: 488, phone: '07811000038', label: 'Trend ترند', all: false };

// Sorted token bag, so "iPad Pro 13-inch M5" and the stored "iPad Pro 13 M5"
// are one device. Without this the sheet reads as 128 new products and the
// shops fill with near-duplicates.
const key = (brand, model, storage) => {
  const m = String(model || '').toLowerCase().replace(/inch|["']/g, ' ').match(/[a-z0-9]+/g) || [];
  const st = String(storage || '').toLowerCase().replace(/[^0-9a-z]/g, '');
  return `${String(brand).toLowerCase()}|${m.sort().join('')}|${st}`;
};

const TTL_MS = (Number(getSetting('listing_ttl_days')) || 30) * 24 * 60 * 60 * 1000;
const journal = { at: new Date().toISOString(), file: fileArg, updated: [], created: [] };
// Call-for-price rows the sheet has a number for. Reported, never written.
const sentinel = [];

function sync(target) {
  const wanted = target.all ? rows : rows.filter((r) => r.kind !== 'other');
  const existing = db.prepare(
    "SELECT id, brand, model, storage, asking_price FROM phone_listings WHERE seller_id=? AND status='active'",
  ).all(target.id);
  const idx = new Map();
  for (const l of existing) idx.set(key(l.brand, l.model, l.storage), l);

  let updated = 0, created = 0, unchanged = 0, delta = 0;
  const t = now();
  for (const r of wanted) {
    const hit = idx.get(key(r.brand, r.model, r.storage));
    if (hit) {
      // asking_price <= 1 is the call-for-price sentinel, not a cheap phone.
      // Writing a real number over it converts «اتصل للسعر» into a quoted
      // price, which is a different decision from refreshing a price — so it
      // is reported and skipped, exactly as fixThousandPrices.js leaves the
      // same rows alone.
      if (hit.asking_price <= 1) {
        sentinel.push({ shop: target.id, listing_id: hit.id, would_be: r.price,
          device: `${r.brand} ${r.model} ${r.storage || ''}`.trim() });
        continue;
      }
      if (hit.asking_price === r.price) { unchanged++; continue; }
      delta += r.price - hit.asking_price;
      journal.updated.push({ shop: target.id, listing_id: hit.id, from: hit.asking_price, to: r.price,
        device: `${r.brand} ${r.model} ${r.storage || ''}`.trim() });
      if (apply) {
        db.prepare('UPDATE phone_listings SET asking_price=?, updated_at=?, expires_at=? WHERE id=?')
          .run(r.price, t, t + TTL_MS, hit.id);
      }
      updated++;
    } else {
      journal.created.push({ shop: target.id, device: `${r.brand} ${r.model} ${r.storage || ''}`.trim(), price: r.price });
      if (apply) {
        const contact = target.contact || target.phone;
        db.prepare(`INSERT INTO phone_listings(
            seller_id, brand, model, storage, color, condition,
            battery_health, warranty_status, accessories_json, asking_price,
            governorate, city, description, status, contact_phone, contact_whatsapp,
            created_at, expires_at, updated_at)
          VALUES(?,?,?,?,?, 'new', NULL, NULL, '[]', ?, 'Baghdad', NULL, NULL, 'active', ?, ?, ?, ?, ?)`)
          .run(target.id, r.brand, r.model, r.storage || null, null, r.price, contact, contact, t, t + TTL_MS, t);
      }
      created++;
    }
  }
  console.log(`${target.label.padEnd(16)} (#${target.id}): ${String(wanted.length).padStart(3)} rows ->`
    + ` ${String(updated).padStart(3)} updated, ${String(created).padStart(3)} created, ${unchanged} unchanged`
    + (delta ? `   net price change ${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')} IQD` : ''));
}

console.log(`phones+tablets: ${rows.filter((r) => r.kind !== 'other').length}\n`);
const run = db.transaction(() => { for (const t of [STORE, PRICE, TREND]) sync(t); });
run();

if (sentinel.length) {
  console.log(`\nSKIPPED — «اتصل للسعر» listings the sheet prices (${sentinel.length}).`);
  console.log('  Setting a price on these is a different call from refreshing one:');
  for (const x of sentinel) console.log(`    #${x.listing_id} shop ${x.shop}  ${x.device}  -> ${x.would_be.toLocaleString('en-US')}`);
}

if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  process.exit(0);
}
const out = path.join(process.env.HOME || '.', `trend-import-backup-${journal.at.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(out, JSON.stringify(journal, null, 2));
console.log(`\nwritten. backup: ${out}`);
console.log(`  ${journal.updated.length} price updates, ${journal.created.length} new listings`);
