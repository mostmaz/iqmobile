// Canonical English governorate names — the form we store in the DB.
export const GOVERNORATES = [
  'Baghdad',
  'Basra',
  'Erbil',
  'Sulaymaniyah',
  'Duhok',
  'Kirkuk',
  'Najaf',
  'Karbala',
  'Mosul',
  'Anbar',
  'Babil',
  'Diyala',
  'Diwaniyah',
  'Dhi Qar',
  'Maysan',
  'Muthanna',
  'Salahuddin',
  'Wasit',
];

// Brand list moved to the DB — see `brands.js`. isBrand() lives there too.
// Kept this comment as a discovery hint for anyone searching `BRANDS`.

// Arabic → canonical English. Mirrored from mobile/src/lib/governorates.ts
// so the server can accept Arabic input gracefully even when a client
// forgets to translate, when someone hand-crafts a curl request, or when
// the mobile-side AR→EN map drifts. Defence in depth.
const AR_TO_EN = {
  'بغداد': 'Baghdad',
  'البصرة': 'Basra',
  'أربيل': 'Erbil',
  'السليمانية': 'Sulaymaniyah',
  'دهوك': 'Duhok',
  'كركوك': 'Kirkuk',
  'النجف': 'Najaf',
  'كربلاء': 'Karbala',
  'نينوى': 'Mosul',
  'الأنبار': 'Anbar',
  'بابل': 'Babil',
  'ديالى': 'Diyala',
  'الديوانية': 'Diwaniyah',
  'ذي قار': 'Dhi Qar',
  'ميسان': 'Maysan',
  'المثنى': 'Muthanna',
  'صلاح الدين': 'Salahuddin',
  'واسط': 'Wasit',
};

// Build a case-insensitive English lookup so 'baghdad' and 'BAGHDAD' both
// resolve to 'Baghdad'. Tiny table, cheap to maintain.
const EN_CI = new Map(GOVERNORATES.map((g) => [g.toLowerCase(), g]));

// Returns the canonical English form for any accepted input, or null
// if the input doesn't match anything. Routes should call this and
// rebind `governorate = normalizeGovernorate(req.body.governorate)`
// before persisting.
export function normalizeGovernorate(g) {
  if (typeof g !== 'string') return null;
  const trimmed = g.trim();
  if (!trimmed) return null;
  // Exact Arabic match.
  if (AR_TO_EN[trimmed]) return AR_TO_EN[trimmed];
  // Case-insensitive English match.
  return EN_CI.get(trimmed.toLowerCase()) || null;
}

export function isGovernorate(g) {
  return normalizeGovernorate(g) != null;
}

// isBrand moved to ./brands.js (DB-backed) — import it directly from
// there to avoid the circular-import cycle (db.js → governorates.js
// would re-enter brands.js → db.js).
