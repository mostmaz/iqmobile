// Smart-search normalization: lets Arabic-typed queries match the Latin
// brand/model catalog. "سامسونج" → samsung, "ايفون ١٣" → "iphone 13",
// "اس ٢٣" → "s 23" (and the space-stripped comparison in the browse route
// makes that hit a model stored as "S23").
//
// The transliteration is a token dictionary, not a general engine — the
// vocabulary of the Iraqi phone market is small (brands + line names +
// letter names + storage units), so a curated map beats fuzzy matching
// and never produces surprising hits.

import { AR_DIGITS, normalizeArabic, mapDeviceToken } from './arabicDeviceTerms.js';

// Token lookup lives in arabicDeviceTerms.js so buyer search, the device
// picker and the name cleanup all share one vocabulary — they used to keep
// separate copies, and "بوفا" existed in only one of them.
const mapToken = mapDeviceToken;

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

// Merge a single Latin letter followed by digits into one token ("s","23"
// → "s23"). Without this, the standalone letter token "s" would substring-
// match nearly every listing.
function mergeLetterDigit(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^[a-z]$/i.test(tokens[i]) && i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) {
      out.push(tokens[i] + tokens[i + 1]);
      i++;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

// The token set for AND-matching. We take the most-normalized candidate
// (transliterated + Arabic-normalized) and tokenize it. Each token is
// either a Latin catalog term ("samsung", "s25", "ultra") or a normalized
// Arabic description word ("كفاله"). A listing matches when EVERY token
// appears in its combined text — so "سامسونج الترا" finds "Samsung S23
// Ultra" (non-adjacent) and "ايفون كفاله" requires BOTH iphone and كفاله.
//
// Deliberately a SINGLE set, not a raw-vs-transliterated pair: the raw
// Arabic form reintroduced noise (the letter-name "اس" is a substring of
// countless Arabic words) and — because descriptions are stored with
// taa-marbuta while the query normalizes it to haa — never lined up with
// the stored text anyway. Instead we normalize BOTH sides identically: the
// query here, and the SQL haystack via arabicNormalizeSql().
export function queryTokens(raw) {
  const candidates = expandQuery(raw);
  if (!candidates.length) return [];
  const c = candidates[candidates.length - 1];
  return mergeLetterDigit(c.toLowerCase().split(/[\s،,.\-_/]+/).filter(Boolean));
}

// SQL expression that normalizes `expr` exactly as expandQuery normalizes
// the query: lowercase, digit-fold (٠-٩→0-9), collapse Arabic orthography
// variants (hamza→alef, alef-maqsura→ya, taa-marbuta→haa, strip tatweel),
// and remove spaces. Applying the identical normalization to the stored
// text and the query is what makes description matching reliable — a query
// token "كفاله" then matches a description written "كفالة". Built as nested
// REPLACEs; the resulting LIKE skips indexes, but the listings table is
// small enough not to care.
export function arabicNormalizeSql(expr) {
  const reps = [
    ['أ', 'ا'], ['إ', 'ا'], ['آ', 'ا'], ['ٱ', 'ا'],
    ['ى', 'ي'], ['ؤ', 'و'], ['ئ', 'ي'], ['ة', 'ه'], ['ـ', ''],
    ['٠', '0'], ['١', '1'], ['٢', '2'], ['٣', '3'], ['٤', '4'],
    ['٥', '5'], ['٦', '6'], ['٧', '7'], ['٨', '8'], ['٩', '9'],
    [' ', ''],
  ];
  let e = `LOWER(${expr})`;
  for (const [a, b] of reps) e = `REPLACE(${e},'${a}','${b}')`;
  return e;
}
