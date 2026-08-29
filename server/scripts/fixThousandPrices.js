// Prices typed in thousands: 1050 meant 1,050,000.
//
// Some sellers filled the price box with the number they say out loud —
// "الف وخمسين" — and a flagship landed at 1,050 IQD. It stayed invisible
// for as long as nothing sorted by price; the moment the app grew a
// «الأرخص أولاً» order those rows became the FIRST thing a price-shopping
// buyer sees, with the whole marketplace behind them.
//
// The rule is the one the shop panel already applies on write
// (routes/shopAdmin.js: a price under 10,000 is multiplied by 1,000). This
// backfills it for rows that predate the guard or arrived through an import
// that skipped it.
//
//   node scripts/fixThousandPrices.js           # dry run
//   node scripts/fixThousandPrices.js --apply   # write + backup
//   node scripts/fixThousandPrices.js --below 5000 --apply
//
// Two kinds of row are deliberately LEFT ALONE:
//
//   price_on_request  — carries no price at all. shopAdmin stores a missing
//                       price as asking_price=1 and sets this flag; the app
//                       renders «اتصل للسعر» and never shows the number.
//                       Multiplying it would invent a price nobody quoted.
//   asking_price <= 1 — the same placeholder without the flag. × 1000 makes
//                       it 1,000, which is not a real price either — it just
//                       moves the problem down the list instead of fixing it.
//
// Every write is journalled to data/backup-price-x1000-<stamp>.json, so a
// bad run is one script away from being undone.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const bi = args.indexOf('--below');
const BELOW = bi >= 0 ? Number(args[bi + 1]) : 3000;

if (!Number.isFinite(BELOW) || BELOW <= 1) {
  console.error('--below must be a number above 1');
  process.exit(1);
}

// Status is not filtered. A sold row at 1,050 still poisons every median
// asking price computed over the same model, which is what the "your price
// is 26% above the market" diagnostic reads.
const rows = db.prepare(`
  SELECT l.id, l.brand, l.model, l.status, l.asking_price, l.price_on_request,
         u.display_name, u.shop_name, u.seller_type
    FROM phone_listings l
    JOIN users u ON u.id = l.seller_id
   WHERE l.asking_price > 0 AND l.asking_price < ?
   ORDER BY l.asking_price ASC, l.id ASC
`).all(BELOW);

const fix = [], skip = [];
for (const r of rows) {
  if (r.price_on_request) skip.push({ ...r, why: 'price_on_request — no price to scale' });
  else if (r.asking_price <= 1) skip.push({ ...r, why: 'placeholder — × 1000 is still not a price' });
  else fix.push({ ...r, to: r.asking_price * 1000 });
}

const who = (r) => r.shop_name || r.display_name || '—';
console.log(`asking_price under ${BELOW.toLocaleString('en-US')}: ${rows.length} rows\n`);

if (fix.length) {
  console.log(`WILL MULTIPLY BY 1000 (${fix.length})`);
  for (const r of fix) {
    console.log(
      `  ${String(r.id).padStart(5)}  ${r.brand} ${r.model}`.padEnd(46)
      + `| ${String(r.asking_price).padStart(5)} → ${r.to.toLocaleString('en-US').padStart(11)}`
      + `  | ${r.status.padEnd(8)} | ${who(r)}`,
    );
  }
  console.log();
}

if (skip.length) {
  console.log(`LEFT ALONE (${skip.length})`);
  for (const r of skip) {
    console.log(`  ${String(r.id).padStart(5)}  ${r.brand} ${r.model}`.padEnd(46)
      + `| ${String(r.asking_price).padStart(5)}  | ${r.why}`);
  }
  console.log();
}

if (!fix.length) { console.log('nothing to write.'); process.exit(0); }

if (!APPLY) {
  console.log(`dry run — ${fix.length} rows would change. Re-run with --apply.`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(process.cwd(), 'data', `backup-price-x1000-${stamp}.json`);
fs.writeFileSync(backup, JSON.stringify(
  fix.map((r) => ({ id: r.id, from: r.asking_price, to: r.to, brand: r.brand, model: r.model })),
  null, 1,
));

const upd = db.prepare('UPDATE phone_listings SET asking_price=?, updated_at=? WHERE id=?');
const now = Date.now();
db.transaction(() => { for (const r of fix) upd.run(r.to, now, r.id); })();

console.log(`wrote ${fix.length} prices. Backup: ${backup}`);
