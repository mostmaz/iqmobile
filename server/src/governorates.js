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

// ─── neighbours ───────────────────────────────────────────────────────
//
// Which governorates actually border each other. Used by the zero-results
// path to offer "try a nearby governorate" — an explicit, tappable
// alternative, never a silent widening of the filter.
//
// Authored by hand from Iraq's provincial map; there is no source for this
// in the codebase or the database. Two naming traps worth remembering when
// editing: `Mosul` is the key for نينوى (the province is Nineveh, the value
// we store is the city), and `Dhi Qar` contains a space.
//
// Symmetric by construction — the test asserts it. A one-way edge would make
// a suggestion appear from Basra to Maysan but not back, which reads as a bug
// to the one user who notices and is invisible to everyone else.
export const GOV_NEIGHBOURS = {
  Baghdad: ['Anbar', 'Babil', 'Diyala', 'Salahuddin', 'Wasit'],
  Basra: ['Dhi Qar', 'Maysan', 'Muthanna'],
  Erbil: ['Duhok', 'Kirkuk', 'Mosul', 'Sulaymaniyah', 'Salahuddin'],
  Sulaymaniyah: ['Diyala', 'Erbil', 'Kirkuk', 'Salahuddin'],
  Duhok: ['Erbil', 'Mosul'],
  Kirkuk: ['Diyala', 'Erbil', 'Salahuddin', 'Sulaymaniyah'],
  Najaf: ['Anbar', 'Babil', 'Diwaniyah', 'Karbala', 'Muthanna'],
  Karbala: ['Anbar', 'Babil', 'Najaf'],
  Mosul: ['Anbar', 'Duhok', 'Erbil', 'Salahuddin'],
  Anbar: ['Baghdad', 'Karbala', 'Mosul', 'Najaf', 'Salahuddin'],
  Babil: ['Baghdad', 'Diwaniyah', 'Karbala', 'Najaf', 'Wasit'],
  Diyala: ['Baghdad', 'Kirkuk', 'Salahuddin', 'Sulaymaniyah', 'Wasit'],
  Diwaniyah: ['Babil', 'Dhi Qar', 'Muthanna', 'Najaf', 'Wasit'],
  'Dhi Qar': ['Basra', 'Diwaniyah', 'Maysan', 'Muthanna', 'Wasit'],
  Maysan: ['Basra', 'Dhi Qar', 'Wasit'],
  Muthanna: ['Basra', 'Dhi Qar', 'Diwaniyah', 'Najaf'],
  Salahuddin: ['Anbar', 'Baghdad', 'Diyala', 'Erbil', 'Kirkuk', 'Mosul', 'Sulaymaniyah'],
  Wasit: ['Babil', 'Baghdad', 'Dhi Qar', 'Diwaniyah', 'Diyala', 'Maysan'],
};

/** Neighbours of a canonical English governorate name; [] when unknown. */
export function neighboursOf(en) {
  return GOV_NEIGHBOURS[en] || [];
}

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
