// The daily device-name pass: catalogue, suggestion queue, new listings.
//
// cleanDeviceNames.js (30 Sep) was the one-off that cleaned the backlog. This
// is what keeps it clean afterwards, once a day, on its own:
//
//   A. device_catalog — rows that entered since the last run by any route
//      other than the GSMArena seed (dashboard approvals, manual adds).
//      Arabic names, a row filed under the wrong brand, and a second
//      spelling of a device the catalogue already holds are removed or
//      moved. Nothing references device_catalog by id, so a delete is safe.
//   B. device_suggestions — the pending "my device isn't in the list"
//      queue, decided where the answer is not a judgement call:
//        · the device is already in the catalogue (the seller spelled it in
//          Arabic, or with the brand in front)  → approved, no new row
//        · GSMArena knows it (tools/gsmarena/gsm_index.json) → added to the
//          catalogue under GSMArena's spelling, approved
//        · an accessory, or a bare brand with no model  → rejected
//      Anything else stays pending for a person. The seller's listing is
//      renamed to the catalogue spelling in the same step.
//   C. phone_listings — every active listing posted since the watermark:
//      brand moved out of the name, then the name resolved to the catalogue
//      spelling with the resolver's guards (family, demotion, leftover).
//      A device GSMArena knows but the catalogue lacks is topped up first.
//
// Runs inside the server (startDeviceNameDaily, from the expirer) at 04:00
// Baghdad, once per calendar day, and catches up after a restart. The
// dashboard can read the last report and trigger a run by hand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSettingValue } from './db.js';
import {
  resolveListingName, stripLeadingBrand, resetCatalogCache, transliterateTokens,
} from './listingNameNormalize.js';
import { invalidateBrandsCache } from './brands.js';

const LISTING_WATERMARK = 'listing_namefix_watermark_id';
const CATALOG_WATERMARK = 'device_catalog_hygiene_watermark_id';
const LAST_REPORT = 'device_names_daily_last';
const LAST_DAY = 'device_names_daily_day';
const RUN_HOUR_BAGHDAD = 4;

const ARABIC = /[؀-ۿ]/;
const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+.]/g, '');

// Not phones/tablets/watches. Same list the one-off cleanup used.
export const ACCESSORY = /(pencil|earbud|freebud|freeclip|freelace|freearc|buds|airpod|earpod|headphone|سماعة|keyboard|كيبورد|\bcase\b|cover|غطاء|charger|شاحن|cable|كيبل|power ?bank|hair dryer|cleaner|photography kit|smart ?pen|stylus|قلم|adapter|محول|\bstand\b|حامل|m-pencil|macbook|laptop|vivobook|katana|surface|e-reader|boox|اکسسوارات|كاميرا)/i;
// "Galaxy Watch8 (44mm)": a size is a variant the seller meant to keep.
const SIZE = /\b\d{2}\s?mm\b/i;

export const typeOf = (m) => (/pad|\btab\b|tablet/i.test(m) ? 'tablet'
  : /watch|\bband\b|\bfit\b/i.test(m) ? 'watch' : 'phone');

// ─── GSMArena index ────────────────────────────────────────────────────
const INDEX_BRAND = {
  apple: 'Apple', samsung: 'Samsung', honor: 'Honor', huawei: 'Huawei', infinix: 'Infinix',
  tecno: 'Tecno', realme: 'Realme', oppo: 'OPPO', vivo: 'Vivo', google: 'Google',
  motorola: 'Motorola', oneplus: 'OnePlus', itel: 'Itel', oukitel: 'Oukitel',
  blackview: 'Blackview', nokia: 'Nokia', lenovo: 'Lenovo',
};
let GSM = null;
function indexKeys(model) {
  const k = keyOf(model);
  const sh = (/^(.+?)(5g|4g)$/.exec(k) || [])[1];
  return new Set([k, k.replace(/\+/g, 'plus'), k.replace(/plus/g, '+'), k.replace(/\./g, ''), sh].filter(Boolean));
}
function gsmIndex() {
  if (GSM) return GSM;
  GSM = new Map();
  const file = process.env.GSM_INDEX_PATH
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/gsmarena/gsm_index.json');
  if (!fs.existsSync(file)) return GSM;
  const idx = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Keys that two different devices share ("Note 14 Pro 4G" and "5G" both
  // shave to "note14pro") are poisoned: guessing between them is a wrong
  // device. The exact key of each spelling always wins over a shaved one.
  const AMBIG = Symbol('ambiguous');
  const shaved = new Map();
  const put = (brand, model, full = model) => {
    const exact = keyOf(model);
    for (const v of indexKeys(model)) {
      const k = `${brand}|${v}`;
      if (v === exact) { if (!GSM.has(k)) GSM.set(k, full); continue; }
      const cur = shaved.get(k);
      if (cur === undefined) shaved.set(k, full);
      else if (cur !== full) shaved.set(k, AMBIG);
    }
  };
  for (const [gb, devices] of Object.entries(idx)) {
    for (const name of Object.keys(devices)) {
      let brand = INDEX_BRAND[gb];
      let model = name;
      if (gb === 'xiaomi') {
        const m = /^(Poco|Redmi)\s+(.+)$/i.exec(name);
        if (m) { brand = m[1].toLowerCase() === 'poco' ? 'POCO' : 'Redmi'; model = m[2]; } else brand = 'Xiaomi';
      } else if (gb === 'zte') {
        const m = /^nubia\s+(.+)$/i.exec(name);
        if (!m) continue;
        brand = 'Nubia'; model = m[1];
      }
      if (!brand) continue;
      put(brand, model);
      // Sellers drop the line word ("Galaxy A07" → "A07"); the key without
      // it still answers with the full name.
      const parts = model.split(/\s+/);
      if (parts.length > 1 && /^(galaxy|iphone|ipad|moto|pixel)$/i.test(parts[0])) put(brand, parts.slice(1).join(' '), model);
    }
  }
  for (const [k, model] of shaved) if (model !== AMBIG && !GSM.has(k)) GSM.set(k, model);
  return GSM;
}
/** For tests: point at a different index. */
export function resetGsmIndex() { GSM = null; }

/** GSMArena spelling of what the seller typed, or null. Arabic is transliterated first. */
export function inGsmIndex(brand, model) {
  const idx = gsmIndex();
  // Arabic is transliterated, never keyed as-is: keyOf drops the Arabic and
  // "ايفون 7 بلس" would key as "7".
  const text = ARABIC.test(model)
    ? transliterateTokens(model).filter((x) => x.toLowerCase() !== brand.toLowerCase()).join(' ')
    : model;
  if (ARABIC.test(text)) return null; // words the dictionary doesn't know
  const k = keyOf(text);
  return k && /\d/.test(k) ? idx.get(`${brand}|${k}`) || null : null;
}

// ─── catalogue helpers ─────────────────────────────────────────────────
const available = () => new Set(db.prepare('SELECT name FROM brands').all().map((r) => r.name));
const catalogCI = (brand, model) => db.prepare(
  'SELECT id, brand, model, device_type FROM device_catalog WHERE brand=? AND model=? COLLATE NOCASE AND is_active=1 LIMIT 1',
).get(brand, model);

/**
 * Is (brand, model) a second spelling of a catalogue device? Resolved with
 * the catalogue minus the row itself, so a row never "duplicates" itself.
 */
function duplicateOf(row) {
  const rows = db.prepare(
    'SELECT brand, model FROM device_catalog WHERE is_active=1 AND id<>?',
  ).all(row.id);
  const set = new Set();
  for (const r of rows) {
    if (r.brand !== row.brand) continue;
    for (const k of indexKeys(r.model)) set.add(k);
    const parts = r.model.split(/\s+/);
    if (parts.length > 1 && /^(galaxy|iphone|ipad|moto|pixel|redmi|poco)$/i.test(parts[0])) {
      for (const k of indexKeys(parts.slice(1).join(' '))) set.add(k);
    }
  }
  for (const k of indexKeys(row.model)) if (set.has(k)) {
    return rows.find((r) => r.brand === row.brand && [...indexKeys(r.model)].includes(k))?.model
      || rows.find((r) => r.brand === row.brand && keyOf(r.model).endsWith(k))?.model || '(same key)';
  }
  return null;
}

/**
 * Where a catalogue candidate (from a suggestion or a listing) should land.
 * @returns {{action:'existing'|'insert'|'reject'|'undecided', brand, model, device_type?, note}}
 */
export function decideDevice(brand0, model0, type0, AVAILABLE = available()) {
  const raw = String(model0 || '').trim();
  const st = stripLeadingBrand(raw, AVAILABLE);
  const brand = st.brand || brand0;
  const model = st.model;
  if (ACCESSORY.test(raw)) return { action: 'reject', brand, model, note: 'ليس جهازاً (اكسسوار)' };

  const exact = catalogCI(brand, model);
  if (exact) return { action: 'existing', brand: exact.brand, model: exact.model, device_type: exact.device_type, note: 'موجود في الكتالوج' };

  const r = resolveListingName(brand, model);
  if (r.model) {
    const row = catalogCI(r.brand, r.model);
    return { action: 'existing', brand: r.brand, model: r.model, device_type: row?.device_type || type0, note: `موجود باسم ${r.model}` };
  }

  const hit = inGsmIndex(brand, model);
  if (hit && AVAILABLE.has(brand)) {
    // "Y6" when the catalogue holds "Y6 (2018)": the bare GSMArena name is a
    // different (older) device than the one the seller has.
    const yearClash = db.prepare(
      "SELECT 1 FROM device_catalog WHERE brand=? AND model LIKE ? AND is_active=1 LIMIT 1",
    ).get(brand, `${hit} (%`);
    // The catalogue already holds this device under a network suffix the
    // seller left off ("Note 14 Pro" beside "Note 14 Pro 4G" and "5G"):
    // the resolver refused on purpose, so don't add a third spelling.
    const shave = (x) => keyOf(x).replace(/(5g|4g)$/, '');
    const sibling = db.prepare('SELECT model FROM device_catalog WHERE brand=? AND is_active=1').all(brand)
      .some((r) => shave(r.model) === shave(hit) || shave(r.model) === shave(model));
    if (!yearClash && !sibling) {
      return { action: 'insert', brand, model: hit, device_type: typeOf(hit), note: 'أُضيف من GSMArena' };
    }
  }

  // Nothing but brand/line words — no model number to add.
  const tokens = transliterateTokens(model);
  if (!tokens.some((t) => /\d/.test(t)) && tokens.length <= 1) {
    return { action: 'reject', brand, model, note: 'ما فيه اسم جهاز' };
  }
  return { action: 'undecided', brand, model, note: '' };
}

function insertCatalog(brand, model, type, t, source = 'daily') {
  db.prepare(
    `INSERT OR IGNORE INTO device_catalog(brand, device_type, model, source, created_at)
     VALUES(?,?,?,?,?)`,
  ).run(brand, type, model, source, t);
  resetCatalogCache();
}

// ─── the pass ──────────────────────────────────────────────────────────
export function runDeviceNameDaily({ apply = true, now = Date.now(), backupDir } = {}) {
  const AVAILABLE = available();
  const report = {
    ran_at: now, apply,
    catalog: { removed: [], moved: [] },
    suggestions: { approved: [], added: [], rejected: [], pending: [] },
    listings: { scanned: 0, renamed: [], added: [], unresolved: 0 },
  };
  const backup = { catalog: [], suggestions: [], listings: [] };

  const tx = db.transaction(() => {
    // ── A. catalogue rows added since last run ──
    const catMark = Number(getSetting(CATALOG_WATERMARK) || 0);
    const newRows = db.prepare(
      `SELECT * FROM device_catalog WHERE id > ? AND source <> 'gsmarena' ORDER BY id`,
    ).all(catMark);
    for (const row of newRows) {
      let why = null;
      let move = null;
      if (ARABIC.test(row.model)) why = 'اسم عربي';
      else {
        const st = stripLeadingBrand(row.model, AVAILABLE);
        if (st.brand && (st.brand !== row.brand || st.model !== row.model)) {
          move = { brand: st.brand, model: st.model };
          if (catalogCI(move.brand, move.model)) { why = `موجود: ${move.brand} ${move.model}`; move = null; }
        } else {
          const dup = duplicateOf(row);
          if (dup) why = `مكرر: ${dup}`;
        }
      }
      if (why) {
        backup.catalog.push(row);
        report.catalog.removed.push({ id: row.id, brand: row.brand, model: row.model, why });
        if (apply) db.prepare('DELETE FROM device_catalog WHERE id=?').run(row.id);
      } else if (move) {
        backup.catalog.push(row);
        report.catalog.moved.push({ id: row.id, from: `${row.brand} ${row.model}`, to: `${move.brand} ${move.model}` });
        if (apply) db.prepare('UPDATE device_catalog SET brand=?, model=? WHERE id=?').run(move.brand, move.model, row.id);
      }
    }
    resetCatalogCache();
    const maxCat = db.prepare('SELECT MAX(id) AS m FROM device_catalog').get().m || catMark;

    // ── B. suggestion queue ──
    const renameListing = db.prepare('UPDATE phone_listings SET brand=?, model=?, updated_at=? WHERE id=?');
    const pending = db.prepare(
      `SELECT s.*, COALESCE(s.listing_id,
         (SELECT id FROM phone_listings WHERE seller_id=s.user_id AND model=s.model COLLATE NOCASE
           ORDER BY created_at DESC LIMIT 1)) AS lid
         FROM device_suggestions s WHERE s.status='pending' ORDER BY s.id`,
    ).all();
    for (const s of pending) {
      const d = decideDevice(s.brand, s.model, s.device_type, AVAILABLE);
      const item = { id: s.id, from: `${s.brand} ${s.model}`, to: `${d.brand} ${d.model}`, note: d.note };
      if (d.action === 'undecided') { report.suggestions.pending.push(item); continue; }
      backup.suggestions.push(s);
      if (d.action === 'reject') {
        report.suggestions.rejected.push(item);
        if (apply) {
          db.prepare("UPDATE device_suggestions SET status='rejected', reviewed_at=?, note=? WHERE id=?")
            .run(now, `تلقائي: ${d.note}`, s.id);
        }
        continue;
      }
      if (d.action === 'insert') {
        report.suggestions.added.push(item);
        if (apply) insertCatalog(d.brand, d.model, d.device_type, now, 'suggestion');
      } else {
        report.suggestions.approved.push(item);
      }
      if (apply) {
        db.prepare(
          "UPDATE device_suggestions SET status='approved', reviewed_at=?, brand=?, model=?, device_type=?, note=? WHERE id=?",
        ).run(now, d.brand, d.model, d.device_type || s.device_type, `تلقائي: ${d.note}`, s.id);
        if (s.lid) {
          const l = db.prepare("SELECT id, brand, model FROM phone_listings WHERE id=? AND status IN ('active','reserved')").get(s.lid);
          if (l && (l.brand !== d.brand || l.model !== d.model)) {
            backup.listings.push(l);
            renameListing.run(d.brand, d.model, now, l.id);
          }
        }
      }
    }

    // ── C. listings since the watermark ──
    const lMark = Number(getSetting(LISTING_WATERMARK) || 0);
    const listings = db.prepare(
      `SELECT id, brand, model, product_type FROM phone_listings
        WHERE status IN ('active','reserved') AND id > ? ORDER BY id LIMIT 5000`,
    ).all(lMark);
    report.listings.scanned = listings.length;
    for (const l of listings) {
      const raw = String(l.model || '').trim();
      const st = stripLeadingBrand(raw, AVAILABLE);
      let brand = st.brand || l.brand;
      let model = st.model;
      const skip = l.product_type === 'accessory' || ACCESSORY.test(raw) || SIZE.test(raw);
      if (!skip && !catalogCI(brand, model)) {
        const r = resolveListingName(brand, model);
        if (r.model) { brand = r.brand; model = r.model; } else {
          const d = decideDevice(brand, model, 'phone', AVAILABLE);
          if (d.action === 'insert') {
            report.listings.added.push({ id: l.id, device: `${d.brand} ${d.model}` });
            if (apply) insertCatalog(d.brand, d.model, d.device_type, now, 'daily');
            brand = d.brand; model = d.model;
          } else if (d.action !== 'existing') {
            report.listings.unresolved++;
          }
        }
      }
      if (brand !== l.brand || model !== raw) {
        backup.listings.push(l);
        report.listings.renamed.push({ id: l.id, from: `${l.brand} ${raw}`, to: `${brand} ${model}` });
        if (apply) renameListing.run(brand, model, now, l.id);
      }
    }
    const maxL = listings.length ? listings[listings.length - 1].id : lMark;

    if (apply) {
      setSettingValue(LISTING_WATERMARK, maxL);
      setSettingValue(CATALOG_WATERMARK, Math.max(maxCat, db.prepare('SELECT MAX(id) AS m FROM device_catalog').get().m || 0));
    }
  });
  tx();
  resetCatalogCache();
  invalidateBrandsCache();

  const touched = backup.catalog.length + backup.suggestions.length + backup.listings.length;
  if (apply && touched && backupDir) {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(backupDir, `device-names-${stamp}.json`), JSON.stringify(backup));
    } catch (e) { console.error('[device-names] backup failed', e?.message); }
  }

  report.summary = {
    catalog_removed: report.catalog.removed.length,
    catalog_moved: report.catalog.moved.length,
    suggestions_approved: report.suggestions.approved.length,
    suggestions_added: report.suggestions.added.length,
    suggestions_rejected: report.suggestions.rejected.length,
    suggestions_left: report.suggestions.pending.length,
    listings_scanned: report.listings.scanned,
    listings_renamed: report.listings.renamed.length,
    catalog_topped_up: report.listings.added.length,
  };
  if (apply) setSettingValue(LAST_REPORT, JSON.stringify(report));
  return report;
}

export function lastDeviceNameReport() {
  try { return JSON.parse(getSetting(LAST_REPORT) || 'null'); } catch { return null; }
}

// ─── schedule ──────────────────────────────────────────────────────────
const baghdad = (t) => new Date(t + 3 * 60 * 60 * 1000); // Iraq has no DST
export function dueToday(t, lastDay) {
  const b = baghdad(t);
  const day = b.toISOString().slice(0, 10);
  return b.getUTCHours() >= RUN_HOUR_BAGHDAD && lastDay !== day ? day : null;
}

export function startDeviceNameDaily() {
  const backupDir = path.resolve(process.cwd(), 'data', 'backups');
  const check = () => {
    try {
      const day = dueToday(Date.now(), getSetting(LAST_DAY));
      if (!day) return;
      setSettingValue(LAST_DAY, day);
      const r = runDeviceNameDaily({ apply: true, backupDir });
      console.log('[device-names] daily pass', JSON.stringify(r.summary));
    } catch (e) {
      console.error('[device-names] daily pass failed', e?.message);
    }
  };
  setTimeout(check, 5 * 60 * 1000);
  setInterval(check, 30 * 60 * 1000);
}
