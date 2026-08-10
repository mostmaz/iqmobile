// Resolve a free-text listing model name to a real device in the catalogue.
//
// Sellers type whatever they like into the model box. A third of live
// listings hold Arabic, and often the entire ad:
//
//   "ايفون 16 برو ماكس ذاكره 256 بطاريه 98"
//   "السلام عليكم عندي جهاز انفنكس سمارت 10 الذاكره 64 جهاز حيل نظيف"
//
// The Arabic IS the device name, so it must be transliterated, never
// deleted — dropping it turns "ايفون 11 برو ماكس" into "11", and keying on
// what's left merges iPhone 13, 13 Pro and 13 Pro Max into one device.
//
// Rather than blacklist the endless tail of ad words (نظيف، للبيع، ذاكره،
// بطاريه…), this WHITELISTS: transliterate, then look for the longest
// catalogue model that appears as a run of consecutive tokens. Ad noise
// simply never matches, so it needs no vocabulary of its own.

import { db } from './db.js';

const AR_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

function normalizeArabic(s) {
  return s
    .replace(/[ـً-ْ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');
}

// Extends the search dictionary in searchNormalize.js with the product-LINE
// vocabulary that only shows up in listing titles. Kept separate because
// search wants loose recall while this wants a defensible rename.
const DICT = {
  // brands
  'سامسونج': 'samsung', 'سامسونغ': 'samsung', 'سمسونج': 'samsung', 'سامسونك': 'samsung', 'سامسونگ': 'samsung',
  'ايفون': 'iphone', 'ايفونن': 'iphone', 'اايفون': 'iphone', 'ابل': 'apple', 'آيفون': 'iphone',
  'شاومي': 'xiaomi', 'شياومي': 'xiaomi', 'اكسياومي': 'xiaomi',
  'ريدمي': 'redmi', 'بوكو': 'poco',
  'هواوي': 'huawei', 'هاواوي': 'huawei',
  'اوبو': 'oppo', 'فيفو': 'vivo',
  'ريلمي': 'realme', 'ريلمى': 'realme',
  'تكنو': 'tecno', 'تيكنو': 'tecno', 'التكنو': 'tecno',
  'انفنكس': 'infinix', 'انفينكس': 'infinix', 'انفينيكس': 'infinix', 'انفكس': 'infinix',
  'هونر': 'honor', 'اونر': 'honor',
  'نوكيا': 'nokia', 'موتورولا': 'motorola', 'موترلا': 'motorola', 'موتو': 'moto',
  'جوجل': 'google', 'غوغل': 'google', 'قوقل': 'google', 'ايتل': 'itel', 'سوني': 'sony',
  // product lines
  'جالكسي': 'galaxy', 'جالاكسي': 'galaxy', 'غالاكسي': 'galaxy', 'غالكسي': 'galaxy', 'جلكسي': 'galaxy',
  'ماجك': 'magic', 'ماجيك': 'magic',
  'سبارك': 'spark', 'سبارت': 'spark', 'سبارك': 'spark',
  'كامون': 'camon', 'كمون': 'camon', 'كومون': 'camon',
  'بوفا': 'pova', 'بوغا': 'pova',
  'هوت': 'hot', 'سمارت': 'smart', 'نوفا': 'nova', 'ميت': 'mate',
  'ايباد': 'ipad', 'ايبود': 'ipod', 'بكسل': 'pixel', 'بيكسل': 'pixel',
  'ريدمي': 'redmi', 'دركسون': 'dragon',
  'نوت': 'note', 'برو': 'pro', 'بروماكس': 'promax', 'برور': 'pro',
  'ماكس': 'max', 'مكس': 'max', 'بلس': 'plus', 'بلاس': 'plus',
  'الترا': 'ultra', 'ميني': 'mini', 'مني': 'mini', 'لايت': 'lite',
  'فولد': 'fold', 'فليب': 'flip', 'اير': 'air', 'ايير': 'air',
  'ساعه': 'watch', 'ساعة': 'watch', 'واتش': 'watch',
  'جيل': 'gen', 'اس': 's', 'ايه': 'a', 'سي': 'c', 'ام': 'm', 'اكس': 'x',
  'زد': 'z', 'كي': 'k', 'جي': 'g', 'تي': 't', 'واي': 'y',
  'ار': 'r', 'دي': 'd', 'اف': 'f', 'اتش': 'h', 'ان': 'n', 'يو': 'u',
  'وان': 'one', 'ون': 'one',
  // spelled-out numbers ("تكنو بوفا سفن الترا" = Pova 7 Ultra)
  'سفن': '7', 'ايت': '8', 'ناين': '9', 'تن': '10', 'سكس': '6', 'فايف': '5',
};

// Leading words that name the line, not the device — safe to alias away.
const LINE_WORDS = new Set(['galaxy', 'iphone', 'ipad', 'redmi', 'poco', 'honor', 'huawei',
  'xiaomi', 'samsung', 'apple', 'tecno', 'infinix', 'realme', 'oppo', 'vivo', 'nokia',
  'motorola', 'itel', 'google', 'pixel']);

const BRAND_WORDS = {
  iphone: 'Apple', apple: 'Apple', ipad: 'Apple',
  samsung: 'Samsung', galaxy: 'Samsung',
  xiaomi: 'Xiaomi', redmi: 'Redmi', poco: 'POCO',
  huawei: 'Huawei', honor: 'Honor', oppo: 'OPPO', vivo: 'Vivo',
  realme: 'Realme', tecno: 'Tecno', infinix: 'Infinix',
  nokia: 'Nokia', motorola: 'Motorola', moto: 'Motorola',
  google: 'Google', pixel: 'Google', itel: 'Itel', oneplus: 'OnePlus',
};

const mapToken = (t) => DICT[t] || (t.length > 3 && t.startsWith('ال') && DICT[t.slice(2)]) || t;

/** Raw model text → lowercase Latin tokens, ad noise included but harmless. */
export function transliterateTokens(raw) {
  let s = String(raw || '').slice(0, 300);
  s = s.replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] || d);
  // Directional marks and NBSP arrive pasted from other apps and would
  // otherwise glue themselves onto a token.
  s = s.replace(/[‎‏⁦-⁩ ]/g, ' ');
  s = normalizeArabic(s);
  s = s.replace(/([؀-ۿ])(\d)/g, '$1 $2').replace(/(\d)([؀-ۿ])/g, '$1 $2');
  return s
    .split(/[\s،,._\-/\\()[\]]+/)
    .filter(Boolean)
    .map((t) => mapToken(t.toLowerCase()))
    .filter(Boolean);
}

const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+.]/g, '');

// The catalogue writes "Realme 14 Pro+" but also "Infinix Smart 10 Plus", and
// a seller typing "بلاس" transliterates to "plus" either way. Index both
// spellings so the notation the catalogue happens to use never decides
// whether a device is found.
function keyAliases(model) {
  const k = keyOf(model);
  const out = new Set([k]);
  if (k.includes('+')) out.add(k.replace(/\+/g, 'plus'));
  if (k.includes('plus')) out.add(k.replace(/plus/g, '+'));
  return [...out];
}

let CATALOG = null;
function catalog() {
  if (CATALOG) return CATALOG;
  CATALOG = new Map();
  const rows = db.prepare(
    'SELECT brand, model FROM device_catalog WHERE is_active=1',
  ).all();
  for (const row of rows) {
    if (!CATALOG.has(row.brand)) CATALOG.set(row.brand, new Map());
    const m = CATALOG.get(row.brand);
    const put = (k) => {
      if (!k) return;
      // Longest spelling wins when two catalogue rows share a key.
      const cur = m.get(k);
      if (!cur || row.model.length > cur.length) m.set(k, row.model);
    };
    for (const k of keyAliases(row.model)) put(k);
    // Sellers drop the line word: they write "A04e", the catalogue says
    // "Galaxy A04e". Index the tail too, within the brand.
    const parts = String(row.model).trim().split(/\s+/);
    if (parts.length > 1 && LINE_WORDS.has(parts[0].toLowerCase())) {
      for (const k of keyAliases(parts.slice(1).join(' '))) put(k);
    }
  }
  return CATALOG;
}
export function resetCatalogCache() { CATALOG = null; }

/**
 * Resolve one listing's name against the catalogue.
 * @returns {{model:string|null, brand:string|null, confidence:'exact'|'brand-fixed'|'none', tokens:string[]}}
 */
export function resolveListingName(brand, rawModel) {
  const tokens = transliterateTokens(rawModel);
  if (!tokens.length) return { model: null, brand: null, confidence: 'none', tokens };

  // A name that starts "تكنو بوفا…" under brand Apple is mis-branded; trust
  // the words the seller wrote over the dropdown they fumbled.
  let namedBrand = null;
  for (const t of tokens) {
    if (BRAND_WORDS[t]) { namedBrand = BRAND_WORDS[t]; break; }
  }
  const searchBrands = [];
  if (namedBrand) searchBrands.push(namedBrand);
  if (brand && brand !== namedBrand) searchBrands.push(brand);

  for (const b of searchBrands) {
    const models = catalog().get(b);
    if (!models) continue;
    // Longest run of consecutive tokens that IS a catalogue model. Longest
    // wins so "13 pro max" beats the "13" nested inside it — the whole
    // reason a naive strip-and-group merges three different iPhones.
    let best = null;
    for (let i = 0; i < tokens.length; i++) {
      for (let n = Math.min(6, tokens.length - i); n >= 1; n--) {
        const k = keyOf(tokens.slice(i, i + n).join(''));
        if (!k) continue;
        const hit = models.get(k);
        if (hit && (!best || k.length > best.key.length)) best = { key: k, model: hit };
      }
    }
    if (best) {
      return {
        model: best.model,
        brand: b,
        confidence: b === brand ? 'exact' : 'brand-fixed',
        tokens,
      };
    }
  }
  return { model: null, brand: null, confidence: 'none', tokens };
}

/**
 * Catalogue suggestions for free text a seller typed into the device picker.
 *
 * The picker's literal LIKE can only match Latin, so "ايفون 13 برو ماكس"
 * returns nothing and the seller is handed "use what I typed" — which is how
 * a third of live listings ended up with an Arabic sentence in the model
 * field. This transliterates first and then scores catalogue rows by how
 * many of the typed tokens they contain, so the same input comes back as
 * "iPhone 13 Pro Max".
 *
 * Ranked, not resolved: this feeds a list the seller chooses from, so a
 * near-miss is useful here in a way it would not be for an automatic rename.
 */
export function suggestFromText(brand, raw, deviceType = 'phone', limit = 20) {
  const tokens = transliterateTokens(raw);
  if (!tokens.length) return [];

  // Words that carry no model information — every phone is a "phone".
  const NOISE = new Set(['phone', 'mobile', 'apple', 'iphone', 'samsung', 'galaxy',
    'xiaomi', 'redmi', 'poco', 'honor', 'huawei', 'oppo', 'vivo', 'realme',
    'tecno', 'infinix', 'itel', 'nokia', 'motorola', 'google', 'pixel', 'ipad']);
  const useful = tokens.filter((t) => !NOISE.has(t));
  const needles = (useful.length ? useful : tokens).map((t) => t.toLowerCase());

  const rows = db.prepare(
    `SELECT id, model FROM device_catalog
      WHERE brand=? AND device_type=? AND is_active=1`,
  ).all(brand, deviceType);

  const scored = [];
  for (const row of rows) {
    const hay = keyOf(row.model);
    let hits = 0;
    for (const n of needles) if (hay.includes(keyOf(n))) hits++;
    if (!hits) continue;
    // Prefer rows that matched more of what was typed, then shorter names —
    // "13" alone should offer "iPhone 13" ahead of "iPhone 13 Pro Max".
    scored.push({ id: row.id, model: row.model, hits, len: row.model.length });
  }
  scored.sort((a, b) => (b.hits - a.hits) || (a.len - b.len) || a.model.localeCompare(b.model));
  return scored.slice(0, limit).map(({ id, model }) => ({ id, model }));
}
