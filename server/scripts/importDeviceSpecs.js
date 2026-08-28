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

const dir = process.argv[2] || path.join(process.cwd(), '..', 'tools', 'gsmarena', 'out');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const specs = read('device_specs.json');
const matched = read('matched.json');
const now = Date.now();

const upsertSpec = db.prepare(`
  INSERT INTO device_specs (
    source, source_url, source_name, brand, display_inches, display,
    display_resolution, display_type, chipset, cpu, gpu, ram_gb,
    storage_options, battery_mah, battery, charging, charge_w,
    charge_w_wireless, camera_main, camera_main_video, camera_selfie,
    camera_selfie_video, os, network, announced, body, sim, raw_json, fetched_at
  ) VALUES (
    'gsmarena', @source_url, @source_name, @brand, @display_inches, @display,
    @display_resolution, @display_type, @chipset, @cpu, @gpu, @ram_gb,
    @storage_options, @battery_mah, @battery, @charging, @charge_w,
    @charge_w_wireless, @camera_main, @camera_main_video, @camera_selfie,
    @camera_selfie_video, @os, @network, @announced, @body, @sim, @raw_json, @fetched_at
  )
  ON CONFLICT(source_url) DO UPDATE SET
    source_name=excluded.source_name, brand=excluded.brand,
    display_inches=excluded.display_inches, display=excluded.display,
    display_resolution=excluded.display_resolution, display_type=excluded.display_type,
    chipset=excluded.chipset, cpu=excluded.cpu, gpu=excluded.gpu,
    ram_gb=excluded.ram_gb, storage_options=excluded.storage_options,
    battery_mah=excluded.battery_mah, battery=excluded.battery,
    charging=excluded.charging, charge_w=excluded.charge_w,
    charge_w_wireless=excluded.charge_w_wireless,
    camera_main=excluded.camera_main, camera_main_video=excluded.camera_main_video,
    camera_selfie=excluded.camera_selfie, camera_selfie_video=excluded.camera_selfie_video,
    os=excluded.os, network=excluded.network, announced=excluded.announced,
    body=excluded.body, sim=excluded.sim, raw_json=excluded.raw_json,
    fetched_at=excluded.fetched_at
`);
const idOf = db.prepare('SELECT id FROM device_specs WHERE source_url=?');
const upsertMap = db.prepare(`
  INSERT INTO device_spec_map (brand, model_norm, spec_id, confidence, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(brand, model_norm) DO UPDATE SET
    spec_id=excluded.spec_id, confidence=excluded.confidence
  WHERE device_spec_map.confidence != 'manual'
`);

const run = db.transaction(() => {
  const byUrl = new Map();
  for (const s of specs) {
    upsertSpec.run({
      source_url: s.gsm_url,
      source_name: s.gsm_name,
      brand: s.gsm_brand ?? null,
      display_inches: s.display_inches ?? null,
      display: s.display ?? null,
      display_resolution: s.display_resolution ?? null,
      display_type: s.display_type ?? null,
      chipset: s.chipset ?? null,
      cpu: s.cpu ?? null,
      gpu: s.gpu ?? null,
      ram_gb: Array.isArray(s.ram_gb) ? s.ram_gb.join('/') : (s.ram_gb ?? null),
      storage_options: Array.isArray(s.storage_options) ? s.storage_options.join('/') : null,
      battery_mah: s.battery_mah ?? null,
      battery: s.battery ?? null,
      charging: s.charging ?? null,
      charge_w: s.charge_w ?? null,
      charge_w_wireless: s.charge_w_wireless ?? null,
      camera_main: s.camera_main ?? null,
      camera_main_video: s.camera_main_video ?? null,
      camera_selfie: s.camera_selfie ?? null,
      camera_selfie_video: s.camera_selfie_video ?? null,
      os: s.os ?? null,
      network: s.network ?? null,
      announced: s.announced ?? null,
      body: s.body ?? null,
      sim: s.sim ?? null,
      raw_json: JSON.stringify(s),
      fetched_at: now,
    });
    byUrl.set(s.gsm_url, idOf.get(s.gsm_url).id);
  }

  let mapped = 0, skipped = 0;
  for (const m of matched) {
    const id = byUrl.get(m.gsm_url);
    if (!id) { skipped++; continue; }          // matched but never fetched
    upsertMap.run(m.brand, String(m.model).trim().toLowerCase(), id, m.match, now);
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
