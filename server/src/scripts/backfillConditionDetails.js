// Fill the structured condition answers on listings written before the
// questions existed, by reading what the seller already wrote.
//
// Usage (on the droplet, from server/):
//   node src/scripts/backfillConditionDetails.js            # dry run, prints
//   node src/scripts/backfillConditionDetails.js --apply    # writes
//   node src/scripts/backfillConditionDetails.js --show 40  # sample the diff
//
// Dry run is the default and prints the exact distribution it would write,
// because the failure mode here is silent and permanent: a wrong «سليمة» on
// a cracked phone is a listing that lies to every buyer who filters on it,
// and nothing downstream would ever flag it.
//
// Three rules make re-running safe:
//   1. A field a seller answered is NEVER overwritten. Their word beats an
//      inference from their own prose, always.
//   2. Only listings with a description are touched, and only fields the
//      prose actually answers — an unanswered field stays unanswered. It is
//      not the same as `unknown`, which means the seller was asked and said
//      they don't know, and this script must never forge that.
//   3. Nothing is deleted. The write merges over what is there.

import 'dotenv/config';
import { db, now } from '../db.js';
import { inferConditionDetails } from '../conditionFromProse.js';
import { parseConditionDetails, serializeConditionDetails } from '../conditionDetails.js';

const apply = process.argv.includes('--apply');
const showAt = process.argv.indexOf('--show');
const showN = showAt >= 0 ? Math.max(0, Number(process.argv[showAt + 1]) || 20) : 0;

const rows = db.prepare(`
  SELECT id, model, brand, description, condition_details_json
    FROM phone_listings
   WHERE description IS NOT NULL AND TRIM(description) != ''
`).all();

const dist = new Map();
const writes = [];
let untouched = 0;
let alreadyAnswered = 0;

for (const r of rows) {
  const existing = parseConditionDetails(r.condition_details_json);
  const inferred = inferConditionDetails(r.description);

  // The seller's own answer wins over anything read out of their prose.
  const add = {};
  for (const [k, v] of Object.entries(inferred)) {
    if (existing[k] === undefined) add[k] = v;
  }
  // The three counts partition the corpus — they must not overlap, or a
  // re-run reports more listings than it read.
  if (!Object.keys(add).length) {
    if (Object.keys(inferred).length) alreadyAnswered++; else untouched++;
    continue;
  }

  for (const [k, v] of Object.entries(add)) {
    const key = `${k}:${v}`;
    dist.set(key, (dist.get(key) || 0) + 1);
  }
  writes.push({ id: r.id, merged: { ...existing, ...add }, add, r });
}

console.log(`listings with a description: ${rows.length}`);
console.log(`would fill: ${writes.length}   already answered by the seller: ${alreadyAnswered}   no answer in the prose: ${untouched}`);
for (const [k, v] of [...dist].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

if (showN) {
  console.log('\n--- sample ---');
  for (const w of writes.slice(0, showN)) {
    console.log(`#${w.id} ${w.r.brand} ${w.r.model}`);
    console.log(`   ${JSON.stringify(w.add)}`);
    console.log(`   ${String(w.r.description).replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}

if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
  process.exit(0);
}

const stmt = db.prepare('UPDATE phone_listings SET condition_details_json=?, updated_at=? WHERE id=?');
const at = now();
db.transaction(() => {
  for (const w of writes) stmt.run(serializeConditionDetails(w.merged), at, w.id);
})();
console.log(`\nwrote ${writes.length} listings.`);
