// Move the brand out of the model name and onto the brand field.
//
// Sellers pick a brand from the dropdown and then type the full name into
// the model box, so a POCO arrives as "Xiaomi / Poco X4 5G" instead of
// "POCO / X4 5G", and an Honor filed by mistake under Blackview still says
// "Honor X9c" in its name. Left alone the same phone exists under several
// brands at once, and every brand filter, price comparison and spec lookup
// splits across the copies.
//
// This does ONE thing, on the seller's own words:
//
//   leading brand word in the model  ->  that becomes the brand,
//                                        and is removed from the name
//
// It deliberately does NOT canonicalise names against device_catalog. That
// was tried and the catalogue turned out to hold junk rows approved from
// the suggestion queue — "Apple / ipad", "Apple / iPhone Air",
// "Tecno / Tecno Camon 40 Pro 5G". Matching against those would have
// renamed an Apple Watch 11 to an iPhone 11 and a MacBook Air to an
// iPhone Air. Rewriting a seller's name to a catalogue entry is only ever
// as safe as the catalogue, so that job waits until the catalogue is
// cleaned; --report prints what it would have proposed.
//
//   node scripts/normalizeListingNames.js            # dry run
//   node scripts/normalizeListingNames.js --apply    # write + advance watermark
//   node scripts/normalizeListingNames.js --report   # also show catalogue mismatches
//
// Only rows newer than the stored watermark are read, so the daily run
// costs the same whether the table holds 700 rows or 70,000.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db.js';
import { resolveListingName } from '../src/listingNameNormalize.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REPORT = args.includes('--report');
const sinceArg = args.indexOf('--since-id');

const WATERMARK_KEY = 'listing_namefix_watermark_id';
const getSetting = db.prepare('SELECT value FROM app_settings WHERE key=?');
const setSetting = db.prepare(
  'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
);
const sinceId = sinceArg >= 0
  ? Number(args[sinceArg + 1])
  : Number(getSetting.get(WATERMARK_KEY)?.value || 0);

// Brand names only. Line words are NOT here on purpose: "iPhone" and
// "Galaxy" are part of the model that the catalogue and the app both print
// ("Apple iPhone 13"), so stripping them would rename every Apple and
// Samsung listing down to a bare number.
const BRANDS = {
  poco: 'POCO', redmi: 'Redmi', xiaomi: 'Xiaomi',
  honor: 'Honor', huawei: 'Huawei', samsung: 'Samsung', apple: 'Apple',
  oppo: 'OPPO', vivo: 'Vivo', realme: 'Realme', tecno: 'Tecno',
  techno: 'Tecno', infinix: 'Infinix', nokia: 'Nokia', motorola: 'Motorola',
  google: 'Google', itel: 'Itel', oneplus: 'OnePlus', blackview: 'Blackview',
  oukitel: 'Oukitel', nubia: 'Nubia', zte: 'ZTE', lenovo: 'Lenovo',
  sony: 'Sony', doogee: 'Doogee', ulefone: 'Ulefone', tcl: 'TCL',
  // Arabic spellings sellers type — same brand, different alphabet.
  'بوكو': 'POCO', 'ريدمي': 'Redmi', 'شاومي': 'Xiaomi', 'هونر': 'Honor',
  'هواوي': 'Huawei', 'سامسونك': 'Samsung', 'سامسونج': 'Samsung', 'ابل': 'Apple',
  'اوبو': 'OPPO', 'فيفو': 'Vivo', 'ريلمي': 'Realme', 'تكنو': 'Tecno',
  'انفنكس': 'Infinix', 'نوكيا': 'Nokia', 'موتورولا': 'Motorola',
};

// A brand the app doesn't offer is worse than a wrong one: the listing
// disappears from every brand filter. ZTE is the live example — sellers
// write "ZTE Nubia Neo 5G", but the brand list has Nubia and no ZTE, so
// that row keeps its brand and only loses the words the app can act on.
const AVAILABLE = new Set(db.prepare('SELECT name FROM brands').all().map((r) => r.name));

const rows = db.prepare(`
  SELECT id, brand, model, status FROM phone_listings
   WHERE status IN ('active','reserved') AND id > ?
   ORDER BY id ASC LIMIT 5000
`).all(sinceId);

const plan = { brand: [], strip: [], mismatch: [] };

for (const r of rows) {
  // Only LEADING brand words are touched — "Galaxy Z Fold" has no brand in
  // it, and a trailing one ("Note 14 Redmi") is rare enough that guessing
  // would cost more than it saves. Several can stack ("ZTE Nubia Neo 5G"),
  // so walk them all and keep the last one the app actually offers.
  let rest = String(r.model || '').trim();
  let target;
  for (;;) {
    const m = /^([A-Za-z؀-ۿ]+)[\s\-_.]+(.+)$/.exec(rest);
    if (!m) break;
    const b = BRANDS[m[1].toLowerCase()];
    if (!b) break;
    rest = m[2].trim();
    if (AVAILABLE.has(b)) target = b;         // ignore brands with no home
  }
  // "Poco" on its own is a brand, not a device — nothing would be left to
  // call it.
  if (target && rest) {
    const row = { ...r, to_brand: target, to_model: rest };
    if (target !== r.brand) plan.brand.push(row);
    else plan.strip.push(row);
  }

  if (REPORT) {
    const res = resolveListingName(r.brand, r.model);
    if (res.model && res.model !== String(r.model || '').trim()) {
      plan.mismatch.push({ ...r, cat_brand: res.brand, cat_model: res.model });
    }
  }
}

const show = (label, list, n = 40) => {
  if (!list.length) return;
  console.log(`\n${label} (${list.length})`);
  for (const x of list.slice(0, n)) {
    const to = x.to_brand ? `${x.to_brand} / ${x.to_model}` : `${x.cat_brand} / ${x.cat_model}`;
    console.log(`  ${String(x.id).padStart(5)}  ${x.brand} / ${x.model}`.padEnd(56) + `→  ${to}`);
  }
  if (list.length > n) console.log(`  … ${list.length - n} more`);
};

console.log(`scanned ${rows.length} listings with id > ${sinceId}`);
show('BRAND moved out of the name', plan.brand);
show('BRAND repeated in the name — stripped', plan.strip);
if (REPORT) show('catalogue disagrees (NOT applied — see header)', plan.mismatch, 60);

const writes = [...plan.brand, ...plan.strip];
if (!APPLY) {
  console.log(`\ndry run — ${writes.length} rows would change. Re-run with --apply.`);
  process.exit(0);
}

if (writes.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(process.cwd(), 'data', `backup-namefix-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(writes, null, 1));
  const upd = db.prepare('UPDATE phone_listings SET brand=?, model=?, updated_at=? WHERE id=?');
  const now = Date.now();
  db.transaction(() => {
    for (const w of writes) upd.run(w.to_brand, w.to_model, now, w.id);
  })();
  console.log(`\nwrote ${writes.length} renames. Backup: ${backup}`);
} else {
  console.log('\nnothing to write.');
}

const maxId = rows.length ? rows[rows.length - 1].id : sinceId;
setSetting.run(WATERMARK_KEY, String(maxId));
console.log(`watermark advanced to id ${maxId}`);
