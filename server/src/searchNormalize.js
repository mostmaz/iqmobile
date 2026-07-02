// Smart-search normalization: lets Arabic-typed queries match the Latin
// brand/model catalog. "سامسونج" → samsung, "ايفون ١٣" → "iphone 13",
// "اس ٢٣" → "s 23" (and the space-stripped comparison in the browse route
// makes that hit a model stored as "S23").
//
// The transliteration is a token dictionary, not a general engine — the
// vocabulary of the Iraqi phone market is small (brands + line names +
// letter names + storage units), so a curated map beats fuzzy matching
// and never produces surprising hits.

// Arabic-Indic and Eastern-Arabic-Indic digits → ASCII.
const AR_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

// Collapse Arabic orthography variants so dictionary keys stay simple:
// hamza forms → bare alef, alef maqsura → ya, taa marbuta → haa, and
// strip tatweel + diacritics.
function normalizeArabic(s) {
  return s
    .replace(/[ـً-ْ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');
}

// token (normalized Arabic) → Latin. Multiple spellings per target are
// listed explicitly since users type them all.
const DICT = {
  // brands
  'سامسونج': 'samsung', 'سامسونغ': 'samsung', 'سمسونج': 'samsung',
  'ايفون': 'iphone', 'ابل': 'apple',
  'شاومي': 'xiaomi', 'شياومي': 'xiaomi', 'اكسياومي': 'xiaomi',
  'ريدمي': 'redmi', 'بوكو': 'poco',
  'هواوي': 'huawei', 'هاواوي': 'huawei',
  'اوبو': 'oppo', 'فيفو': 'vivo',
  'ريلمي': 'realme', 'ريلمى': 'realme',
  'تكنو': 'tecno', 'تيكنو': 'tecno',
  'انفنكس': 'infinix', 'انفينكس': 'infinix', 'انفينيكس': 'infinix',
  'هونر': 'honor', 'اونر': 'honor',
  'نوكيا': 'nokia',
  'موتورولا': 'motorola', 'موتو': 'moto',
  'جوجل': 'google', 'غوغل': 'google', 'قوقل': 'google',
  'بكسل': 'pixel', 'بيكسل': 'pixel',
  'وان': 'one', 'ون': 'one',
  // line / model words
  'جالكسي': 'galaxy', 'جالاكسي': 'galaxy', 'غالاكسي': 'galaxy',
  'غالكسي': 'galaxy', 'جلكسي': 'galaxy',
  'نوت': 'note', 'برو': 'pro', 'ماكس': 'max', 'مكس': 'max',
  'بلس': 'plus', 'بلاس': 'plus', 'الترا': 'ultra',
  'ميني': 'mini', 'لايت': 'lite', 'فولد': 'fold', 'فليب': 'flip',
  'اير': 'air', 'ايير': 'air',
  // letter names (اس ٢٣ → s 23, ايه ٥٤ → a 54, …)
  'اس': 's', 'ايه': 'a', 'سي': 'c', 'ام': 'm', 'اكس': 'x',
  'زد': 'z', 'كي': 'k', 'جي': 'g', 'تي': 't', 'واي': 'y',
  'ار': 'r', 'دي': 'd', 'اف': 'f', 'اتش': 'h', 'ان': 'n', 'يو': 'u',
  // storage / specs
  'جيجا': 'gb', 'غيغا': 'gb', 'قيقا': 'gb', 'كيكا': 'gb',
  'تيرا': 'tb', 'رام': 'ram',
};

// Map one token through the dictionary. Falls back to a leading-"ال"
// strip (definite article: "الايفون" → "ايفون") — but only AFTER the
// exact lookup so words like "الترا" (ultra) keep their direct hit.
function mapToken(tok) {
  if (DICT[tok]) return DICT[tok];
  if (tok.length > 3 && tok.startsWith('ال') && DICT[tok.slice(2)]) return DICT[tok.slice(2)];
  return tok;
}

// Expand a raw user query into candidate search strings: the original
// (matches Arabic descriptions) plus a transliterated form when it
// differs (matches the Latin brand/model columns). Digits are always
// normalized in both.
export function expandQuery(raw) {
  let q = String(raw).slice(0, 80);
  // digits first — they apply to both candidates
  q = q.replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] || d);
  const original = q.trim();
  if (!original) return [];

  let norm = normalizeArabic(original);
  // Split letter↔digit boundaries so "اس23" tokenizes as "اس" + "23".
  norm = norm
    .replace(/([؀-ۿ])(\d)/g, '$1 $2')
    .replace(/(\d)([؀-ۿ])/g, '$1 $2');
  const translit = norm
    .split(/[\s،,.\-_/]+/)
    .filter(Boolean)
    .map(mapToken)
    .join(' ');

  const out = [original];
  if (translit && translit.toLowerCase() !== original.toLowerCase()) out.push(translit);
  return out;
}

// Space-stripped lowercase form of the most-normalized candidate — used
// against REPLACE(LOWER(model),' ','') so "s 23" hits "S23" and vice versa.
export function compactQuery(candidates) {
  if (candidates.length === 0) return '';
  return candidates[candidates.length - 1].toLowerCase().replace(/\s+/g, '');
}
