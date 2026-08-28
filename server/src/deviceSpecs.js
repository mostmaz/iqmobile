// Spec sheet lookup for a listing.
//
// A listing carries free-text brand/model; device_spec_map holds the exact
// (brand, model) strings the importer resolved, so this is a plain equality
// lookup. Deliberately so: the matching is hard (Arabic, "+" vs "Plus",
// Apple's generations vs GSMArena's model years) and lives in one place —
// tools/gsmarena — instead of being reimplemented here where the two copies
// would quietly drift apart.
//
// A model nobody has mapped yet simply returns null and the app shows
// nothing. That is the right failure: an empty spec block costs a shopper
// nothing, a wrong one costs them a purchase.
import { db } from './db.js';

const SELECT = `
  SELECT s.* FROM device_spec_map m
    JOIN device_specs s ON s.id = m.spec_id
   WHERE m.brand = ? AND m.model_norm = LOWER(TRIM(?))
`;

/** First sensor's megapixels — "108 MP, f/1.8, (wide)..." -> 108. */
function leadMp(modules) {
  const m = /(\d+(?:\.\d+)?)\s*MP/.exec(String(modules || ''));
  return m ? Number(m[1]) : null;
}

/**
 * The spec sheet for a listing, shaped for the app, or null.
 *
 * Numbers stay numbers — the app formats them with Arabic digits and its own
 * units, and a spec strip that has to parse "6.7 inches" out of prose is one
 * locale change away from breaking.
 */
export function specsFor(brand, model) {
  if (!brand || !model) return null;
  const s = db.prepare(SELECT).get(brand, model);
  if (!s) return null;

  const out = {
    device: s.source_name,
    display_inches: s.display_inches,
    display_type: s.display_type,
    display_resolution: s.display_resolution,
    chipset: s.chipset,
    cpu: s.cpu,
    ram_gb: s.ram_gb,                       // "8" or "8/12"
    storage_options: s.storage_options,
    battery_mah: s.battery_mah,
    charge_w: s.charge_w,                   // wired only — see the scraper
    charge_w_wireless: s.charge_w_wireless,
    camera_main_mp: leadMp(s.camera_main),
    camera_main: s.camera_main,
    camera_selfie_mp: leadMp(s.camera_selfie),
    camera_selfie: s.camera_selfie,
    os: s.os,
    announced: s.announced,
    source: 'GSMArena',
  };
  // Nothing worth rendering means nothing to send.
  const any = out.display_inches || out.chipset || out.ram_gb
    || out.battery_mah || out.camera_main_mp;
  return any ? out : null;
}
