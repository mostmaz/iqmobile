// Take specific listings down, by id, with a receipt.
//
// Written for the iCloud-locked and unsafe devices found by the description
// audit — the ones a human decided must go, not a rule. Ids are passed in
// rather than matched, because "delete everything matching X" is how a bad
// pattern quietly removes a hundred honest listings.
//
//   node scripts/removeListings.js --ids 523,2480 --reason "iCloud locked"
//   node scripts/removeListings.js --ids 523,2480 --reason "..." --apply
//
// A removal here is the same soft delete the dashboard performs
// (status='removed'), so it is reversible: the row keeps its images,
// description and price, and the backup file records the previous status.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db, now } from '../src/db.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const idsArg = args.indexOf('--ids');
const reasonArg = args.indexOf('--reason');
const REASON = reasonArg >= 0 ? String(args[reasonArg + 1] || '') : '';

if (idsArg < 0) { console.error('need --ids 1,2,3'); process.exit(1); }
const ids = String(args[idsArg + 1] || '')
  .split(',').map((x) => Number(x.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
if (!ids.length) { console.error('no valid ids'); process.exit(1); }

const ph = ids.map(() => '?').join(',');
const rows = db.prepare(`
  SELECT l.id, l.brand, l.model, l.status, l.asking_price, l.description,
         u.display_name, u.shop_name
    FROM phone_listings l JOIN users u ON u.id = l.seller_id
   WHERE l.id IN (${ph})
`).all(...ids);

const missing = ids.filter((id) => !rows.some((r) => r.id === id));
if (missing.length) console.log(`not found: ${missing.join(', ')}\n`);

for (const r of rows) {
  const flag = r.status === 'removed' ? '  (already removed — no change)' : '';
  console.log(`  ${String(r.id).padStart(5)}  ${r.brand} ${r.model}${flag}`);
  console.log(`         ${r.status} · ${r.asking_price.toLocaleString('en-US')} د.ع · ${r.shop_name || r.display_name}`);
  console.log(`         «${String(r.description || '').replace(/\s+/g, ' ').slice(0, 110)}»\n`);
}

const live = rows.filter((r) => r.status !== 'removed');
if (!live.length) { console.log('nothing to remove.'); process.exit(0); }
if (!APPLY) {
  console.log(`dry run — ${live.length} listing(s) would be removed. Re-run with --apply.`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(process.cwd(), 'data', `backup-removed-${stamp}.json`);
fs.writeFileSync(backup, JSON.stringify(
  live.map((r) => ({ id: r.id, was_status: r.status, brand: r.brand, model: r.model, reason: REASON })),
  null, 1,
));

const t = now();
const upd = db.prepare("UPDATE phone_listings SET status='removed', updated_at=? WHERE id=?");
// Audited like every other operator action, so the removal is answerable
// later — audit_log is the table the dashboard's history reads.
const aud = db.prepare(
  `INSERT INTO audit_log(actor_kind, actor_id, action, target_kind, target_id, detail_json, created_at)
   VALUES('script', 0, 'listing.remove', 'listing', ?, ?, ?)`,
);
db.transaction(() => {
  for (const r of live) {
    upd.run(t, r.id);
    aud.run(r.id, JSON.stringify({ reason: REASON, was_status: r.status }), t);
  }
})();
console.log(`removed ${live.length} listing(s). Backup: ${backup}`);
