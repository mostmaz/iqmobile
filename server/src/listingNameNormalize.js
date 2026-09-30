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
import { AR_DIGITS, normalizeArabic, mapDeviceToken } from './arabicDeviceTerms.js';

// Leading words that name the line, not the device — safe to alias away.
const LINE_WORDS = new Set(['galaxy', 'iphone', 'ipad', 'redmi', 'poco', 'honor', 'huawei',
  'xiaomi', 'samsung', 'apple', 'tecno', 'infinix', 'realme', 'oppo', 'vivo', 'nokia',
  'motorola', 'moto', 'itel', 'google', 'pixel']);

const BRAND_WORDS = {
  iphone: 'Apple', apple: 'Apple', ipad: 'Apple',
  samsung: 'Samsung', galaxy: 'Samsung',
  xiaomi: 'Xiaomi', redmi: 'Redmi', poco: 'POCO',
  huawei: 'Huawei', honor: 'Honor', oppo: 'OPPO', vivo: 'Vivo',
  realme: 'Realme', tecno: 'Tecno', infinix: 'Infinix',
  nokia: 'Nokia', motorola: 'Motorola', moto: 'Motorola',
  google: 'Google', pixel: 'Google', itel: 'Itel', oneplus: 'OnePlus',
};

const mapToken = mapDeviceToken;

// Brand words sellers put in FRONT of the model — "Xiaomi / Poco X4 5G",
// "Blackview / Honor X9c". Line words (iPhone, Galaxy) are NOT here: they
// are part of the model the catalogue and the app both print.
export const BRAND_PREFIXES = {
  poco: 'POCO', redmi: 'Redmi', xiaomi: 'Xiaomi',
  honor: 'Honor', huawei: 'Huawei', samsung: 'Samsung', apple: 'Apple',
  oppo: 'OPPO', vivo: 'Vivo', realme: 'Realme', tecno: 'Tecno',
  techno: 'Tecno', infinix: 'Infinix', infinx: 'Infinix', infnix: 'Infinix',
  lnfinix: 'Infinix', nokia: 'Nokia', motorola: 'Motorola',
  google: 'Google', itel: 'Itel', oneplus: 'OnePlus', blackview: 'Blackview',
  oukitel: 'Oukitel', nubia: 'Nubia', zte: 'ZTE', lenovo: 'Lenovo',
  sony: 'Sony', doogee: 'Doogee', ulefone: 'Ulefone', tcl: 'TCL',
  'بوكو': 'POCO', 'ريدمي': 'Redmi', 'شاومي': 'Xiaomi', 'هونر': 'Honor',
  'هواوي': 'Huawei', 'سامسونك': 'Samsung', 'سامسونج': 'Samsung', 'ابل': 'Apple',
  'اوبو': 'OPPO', 'فيفو': 'Vivo', 'ريلمي': 'Realme', 'تكنو': 'Tecno',
  'انفنكس': 'Infinix', 'نوكيا': 'Nokia', 'موتورولا': 'Motorola',
};

/**
 * Peel leading brand words off a model name.
 *
 * Several can stack ("ZTE Nubia Neo 5G"); the LAST one the app actually
 * offers wins. When NONE of them is offered nothing is touched: "Sony
 * Xperia 1 IV" under brand Other keeps its Sony, because the brand field
 * cannot carry it and the name is all a buyer has.
 *
 * @returns {{brand: string|null, model: string}} brand is null when nothing
 *   was stripped (also when stripping would leave nothing — "Poco" on its
 *   own is a brand, not a device); model is what remains.
 */
export function stripLeadingBrand(model, available) {
  let rest = String(model || '').trim();
  let target = null;
  let stripped = false;
  for (;;) {
    const m = /^([A-Za-z\u0600-\u06FF]+)[\s\-_.]+(.+)$/.exec(rest);
    if (!m) break;
    const b = BRAND_PREFIXES[m[1].toLowerCase()];
    if (!b) break;
    rest = m[2].trim();
    stripped = true;
    if (available.has(b)) target = b;
  }
  if (!stripped || !rest || !target) return { brand: null, model: String(model || '').trim() };
  return { brand: target, model: rest };
}

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
  // transliterateTokens splits on '.', so a seller's "MatePad 11.5" arrives
  // as the run "matepad115" — register that spelling too.
  for (const a of [...out]) if (a.includes('.')) out.add(a.replace(/\./g, ''));
  return [...out];
}

let CATALOG = null;
function catalog() {
  if (CATALOG) return CATALOG;
  CATALOG = new Map();
  SHAVED = new Map();
  const rows = PRIMED || db.prepare(
    'SELECT brand, model FROM device_catalog WHERE is_active=1',
  ).all();
  for (const row of rows) {
    if (!CATALOG.has(row.brand)) CATALOG.set(row.brand, new Map());
    const m = CATALOG.get(row.brand);
    CURRENT_BRAND = row.brand;
    const put = (k) => {
      if (!k) return;
      // Longest spelling wins when two catalogue rows share a key.
      const cur = m.get(k);
      if (!cur || row.model.length > cur.length) m.set(k, row.model);
    };
    const spellings = [row.model];
    // Sellers drop the line word: they write "A04e", the catalogue says
    // "Galaxy A04e". Index the tail too, within the brand.
    const parts = String(row.model).trim().split(/\s+/);
    if (parts.length > 1 && LINE_WORDS.has(parts[0].toLowerCase())) {
      spellings.push(parts.slice(1).join(' '));
    }
    for (const sp of spellings) {
      for (const k of keyAliases(sp)) put(k);
      // "Galaxy S21 Ultra" is what a seller types for the catalogue's
      // "Galaxy S21 Ultra 5G". Register the shaved key too — but only
      // when it is unambiguous: "Note 14 Pro 4G" and "Note 14 Pro 5G" both
      // shave to "note14pro", and guessing between them is exactly the
      // wrong-device rename this module exists to prevent.
      for (const k of keyAliases(sp)) {
        const sh = shaveNetwork(k);
        if (sh && sh !== k) putShaved(sh, row.model);
      }
    }
  }
  for (const [b, shaved] of SHAVED) {
    const m = CATALOG.get(b);
    for (const [k, model] of shaved) {
      if (model !== AMBIGUOUS && !m.has(k)) m.set(k, model);
    }
  }
  return CATALOG;
}

const AMBIGUOUS = Symbol('ambiguous');
let SHAVED = new Map();
function shaveNetwork(k) {
  const m = /^(.+?)(5g|4g)$/.exec(k);
  return m && m[1].length >= 2 ? m[1] : null;
}
function putShaved(k, model) {
  // Called while CATALOG is being built; SHAVED is keyed per brand by the
  // row currently being indexed (see the loop above).
  const b = CURRENT_BRAND;
  if (!SHAVED.has(b)) SHAVED.set(b, new Map());
  const m = SHAVED.get(b);
  const cur = m.get(k);
  if (cur === undefined) m.set(k, model);
  else if (cur !== model) m.set(k, AMBIGUOUS);
}
let CURRENT_BRAND = null;
export function resetCatalogCache() { CATALOG = null; PRIMED = null; }

/**
 * Resolve against these rows instead of device_catalog — for a cleanup
 * planning what the catalogue will hold before it has been written.
 */
export function primeCatalog(rows) { PRIMED = rows; CATALOG = null; }
let PRIMED = null;

// Words that change WHICH device it is. A seller who wrote one of these
// and gets matched to a model without it has been demoted: "ايفون 7 بلس"
// → "iPhone 7" was a real rename this guard now blocks.
const MODIFIERS = new Set(['pro', 'max', 'plus', 'ultra', 'mini', 'lite', 'fe',
  'neo', 'prime', 'power', 'se', 'air', 'fold', 'flip', 'gt', 'turbo', 'edge',
  'premier', 'slim', 'classic', 'promax']);

// Product families. A name that says "iPad" must not land on an iPhone,
// and a MacBook must not land on anything the catalogue holds at all.
const FAMILIES = new Set(['ipad', 'iphone', 'watch', 'pad', 'tab', 'book',
  'macbook', 'laptop', 'buds', 'pencil', 'airpods', 'band', 'camera']);

function modelTokens(model) {
  // "Galaxy Z Flip7", "Watch Ultra2", "Magic8 Pro": the catalogue glues
  // the word to the number, the seller does not. Split them apart so the
  // word is visible either way.
  return new Set(String(model).toLowerCase().replace(/\+/g, ' plus ')
    .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/).filter(Boolean));
}

// Leftover tokens that carry a digit and are not a capacity, year, size or
// network tag name a DIFFERENT device than the run that matched: "Play 20a"
// is not the Honor "Play", whatever the longest run says.
const HARMLESS_NUMBER = /^(?:(?:1|2|3|4|6|8|12|16|24|32|64|128|256|512|1024|2048)(?:gb|tb|g)?|20[12]\d|\d+(?:mm|inch|hz|w|mah|mp|k|x|%)|[45]g|lte)$/;
function leftoverObjection(tokens, from, to) {
  for (let i = 0; i < tokens.length; i++) {
    if (i >= from && i < to) continue;
    const t = tokens[i];
    if (/\d/.test(t) && !HARMLESS_NUMBER.test(t)) return `leftover:${t}`;
  }
  return null;
}

/**
 * Why a token-run match must be refused, or null when it may stand.
 * Exported for the cleanup script's report.
 */
export function matchObjection(tokens, model) {
  const have = new Set(tokens.map((t) => (t === '+' ? 'plus' : t)));
  const want = modelTokens(model);
  for (const t of have) {
    if (MODIFIERS.has(t) && !want.has(t)) return `demotion:${t}`;
    if (t === 'promax' && !(want.has('pro') && want.has('max'))) return 'demotion:pro max';
  }
  for (const t of have) {
    if (!FAMILIES.has(t)) continue;
    // "pad" covers MatePad/Xpad/Pad — the model must carry the family
    // somewhere, as a token or inside one ("MatePad").
    const modelText = String(model).toLowerCase();
    const carries = want.has(t) || modelText.includes(t);
    if (!carries) return `family:${t}`;
  }
  return null;
}

/**
 * Resolve one listing's name against the catalogue.
 * @returns {{model:string|null, brand:string|null, confidence:'exact'|'brand-fixed'|'none', tokens:string[], objection?:string}}
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
        if (hit && (!best || k.length > best.key.length)) best = { key: k, model: hit, from: i, to: i + n };
      }
    }
    if (best) {
      const objection = matchObjection(tokens, best.model)
        || leftoverObjection(tokens, best.from, best.to);
      if (objection) return { model: null, brand: null, confidence: 'none', tokens, objection, refused: best.model };
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
