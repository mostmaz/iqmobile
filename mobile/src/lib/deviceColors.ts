// One canonical spelling per device colour.
//
// Colour was a bare free-text box, which is how the feed ended up showing
// "black", "Black", "أسود" and "ازرق" as four different values for two
// actual colours — and how "Blaack123" got in. Filtering by colour is
// meaningless when the same colour has four spellings.
//
// The sell form now offers these as chips (one tap, always canonical) and
// still accepts free text for the genuinely unusual finishes, but runs that
// text through canonicalColor() first so the common cases converge.

/** The chips offered on the sell form, in rough order of how common they are. */
export const COLOR_CHOICES = [
  'أسود', 'أبيض', 'أزرق', 'رمادي', 'ذهبي', 'فضي',
  'أخضر', 'أحمر', 'بنفسجي', 'وردي', 'أصفر', 'برتقالي', 'بني',
];

// Spelling variants → canonical. Keys are compared after lower-casing and
// stripping the Arabic orthography that varies by keyboard (hamza forms,
// taa marbuta), so "ازرق" and "أزرق" both land on the same entry.
const ALIASES: Record<string, string> = {
  black: 'أسود', اسود: 'أسود', 'اسمر': 'أسود',
  white: 'أبيض', ابيض: 'أبيض',
  blue: 'أزرق', ازرق: 'أزرق', 'ازرك': 'أزرق',
  grey: 'رمادي', gray: 'رمادي', رمادي: 'رمادي', 'سكني': 'رمادي',
  gold: 'ذهبي', golden: 'ذهبي', ذهبي: 'ذهبي', 'دهبي': 'ذهبي',
  silver: 'فضي', فضي: 'فضي',
  green: 'أخضر', اخضر: 'أخضر',
  red: 'أحمر', احمر: 'أحمر',
  purple: 'بنفسجي', violet: 'بنفسجي', بنفسجي: 'بنفسجي',
  pink: 'وردي', rose: 'وردي', وردي: 'وردي', 'زهري': 'وردي',
  yellow: 'أصفر', اصفر: 'أصفر',
  orange: 'برتقالي', برتقالي: 'برتقالي',
  brown: 'بني', بني: 'بني',
  titanium: 'تيتانيوم', تيتانيوم: 'تيتانيوم',
  graphite: 'جرافيت', جرافيت: 'جرافيت',
  midnight: 'أسود', starlight: 'أبيض',
};

/** Collapse the Arabic spellings that differ only by hamza / taa marbuta. */
function foldArabic(s: string): string {
  return s
    .replace(/[ـً-ْ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/**
 * Best canonical spelling for what the seller typed.
 * Unknown text is returned trimmed rather than rejected — "Sierra Blue" is a
 * real colour we have no business second-guessing.
 */
export function canonicalColor(raw: string): string {
  const t = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const key = foldArabic(t.toLowerCase());
  return ALIASES[key] || t;
}

/**
 * Reason the colour is unusable, or null when it is fine.
 * Deliberately narrow: it rejects the things that are never a colour
 * (digits, symbols, a single letter) and lets everything else through.
 */
export function colorProblem(raw: string): string | null {
  const t = String(raw || '').trim();
  if (!t) return null; // colour is optional
  if (/\d/.test(t)) return 'اللون لا يحتوي على أرقام.';
  if (t.length < 2) return 'اكتب اسم اللون كاملاً.';
  if (t.length > 24) return 'اسم اللون طويل جداً.';
  if (!/[A-Za-z؀-ۿ]/.test(t)) return 'اكتب اسم اللون بالحروف.';
  return null;
}
