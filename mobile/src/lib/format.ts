export function formatIQD(n: number) {
  return n.toLocaleString('en-US') + ' د.ع';
}

// iOS renders a bare Western digit that sits directly against an Arabic
// letter (e.g. "قبل 7ي") using the Arabic-Indic "Hindi" glyph (٧). We want
// Western 0-9 everywhere, so wrap the number in Left-to-Right Marks (U+200E)
// — an invisible boundary that keeps the digit in a Latin run. Use this for
// any number embedded inside Arabic text.
const LRM = String.fromCharCode(0x200e); // Left-to-Right Mark
export function ltrNum(n: number | string): string {
  return LRM + String(n) + LRM;
}

// Convert Arabic-Indic and Eastern-Arabic-Indic numerals to Latin 0-9.
// Iraqi keyboards default to ٠١٢٣٤٥٦٧٨٩ (Arabic-Indic). Without this,
// any `replace(/\D/g, '')` or `Number(input)` silently drops the whole
// number — the user types ٠٧٧٠٠٠٠١٢٣٤ and gets empty / NaN. Apply this
// BEFORE digit-only filters or parseInt/Number, never after.
export function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30))
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 0x30));
}

// Strip everything but digits (Arabic-Indic + Latin both supported via
// the digit-normalisation above). Use this for price + phone TextInput
// onChangeText handlers so paste/typing in either numeral system works.
export function digitsOnly(s: string): string {
  return toLatinDigits(s).replace(/\D/g, '');
}

// Parse a user-typed price string into a finite positive integer, or
// null when the input isn't a real number. Accepts Arabic-Indic digits,
// leading/trailing whitespace, embedded commas/separators.
export function parsePrice(s: string): number | null {
  const cleaned = digitsOnly(s);
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function timeLeftMs(expiresAt: number) {
  return Math.max(0, expiresAt - Date.now());
}

export function formatCountdown(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${ltrNum(h)}س ${ltrNum(m % 60)}د`;
  return `${ltrNum(m)}د ${ltrNum(s % 60)}ث`;
}

// ─── Relative time, in grammatical Arabic ────────────────────────
//
// The feed used to mix two systems in one column: spelled-out singulars
// ("قبل يوم", "قبل ساعة") next to abbreviated counts ("قبل 10ي", "قبل 28د",
// "قبل 4س"). Two rows of the same list disagreeing about their own units
// reads as two different features.
//
// One system, and one that respects the language: Arabic inflects by count,
// so 1 takes the bare noun, 2 takes the dual, 3–10 take the plural, and 11+
// return to the singular. Getting this wrong ("قبل 2 ساعة") is the sort of
// thing that marks an app as machine-translated.
type ArUnit = { one: string; two: string; few: string; many: string };

const AR_MINUTE: ArUnit = { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة' };
const AR_HOUR: ArUnit = { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة' };
const AR_DAY: ArUnit = { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يوم' };
const AR_MONTH: ArUnit = { one: 'شهر', two: 'شهرين', few: 'أشهر', many: 'شهر' };

function arCount(n: number, u: ArUnit): string {
  if (n === 1) return u.one;
  if (n === 2) return u.two;
  // 3–10 take the plural WITHOUT repeating the numeral as a separate word;
  // 11 and up go back to the singular, which is correct Arabic even though
  // it looks wrong to an English eye.
  if (n >= 3 && n <= 10) return `${ltrNum(n)} ${u.few}`;
  return `${ltrNum(n)} ${u.many}`;
}

/** "الآن" / "قبل دقيقتين" / "قبل 5 ساعات" / "قبل 3 أيام". */
export function timeAgoAr(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'الآن';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `قبل ${arCount(mins, AR_MINUTE)}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${arCount(hrs, AR_HOUR)}`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `قبل ${arCount(days, AR_DAY)}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `قبل ${arCount(months, AR_MONTH)}`;
  return new Date(ts).toLocaleDateString('ar-IQ', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Day bucket for grouping a list — "اليوم" / "أمس" / a short date. */
export function dayBucketAr(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const delta = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (delta <= 0) return 'اليوم';
  if (delta === 1) return 'أمس';
  if (delta < 7) return `قبل ${arCount(delta, AR_DAY)}`;
  return d.toLocaleDateString('ar-IQ', { month: 'long', day: 'numeric' });
}

// ─── Device title ────────────────────────────────────────────────
//
// Titles are composed "{brand} {model}", which produces "Oukitel Oukitel C62"
// whenever the seller typed the brand into the model box too, and "Other TCL
// 605" for anything under the catch-all brand — "Other" is a bucket in a
// dropdown, not a manufacturer, and it should never reach a buyer's screen.
export function deviceTitle(brand?: string | null, model?: string | null): string {
  const b = String(brand || '').trim();
  const m = String(model || '').trim();
  if (!m) return b === 'Other' ? '' : b;
  // "Other" carries no information; the model text is all there is.
  if (!b || b === 'Other' || b === 'أخرى') return m;
  // Already self-describing — "Oukitel C62" needs no second "Oukitel".
  if (m.toLowerCase().startsWith(b.toLowerCase())) return m;
  return `${b} ${m}`;
}

/** "خلال ٢-٤ أيام" — the delivery window, or '' when the shop hasn't set one. */
export function deliveryWindowAr(min?: number | null, max?: number | null): string {
  const a = Number(min) || 0;
  const b = Number(max) || 0;
  if (!a && !b) return '';
  // A single figure inflects like any other count, so it goes through arCount
  // rather than picking a plural by hand: a one-day window is "خلال يوم", not
  // "خلال 1 أيام", and two days is "يومين". A RANGE keeps the bare plural —
  // "خلال ٢–٤ أيام" is how a span is read, and the dual never applies to it.
  if (!b || a === b) return `خلال ${arCount(a || b, AR_DAY)}`;
  return `خلال ${ltrNum(a)}–${ltrNum(b)} ${b <= 10 ? 'أيام' : 'يوم'}`;
}
