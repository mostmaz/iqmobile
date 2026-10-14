// Replay listings the owner has already decided through the AI check, and
// count how often the check would have agreed. Read-only: it calls the
// model and prints; it never writes a verdict or touches a listing.
//
//   node --import dotenv/config scripts/evalInspection.js \
//     [--since 2026-10-02T20:00:00Z] [--efforts low,medium] [--limit 40] \
//     [--modules ./src/listingInspect.js,./src/listingInspect.next.js] \
//     [--out /tmp/eval.json]
//
// The truth is the owner's decision in the الفحص tab: approved = should be
// published, removed = should be held. Each arm (module × effort) is scored
// under both gate rules, so a prompt change and a rule change can be told
// apart:
//   old rule — held unless clean (medium/high)       (before 14 Oct 2026)
//   new rule — held only if defective (medium/high)  (gateDecision)
// A wrong hold is an honest seller kept waiting; a miss is a phone the owner
// removed going live until someone looks. Costs one model call per listing
// per arm — about $0.06 per hundred on the default model.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { db } from '../src/db.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const since = Date.parse(arg('since', '2026-10-02T20:00:00Z'));
const efforts = arg('efforts', 'low').split(',');
const modules = arg('modules', './src/listingInspect.js').split(',');
const limit = Number(arg('limit', 0)) || null;
const out = arg('out', null);
const concurrency = Number(arg('concurrency', 4));

const RULES = {
  old: (r) => (r.verdict === 'clean' && r.confidence !== 'low' ? 'published' : 'held'),
  new: (r) => (r.verdict === 'defective' && r.confidence !== 'low' ? 'held' : 'published'),
};

const rows = db.prepare(
  `SELECT i.listing_id, i.status AS owner, i.verdict AS was_verdict, i.confidence AS was_confidence
     FROM listing_inspections i JOIN phone_listings l ON l.id = i.listing_id
    WHERE i.judged_by = 'model' AND i.created_at > ? AND i.status IN ('approved','removed')
      AND COALESCE(i.action, '') != 'deleted'
    ORDER BY i.listing_id`,
).all(since);
const images = (id) => db
  .prepare('SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC')
  .all(id).map((r) => r.image_path);
let cases = rows.map((r) => ({ ...r, images: images(r.listing_id) })).filter((r) => r.images.length);
if (limit) cases = cases.slice(0, limit);
console.log(`${cases.length} decided listings with photos (${cases.filter((c) => c.owner === 'approved').length} approved, ${cases.filter((c) => c.owner === 'removed').length} removed)`);

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

function score(answers, rule) {
  const s = { wrong_holds: 0, misses: 0, held: 0, suspects: 0, errors: 0 };
  for (const a of answers) {
    if (!a.result) { s.errors++; continue; }
    const d = RULES[rule](a.result);
    if (d === 'held') s.held++;
    if (a.result.verdict === 'suspect') s.suspects++;
    if (d === 'held' && a.owner === 'approved') s.wrong_holds++;
    if (d === 'published' && a.owner === 'removed') s.misses++;
  }
  return s;
}

const report = { since: new Date(since).toISOString(), cases: cases.length, arms: [] };
for (const mod of modules) {
  const { inspectListing } = await import(pathToFileURL(path.resolve(mod)).href);
  for (const effort of efforts) {
    const label = `${path.basename(mod)} · ${effort}`;
    const t0 = Date.now();
    const answers = await pool(cases, concurrency, async (c) => {
      const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(c.listing_id);
      try {
        const result = await inspectListing(listing, c.images, { effort });
        return { id: c.listing_id, owner: c.owner, result };
      } catch (e) {
        return { id: c.listing_id, owner: c.owner, result: null, error: String(e?.message || e).slice(0, 160) };
      }
    });
    const arm = { label, seconds: Math.round((Date.now() - t0) / 1000), old_rule: score(answers, 'old'), new_rule: score(answers, 'new'), answers };
    report.arms.push(arm);
    console.log(`\n${label} (${arm.seconds}s)`);
    console.log('  old rule:', JSON.stringify(arm.old_rule));
    console.log('  new rule:', JSON.stringify(arm.new_rule));
  }
}
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
