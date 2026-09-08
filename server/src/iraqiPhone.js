// Is this a real Iraqi mobile number?
//
// Every number that passes here becomes a paid message. ARQAM bills $0.02 for
// a WhatsApp OTP and $0.08–$0.18 when it falls back to SMS, and the CALLER
// chooses the number — so the width of this check is the width of the attack
// surface.
//
// What it replaces: normalizePhone() claimed "11 digits starting 07XXXXXXXXX"
// in its comment and then only checked `length >= 10 && length <= 12`, never
// looking at the second digit. toE164() checked nothing but a leading zero.
// Between them, any 10–12 digit string was forwarded to the provider as
// +964…, which is a far larger billable space than Iraq has mobiles.
//
// The check is 11 digits beginning 07, with the third digit in 3-9. The known
// carriers sit inside that range — 075 Korek, 077 Asiacell, 078/079 Zain — and
// the range is kept deliberately WIDER than the carriers I can name.
//
// That is a considered trade, not laziness. Rejecting a prefix Iraq actually
// allocated turns a paying customer into someone who cannot sign in at all,
// and prefix allocations change without telling us. Allowing one unassigned
// 07x prefix costs a single failed send. The value here is in the constraints
// that do the real work: exactly 11 digits, and a 07 mobile trunk — which is
// what excludes landlines (01x and the governorate codes), short codes, and
// the arbitrary 10-12 digit strings the old check waved straight through to a
// paid provider.

/** Arabic-Indic and Eastern Arabic digits → ASCII. */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function asciiDigits(s) {
  let out = '';
  for (const ch of s) {
    const a = AR_DIGITS.indexOf(ch);
    if (a !== -1) { out += String(a); continue; }
    const f = FA_DIGITS.indexOf(ch);
    if (f !== -1) { out += String(f); continue; }
    if (ch >= '0' && ch <= '9') out += ch;
  }
  return out;
}

/** Exactly 11 digits, 07 then an allocated operator digit. */
export const IRAQI_MOBILE_RE = /^07[3-9]\d{8}$/;

/**
 * Loose user input → canonical local `07XXXXXXXXX`, or null.
 *
 * Accepts spaces, dashes, parentheses, Arabic-Indic digits, and the +964 /
 * 00964 / 964 international forms. Returns null for anything that is not an
 * allocated Iraqi mobile — including the landline and short-code space the
 * old check waved through.
 */
export function normalizeIraqiMobile(input) {
  if (typeof input !== 'string') return null;
  let d = asciiDigits(input);
  if (!d) return null;

  // Strip the country code in any of the forms people actually type.
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);

  // A number given as +9647XX… arrives here as 7XX… with no trunk zero.
  if (!d.startsWith('0')) d = '0' + d;

  return IRAQI_MOBILE_RE.test(d) ? d : null;
}

export function isIraqiMobile(input) {
  return normalizeIraqiMobile(input) !== null;
}

/** Canonical local form → E.164. Null for anything not a valid mobile. */
export function toE164(input) {
  const local = normalizeIraqiMobile(input);
  return local ? '+964' + local.slice(1) : null;
}
