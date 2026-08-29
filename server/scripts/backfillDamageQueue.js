// Put already-published listings that disclose damage into the review queue.
//
// The word gate only ever ran at creation, and only from 2026-07-27. Every
// listing older than that, and every one whose description was edited after
// posting, was never checked — which is why a scan of production turned up
// cracked screens and cracked backs sitting live with nobody having looked
// at them. This is the one-time catch-up for the rule that now runs on
// create AND edit.
//
//   node scripts/backfillDamageQueue.js           # dry run
//   node scripts/backfillDamageQueue.js --apply
//
// Uses the SAME reviewListingQuality() the live path uses, so the backfill
// and the gate can never disagree about what counts as damage. Listings that
// the hard gate would refuse outright are reported separately and NOT
// queued — those are a removal decision, not a review one.
import 'dotenv/config';
import { db } from '../src/db.js';
import { checkListingQuality, reviewListingQuality } from '../src/listingQuality.js';
import { flagListingForReview } from '../src/listingFlag.js';

const APPLY = process.argv.includes('--apply');

const rows = db.prepare(`
  SELECT l.id, l.brand, l.model, l.status, l.condition, l.asking_price, l.description
    FROM phone_listings l
   WHERE l.status IN ('active','reserved') AND COALESCE(l.is_draft,0)=0
     AND l.description IS NOT NULL AND TRIM(l.description) != ''
   ORDER BY l.id
`).all();

const already = new Set(
  db.prepare("SELECT listing_id FROM listing_inspections WHERE status='pending'").all()
    .map((r) => r.listing_id),
);

const queue = [], blockers = [];
for (const r of rows) {
  const hard = checkListingQuality(r.model, r.description);
  if (hard) { blockers.push({ ...r, term: hard }); continue; }
  const dmg = reviewListingQuality(r.model, r.description);
  if (dmg && !already.has(r.id)) queue.push({ ...r, ...dmg });
}

const line = (r, extra) =>
  `  ${String(r.id).padStart(5)}  ${r.brand} ${r.model}`.padEnd(44)
  + `| ${r.condition.padEnd(11)} | ${String(r.asking_price).padStart(9)} | ${extra}`;

console.log(`scanned ${rows.length} live listings with a description\n`);
console.log(`TO QUEUE FOR REVIEW (${queue.length})`);
for (const r of queue) {
  console.log(line(r, r.defects.map((d) => `${d.kind} ← «${d.term}»`).join(' + ')));
}

if (blockers.length) {
  console.log(`\nWOULD BE REFUSED OUTRIGHT TODAY (${blockers.length}) — not queued, decide by hand`);
  for (const r of blockers) console.log(line(r, `«${r.term}»`));
  console.log('  → these predate the gate. Use scripts/removeListings.js if they should go.');
}

if (!queue.length) { console.log('\nnothing to queue.'); process.exit(0); }
if (!APPLY) {
  console.log(`\ndry run — ${queue.length} would be queued. Re-run with --apply.`);
  process.exit(0);
}
for (const r of queue) flagListingForReview(r.id, r.defects);
console.log(`\nqueued ${queue.length} listing(s) for review.`);
