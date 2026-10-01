// Import device spec sheets scraped from GSMArena into device_specs, and
// the (brand, model) -> sheet resolution into device_spec_map.
//
// The scraping itself lives in tools/gsmarena/ (Python) and writes two
// files; this script only loads them, so a re-import is cheap and the
// fetch is never repeated by accident.
//
// Run from server/:
//   node scripts/importDeviceSpecs.js ../tools/gsmarena/out
//
// Idempotent: a device is keyed by its source URL and a map row by
// (brand, model_norm), so re-running updates in place. Manual mappings
// (confidence='manual') are never overwritten by an automatic one — a
// human decision outranks the matcher.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db.js';
import { upsertSpecSheet, mapModelToSpec } from '../src/deviceSpecsWrite.js';

const dir = process.argv[2] || path.join(process.cwd(), '..', 'tools', 'gsmarena', 'out');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const specs = read('device_specs.json');
const matched = read('matched.json');
const now = Date.now();

const run = db.transaction(() => {
  const byUrl = new Map();
  for (const s of specs) {
    byUrl.set(s.gsm_url, upsertSpecSheet(s, now));
  }

  let mapped = 0, skipped = 0;
  for (const m of matched) {
    const id = byUrl.get(m.gsm_url);
    if (!id) { skipped++; continue; }          // matched but never fetched
    mapModelToSpec(m.brand, m.model, id, m.match, now);
    mapped++;
  }
  return { mapped, skipped };
});

const { mapped, skipped } = run();
console.log(`device_specs:    ${db.prepare('SELECT COUNT(*) c FROM device_specs').get().c} rows`);
console.log(`device_spec_map: ${db.prepare('SELECT COUNT(*) c FROM device_spec_map').get().c} rows (${mapped} written, ${skipped} skipped)`);

// How much of the live catalogue this actually covers — the number worth
// watching, since a sheet nothing resolves to is a sheet nobody sees.
const cov = db.prepare(`
  SELECT COUNT(*) total,
         SUM(CASE WHEN m.spec_id IS NOT NULL THEN 1 ELSE 0 END) with_specs
    FROM phone_listings l
    LEFT JOIN device_spec_map m
           ON m.brand = l.brand AND m.model_norm = LOWER(TRIM(l.model))
   WHERE l.status='active'
`).get();
console.log(`active listings covered: ${cov.with_specs} of ${cov.total}`);
