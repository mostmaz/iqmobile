export function formatIQD(n: number) {
  return n.toLocaleString('en-US') + ' د.ع';
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
  if (h > 0) return `${h}س ${m % 60}د`;
  return `${m}د ${s % 60}ث`;
}
