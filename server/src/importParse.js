// CSV-row → parsed-listing-fields normaliser, used by the Import Queue
// admin flow (routes/admin/index.js POST /admin/import/upload).
//
// The input is a real Facebook-marketplace dump scraped to CSV:
//   Row, User Name, User Profile URL, Phone Number(s), Device Name,
//   Brand, Storage, Price, Price (USD), Location, Image Links,
//   Post Content (Excerpt)
//
// The fields are inconsistent in the way you'd expect from a scrape:
//   - Phone Number(s) may be empty, a single number, or two pipe-
//     separated numbers ("07863557330 | 07733159200").
//   - Storage may be "512", "1تيرا", "1 تيرا", "256/8", or blank.
//   - Price may be "1625", "سعر 1450", "IQD2,025", "25 الف", or blank.
//   - Brand may be missing but the device name carries the hint
//     ("شاومي 17 الترا" → Xiaomi).
//
// We do best-effort parsing here and surface every field as editable
// in the dashboard's Import page, so the admin can fix anything we
// misread before approving.

import { normalizeGovernorate } from './governorates.js';

// Same shape as routes/auth.js normalizePhone — duplicated here so this
// module stays import-cheap (no route-file imports).
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let d = input.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  if (!d.startsWith('0')) d = '0' + d;
  if (d.length < 10 || d.length > 12) return null;
  return d;
}

// Split "07863557330 | 07733159200" → ["07863557330", "07733159200"].
// Returns [primary, whatsapp?] with each entry normalised or null.
export function parsePhones(raw) {
  if (!raw || typeof raw !== 'string') return [null, null];
  const parts = raw.split(/[|,;\/]/).map((s) => normalizePhone(s)).filter(Boolean);
  return [parts[0] || null, parts[1] || null];
}

// "1تيرا" / "1 تيرا" / "تيرا" → "1TB"
// "512" → "512GB"
// "256/8" → "256GB" (drops the RAM part)
// "" → null
export function normalizeStorage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // Match "تيرا" (TB)
  if (/تيرا/.test(s)) {
    const m = s.match(/(\d+)\s*تيرا/);
    return (m ? m[1] : '1') + 'TB';
  }
  // Take the first integer found ("256/8" → 256)
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 16 && n <= 2048) return `${n}GB`;
  return null;
}

// Price normalisation is the trickiest part. The CSV has many variants:
//   "1625"           — bare number, in thousands of IQD → 1,625,000
//   "سعر 1450"        — Arabic "price 1450" → 1,450,000
//   "سعره 1,625,000"  — already in IQD → 1,625,000
//   "IQD2,025"       — IQD 2,025 (but the FB markup actually means
//                       2,025,000 — the platform drops trailing zeroes;
//                       we assume × 1000 when value < 100,000)
//   "25 الف"          — 25 thousand IQD (often the wrong field — actual
//                       price is in description; flag with null)
//   "390"            — 390,000 IQD
//
// Heuristic: extract the first numeric token (with optional thousands
// separators), then:
//   - if ≥ 100_000           → as-is (already in IQD)
//   - if 50 ≤ N ≤ 99_999    → × 1000 (was in thousands of IQD)
//   - if < 50                → null (probably a RAM/storage number)
//
// Returns { value: integer IQD | null, confidence: 'high' | 'low' | 'none' }
export function normalizePrice(raw) {
  if (raw == null) return { value: null, confidence: 'none' };
  const s = String(raw).trim();
  if (!s) return { value: null, confidence: 'none' };
  // Strip thousands separators, take first number.
  const cleaned = s.replace(/[,،]/g, '');
  const m = cleaned.match(/(\d{2,7})/);
  if (!m) return { value: null, confidence: 'none' };
  const n = parseInt(m[1], 10);
  if (n < 50) return { value: null, confidence: 'none' };
  if (n >= 100_000) return { value: n, confidence: 'high' };
  // Looks like thousands. "1450" → 1,450,000.
  return { value: n * 1000, confidence: 'low' };
}

// Take a device-name string + optional Brand column value, return a
// brand we can resolve. Doesn't validate against the DB brands table —
// the route handler does that (and the admin can edit anyway).
//
// Brand-keyword detection prefers an explicit match in the device name
// over the CSV's Brand column, because the column sometimes wrongly
// inherits the group name (everything tagged "Xiaomi" in a Xiaomi group
// even when it's a Huawei post).
const BRAND_KEYWORDS = [
  // Order matters — more specific tokens first.
  ['POCO',     ['poco', 'بوكو']],
  ['Apple',    ['ايفون', 'iphone', 'ipad', 'ايباد', 'apple']],
  ['Samsung',  ['samsung', 'galaxy', 'سامسونك', 'سامسونغ', 'كلكسي', 'كلاكسي', 's21', 's22', 's23', 's24', 's25', 'فولد', 'فلب', 'flip']],
  ['Huawei',   ['huawei', 'هواوي', 'بيورا', 'pura', 'بورا']],
  ['Honor',    ['honor', 'هونر']],
  ['Xiaomi',   ['xiaomi', 'شاومي', 'mi ', 'redmi', 'ريدمي']],
  ['OnePlus',  ['oneplus', 'one plus', 'ون بلاص', 'ون بلس']],
  ['Realme',   ['realme', 'ريلمي']],
  ['OPPO',     ['oppo', 'اوبو', 'فايند']],
  ['Vivo',     ['vivo', 'فيفو']],
  ['Tecno',    ['tecno', 'تكنو']],
  ['Infinix',  ['infinix', 'انفنكس']],
  ['Motorola', ['motorola', 'موتورلا']],
  ['Nokia',    ['nokia', 'نوكيا']],
  ['Google',   ['google pixel', 'pixel', 'بكسل']],
  ['Nubia',    ['nubia', 'نوبيا', 'red magic', 'رد ماجك']],
  ['Oukitel',  ['oukitel', 'اوكيتل', 'أوكيتل', 'اوكتل']],
];
export function detectBrand(deviceName, brandHint) {
  const hay = `${deviceName || ''} ${brandHint || ''}`.toLowerCase();
  for (const [name, kws] of BRAND_KEYWORDS) {
    for (const kw of kws) {
      if (hay.includes(kw.toLowerCase())) return name;
    }
  }
  // Fall back to the CSV's Brand column verbatim if we got nothing.
  if (brandHint && brandHint.trim()) return brandHint.trim();
  return null;
}

// Take the Device Name column and clean it up for use as `model`:
//   - trim
//   - drop trailing junk like "للبيع", "للبيع او مراوس", "جهاز"
//   - cap to 60 chars (route validation rejects longer)
export function cleanModel(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  // Strip trailing common sale/post phrasings
  s = s.replace(/\s+(للبيع|للبيع او مراوس|للبيع أو مراوس|جهاز|مستخدم)\s*$/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > 60) s = s.slice(0, 60);
  return s;
}

// Split "https://x.com/a | https://x.com/b" → [a, b]; filter out blanks.
export function parseImageUrls(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(/[|]/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
}

// Top-level: given a CSV row object with the column names listed at the
// top of this file, return the parsed payload used by the Import Queue.
//
// Any field we couldn't confidently fill comes back as null + a
// `warnings` array describing what was ambiguous. The dashboard surfaces
// the warnings next to the inline-edit form so the operator knows
// what to double-check before approving.
export function parseCsvRow(row) {
  const [phone, whatsapp] = parsePhones(row['Phone Number(s)']);
  const brand = detectBrand(row['Device Name'], row['Brand']);
  const model = cleanModel(row['Device Name']);
  const storage = normalizeStorage(row['Storage']);
  const price = normalizePrice(row['Price']);
  const governorate = normalizeGovernorate(row['Location']);
  const image_urls = parseImageUrls(row['Image Links']);
  const description = (row['Post Content (Excerpt)'] || '').toString().trim().slice(0, 4000);
  const display_name = (row['User Name'] || '').toString().trim() || null;

  const warnings = [];
  if (!phone) warnings.push('no_phone');
  if (!brand) warnings.push('no_brand');
  if (!model) warnings.push('no_model');
  if (!price.value) warnings.push('no_price');
  else if (price.confidence === 'low') warnings.push('price_inferred_thousands');
  if (!governorate) warnings.push('no_governorate');
  // "(SOLD)" markers in the description = already sold; surface as a warning.
  if (/\bSOLD\b/.test(description) || /مبيوع/.test(description)) warnings.push('marked_sold');

  return {
    phone,
    whatsapp,
    display_name,
    brand,
    model,
    storage,
    asking_price: price.value,
    governorate,
    city: null,
    description,
    image_urls,
    warnings,
  };
}
