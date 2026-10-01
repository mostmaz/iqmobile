// Writing spec sheets: the one place a GSMArena sheet enters device_specs
// and a (brand, model) gets pointed at it in device_spec_map.
//
// Two callers share it so they can't drift apart:
//   - scripts/importDeviceSpecs.js — the bulk load from tools/gsmarena
//   - the admin API (POST /admin/device-specs/…) — the nightly pass that
//     tops up sheets for devices that appeared since the last bulk load.
//
// parseGsmParts() is a port of tools/gsmarena/gsm_specs.py parse(). It takes
// the spec table already split into pieces by the browser
// (data-spec values, ttl/nfo label pairs, the battery highlight HTML) rather
// than a whole page, so a caller only has to ship a few KB.
import { db } from './db.js';

const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function pick(pairs, ...labels) {
  for (const [k, v] of pairs) if (labels.includes(String(k).toLowerCase())) return v;
  return null;
}

// Battery highlight: icon-then-value pairs; read each number from the
// segment that belongs to its own icon (see gsm_specs.py highlight_watts).
function highlightWatts(hl) {
  if (!hl) return [null, null];
  const parts = String(hl).split(/<i class="[^"]*icon-(wired|wireless)-charging[^"]*"><\/i>/);
  let wired = null, wireless = null;
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const w = /(\d+(?:\.\d+)?)\s*W\b/.exec(clean(parts[i + 1]));
    if (!w) continue;
    if (parts[i] === 'wired') wired = wired ?? Number(w[1]);
    else wireless = wireless ?? Number(w[1]);
  }
  return [wired, wireless];
}

/**
 * @param {{ds: Record<string,string>, pairs: [string,string][], hl?: string}} parts
 */
export function parseGsmParts(parts) {
  const ds = {};
  for (const [k, v] of Object.entries(parts?.ds || {})) {
    const c = clean(v);
    if (c) ds[k] = c;
  }
  const pairs = (Array.isArray(parts?.pairs) ? parts.pairs : [])
    .map((p) => [clean(p?.[0]), clean(p?.[1])])
    .filter(([k, v]) => k && v);

  const size = ds.displaysize || '';
  const mi = /([\d.]+)\s*inches/.exec(size);
  const inches = mi ? Number(mi[1]) : null;

  const mem = ds.internalmemory || '';
  let rams = [...new Set([...mem.matchAll(/(\d+)\s*GB RAM/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  if (!rams.length && ds['ramsize-hl']) rams = (ds['ramsize-hl'].match(/\d+/g) || []).slice(0, 1).map(Number);
  const storages = [...new Set([...mem.matchAll(/(\d+)\s*(GB|TB)(?!\s*RAM)/g)].map((m) => `${m[1]}${m[2]}`))]
    .sort((a, b) => (a.endsWith('TB') - b.endsWith('TB')) || (parseInt(a, 10) - parseInt(b, 10)));

  const bat = ds.batdescription1 || pick(pairs, 'type') || '';
  const mb = /([\d,]{3,6})\s*mAh/.exec(bat);
  const mah = mb ? Number(mb[1].replace(/,/g, '')) : null;

  // Wired watts = what a shopper means by charge speed. Everything from the
  // first "wireless" on belongs to the pad; "reverse" is output, not input.
  const charging = pick(pairs, 'charging') || '';
  const low = charging.toLowerCase();
  const wlAt = low.indexOf('wireless');
  let watts = null, wattsWl = null;
  for (const m of charging.matchAll(/(\d+(?:\.\d+)?)\s*W\b/g)) {
    const near = low.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12);
    if (near.includes('reverse')) continue;
    const val = Number(m[1]);
    if (wlAt !== -1 && m.index >= wlAt - 6) wattsWl = wattsWl ?? val;
    else watts = watts ?? val;
  }
  if (watts == null || wattsWl == null) {
    const [hw, hwl] = highlightWatts(parts?.hl);
    watts = watts ?? hw;
    wattsWl = wattsWl ?? hwl;
  }

  return {
    display_inches: inches,
    display: size || null,
    display_resolution: ds.displayresolution || null,
    display_type: ds.displaytype || null,
    chipset: ds.chipset || null,
    cpu: ds.cpu || null,
    gpu: ds.gpu || null,
    ram_gb: rams.length ? rams : null,
    storage_options: storages.length ? storages : null,
    battery_mah: mah,
    battery: bat || null,
    charging: charging || null,
    charge_w: watts,
    charge_w_wireless: wattsWl,
    camera_main: ds.cam1modules || null,
    camera_main_video: ds.cam1video || null,
    camera_selfie: ds.cam2modules || null,
    camera_selfie_video: ds.cam2video || null,
    os: ds.os || null,
    network: ds.nettech || null,
    announced: ds.year || null,
    body: ds['body-hl'] || ds.dimensions || null,
    sim: ds.sim || null,
  };
}

/** A GSMArena device page path, normalised to the form the bulk import stores ("apple_iphone_17-14000.php"). */
export function gsmPagePath(url) {
  const m = /^(?:https?:\/\/(?:www\.|m\.)?gsmarena\.com\/)?([a-z0-9_()+.-]+-\d+\.php)$/i.exec(String(url || '').trim());
  return m ? m[1] : null;
}

const upsertSpecStmt = () => db.prepare(`
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

/**
 * Insert or refresh one sheet. `s` is the device_specs.json shape:
 * { gsm_url, gsm_name, gsm_brand, ...parseGsmParts() }. Returns its id.
 */
export function upsertSpecSheet(s, now = Date.now()) {
  upsertSpecStmt().run({
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
    storage_options: Array.isArray(s.storage_options) ? s.storage_options.join('/') : (s.storage_options ?? null),
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
  return db.prepare('SELECT id FROM device_specs WHERE source_url=?').get(s.gsm_url).id;
}

/**
 * Point a listing's (brand, model) text at a sheet. A 'manual' mapping is
 * never overwritten by any other kind — a human decision outranks a job.
 * Returns true when the row was written.
 */
export function mapModelToSpec(brand, model, specId, confidence, now = Date.now()) {
  const r = db.prepare(`
    INSERT INTO device_spec_map (brand, model_norm, spec_id, confidence, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(brand, model_norm) DO UPDATE SET
      spec_id=excluded.spec_id, confidence=excluded.confidence
    WHERE device_spec_map.confidence != 'manual' OR excluded.confidence = 'manual'
  `).run(brand, String(model).trim().toLowerCase(), specId, confidence, now);
  return r.changes > 0;
}

/**
 * Devices on live listings that have no sheet yet, most-listed first. This is
 * the nightly pass's work list.
 */
export function devicesMissingSpecs(limit = 50) {
  return db.prepare(`
    SELECT l.brand, l.model, COUNT(*) AS listings, MAX(l.created_at) AS newest
      FROM phone_listings l
      LEFT JOIN device_spec_map m
             ON m.brand = l.brand AND m.model_norm = LOWER(TRIM(l.model))
     WHERE l.status IN ('active','reserved') AND m.spec_id IS NULL
     GROUP BY l.brand, LOWER(TRIM(l.model))
     ORDER BY listings DESC, newest DESC
     LIMIT ?
  `).all(limit);
}
