// Iraqi phone normalisation, in one place.
//
// This function used to exist as four byte-identical private copies (orders,
// listings, shops, admin) and every one of them stripped Arabic-Indic digits
// instead of reading them: `String(input).replace(/\D/g, '')` deletes ٠٧٧…
// entirely, because JS `\d` is ASCII-only. A customer typing their number on
// the default Iraqi keyboard therefore normalised to the empty string and was
// told their phone was invalid, with no way to tell what was wrong.
//
// So digits are folded to Latin FIRST, then everything else is stripped.
// Both the Arabic-Indic (٠-٩) and Extended/Persian (۰-۹) blocks are folded —
// the same pair searchNormalize.js and listingNameNormalize.js handle.

const AR_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/** Fold Arabic-Indic / Persian numerals to ASCII, leaving everything else. */
export function toLatinDigits(input) {
  return String(input == null ? '' : input).replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] || d);
}

/**
 * Normalise a user-typed Iraqi number to bare local form ("07701234567"),
 * or null when it can't be one. Accepts +964 / 00964 / 964 prefixes, any
 * separators, and either numeral system.
 */
export function normalizeIraqiPhone(input) {
  if (!input) return null;
  let d = toLatinDigits(input).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  if (!d.startsWith('0')) d = '0' + d;
  if (d.length < 10 || d.length > 12) return null;
  return d;
}
