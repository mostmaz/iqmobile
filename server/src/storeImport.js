// Bulk device / price import for the house store from an Excel sheet.
//
// One sheet, two behaviours per row, decided by what exists:
//   - row matches an existing listing (brand+model+storage, color-aware)
//     → its price is UPDATED (and a price-on-request listing that finally
//       got a price becomes a normal purchasable product);
//   - no match → a new listing is CREATED under the house storefront.
// prices_only mode suppresses creation (a pure price update run).
//
// Pre-orders: a row with NO price (empty, 0, or "قريبا/حجز/preorder") is
// legal — it imports as price_on_request (the app shows "السعر عند الطلب —
// اتصل بنا"), and the moment a later sheet carries its price the same
// upsert turns it into a normal priced product. A priceless row matching a
// listing that ALREADY has a price never wipes it (announcing stock again
// must not delete a price).
//
// Header names accept Arabic or English (الماركة/Brand, الموديل/Model,
// السعة/Storage, اللون/Color, السعر/Price, الحالة/Condition, ملاحظات/Note).
// Prices accept Arabic-Indic digits, thousands separators, and the local
// "603 means 603,000" shorthand (numbers < 10,000 are ×1000).

import * as XLSX from 'xlsx';
import { db, now, getSetting } from './db.js';
import { houseShopId } from './storefrontCard.js';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const latinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

const HEADER_MAP = {
  'الماركة': 'brand', 'العلامة': 'brand', brand: 'brand',
  'الموديل': 'model', 'الجهاز': 'model', model: 'model', device: 'model',
  'السعة': 'storage', 'الذاكرة': 'storage', storage: 'storage',
  'اللون': 'color', color: 'color',
  'السعر': 'price', price: 'price',
  'الحالة': 'condition', condition: 'condition',
  'ملاحظات': 'note', 'الوصف': 'note', note: 'note', description: 'note',
};

function normStorage(v) {
  if (v == null || v === '') return null;
  let s = latinDigits(String(v)).trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d+$/.test(s)) s = Number(s) >= 1000 ? `${Number(s) / 1000}TB` : `${s}GB`;
  if (/^\d+(GB|TB)$/.test(s)) return s;
  return String(v).trim() || null;
}

const PREORDER_WORDS = /قريب|حجز|طلب|preorder|pre-order|soon|tbd/i;
function normPrice(v) {
  if (v == null || v === '') return { price: null, preorder: true };
  const raw = latinDigits(String(v)).replace(/[,\s]/g, '');
  if (!raw || PREORDER_WORDS.test(String(v))) return { price: null, preorder: true };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { price: null, preorder: true };
  // Local shorthand: "603" on a price list means 603,000 IQD.
  return { price: n < 10000 ? n * 1000 : Math.round(n), preorder: false };
}

export function parseSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], errors: ['empty_workbook'] };
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const rows = [];
  const errors = [];
  raw.forEach((r, i) => {
    const mapped = {};
    for (const [k, v] of Object.entries(r)) {
      const key = HEADER_MAP[String(k).trim().toLowerCase()] || HEADER_MAP[String(k).trim()];
      if (key && mapped[key] == null) mapped[key] = v;
    }
    const brand = String(mapped.brand || '').trim();
    const model = String(mapped.model || '').trim();
    if (!brand && !model) return; // blank/decoration row
    if (!brand || !model) { errors.push(`سطر ${i + 2}: الماركة والموديل مطلوبان`); return; }
    const { price, preorder } = normPrice(mapped.price);
    rows.push({
      line: i + 2,
      brand, model,
      storage: normStorage(mapped.storage),
      color: String(mapped.color || '').trim() || null,
      price, preorder,
      condition: String(mapped.condition || '').trim() || 'new',
      note: String(mapped.note || '').trim() || null,
    });
  });
  return { rows, errors };
}

export function planImport(rows, { pricesOnly = false, shopId: shopIdArg } = {}) {
  const shopId = shopIdArg || houseShopId();
  if (!shopId) return { error: 'no_house_shop' };
  const findExact = db.prepare(
    `SELECT id, asking_price, price_on_request FROM phone_listings
      WHERE seller_id=? AND status='active'
        AND LOWER(brand)=LOWER(?) AND LOWER(model)=LOWER(?)
        AND COALESCE(storage,'')=COALESCE(?, '') AND COALESCE(color,'')=COALESCE(?, '')`,
  );
  const findByStorage = db.prepare(
    `SELECT id, asking_price, price_on_request, color FROM phone_listings
      WHERE seller_id=? AND status='active'
        AND LOWER(brand)=LOWER(?) AND LOWER(model)=LOWER(?)
        AND COALESCE(storage,'')=COALESCE(?, '')`,
  );
  const plan = [];
  for (const row of rows) {
    // Color-exact match wins; otherwise all colour variants of the same
    // brand+model+storage get the row's price (lists rarely price colours).
    const exact = row.color ? findExact.get(shopId, row.brand, row.model, row.storage, row.color) : null;
    const matches = exact ? [exact] : findByStorage.all(shopId, row.brand, row.model, row.storage);
    if (matches.length) {
      if (row.preorder) {
        const priced = matches.filter((m) => !m.price_on_request);
        plan.push({ ...row, action: priced.length ? 'skip_priceless' : 'noop', ids: matches.map((m) => m.id) });
      } else {
        const toChange = matches.filter((m) => m.price_on_request || m.asking_price !== row.price);
        plan.push({
          ...row,
          action: toChange.length ? 'update_price' : 'unchanged',
          ids: toChange.map((m) => m.id),
          old_prices: [...new Set(matches.map((m) => (m.price_on_request ? 'اتصل للسعر' : m.asking_price)))],
        });
      }
    } else if (pricesOnly) {
      plan.push({ ...row, action: 'no_match', ids: [] });
    } else {
      plan.push({ ...row, action: row.preorder ? 'create_preorder' : 'create', ids: [] });
    }
  }
  return { shopId, plan };
}

export function applyImport(plan, shopId) {
  const t = now();
  const TTL_MS = (Number(getSetting('listing_ttl_days')) || 30) * 24 * 60 * 60 * 1000;
  const upd = db.prepare(
    'UPDATE phone_listings SET asking_price=?, price_on_request=0, updated_at=? WHERE id=?',
  );
  const ins = db.prepare(`
    INSERT INTO phone_listings(
      seller_id, brand, model, storage, color, condition,
      battery_health, warranty_status, accessories_json, asking_price,
      governorate, city, description, status,
      contact_phone, contact_whatsapp, price_on_request,
      created_at, expires_at, updated_at
    ) VALUES(?,?,?,?,?,?,NULL,NULL,'[]',?,?,NULL,?, 'active', NULL, NULL, ?, ?, ?, ?)
  `);
  let updated = 0; let created = 0; let preorders = 0;
  db.transaction(() => {
    for (const p of plan) {
      if (p.action === 'update_price') {
        for (const id of p.ids) { upd.run(p.price, t, id); updated++; }
      } else if (p.action === 'create' || p.action === 'create_preorder') {
        const pre = p.action === 'create_preorder';
        ins.run(
          shopId, p.brand, p.model, p.storage, p.color,
          ['new', 'used', 'refurbished', 'repaired'].includes(p.condition) ? p.condition : 'new',
          pre ? 1 : p.price, 'Baghdad', p.note, pre ? 1 : 0,
          t, t + TTL_MS, t,
        );
        created++;
        if (pre) preorders++;
      }
    }
  })();
  return { updated, created, preorders };
}
