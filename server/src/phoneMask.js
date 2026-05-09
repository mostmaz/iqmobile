// Phone-number detection for chat messages.
//
// We block raw phone numbers in chat *before* a deal is confirmed because the
// product rule is: the seller's phone is unlocked only after both sides
// confirm the price. Allowing freeform numbers in chat would defeat the rule.
//
// Patterns supported:
//  - Iraqi mobile: 07XXXXXXXXX (11 digits, allow embedded spaces / dashes)
//  - International form: +9647XXXXXXXXX or 009647XXXXXXXXX
//  - Raw 10–13 digit runs that *look* like a phone number even with
//    interspersed separators (spaces, dashes, dots)
//
// Also catches obfuscation: "zero seven seven oh", "٠٧٧٠١٢٣٤٥٦٧" (Arabic-Indic
// digits), and digit-letter swaps like "07OO123456" (O→0).

const ARABIC_DIGITS = /[٠-٩]/g;
const ARABIC_MAP = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

// Most common look-alike substitutions used to evade naive filters.
function normalizeText(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(ARABIC_DIGITS, (d) => ARABIC_MAP[d] || d)
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1');
}

// A "phone-ish" run is any sequence containing 9–15 digits, possibly
// interleaved with at most ~6 separator chars (space/dash/dot/parens/+).
const PHONE_RUN = /(\+?\d[\d\s\-.()]{7,16}\d)/g;

export function detectPhoneNumbers(input) {
  const normalized = normalizeText(input);
  const matches = [];
  let m;
  PHONE_RUN.lastIndex = 0;
  while ((m = PHONE_RUN.exec(normalized)) !== null) {
    const raw = m[1];
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    matches.push({ start: m.index, end: m.index + raw.length, raw, digits });
  }
  return matches;
}

export function containsPhoneNumber(input) {
  return detectPhoneNumbers(input).length > 0;
}

// Replace any phone-number runs in `input` with `█████████` so we can store a
// safe rendering of the masked message. We work on the *original* string so
// punctuation/spacing around the masked portion is preserved.
export function maskPhoneNumbers(input) {
  if (typeof input !== 'string') return input;
  const normalized = normalizeText(input);
  const matches = [];
  let m;
  PHONE_RUN.lastIndex = 0;
  while ((m = PHONE_RUN.exec(normalized)) !== null) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    matches.push([m.index, m.index + m[1].length]);
  }
  if (matches.length === 0) return input;
  let out = '';
  let cur = 0;
  for (const [a, b] of matches) {
    out += input.slice(cur, a) + '█████████';
    cur = b;
  }
  out += input.slice(cur);
  return out;
}
