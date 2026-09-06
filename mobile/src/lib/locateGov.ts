// Auto-detect the user's governorate via expo-location. We:
//   1. Ask for foreground permission
//   2. Get a low-accuracy fix (good enough for a province-level match)
//   3. Reverse-geocode to a place, look at the `region` (governorate-level
//      admin division) and `city` strings
//   4. Match against our canonical Arabic / English governorate lists
//
// Returns null if anything along the way fails — the caller should fall
// back to the user's current value (default "Baghdad").

import * as Location from 'expo-location';
import { GOV_AR_TO_EN, GOV_EN_TO_AR } from './governorates';

// Common spellings reverse-geocoders return for Iraqi governorates that
// don't already match our canonical English names.
const ALIAS_TO_EN: Record<string, string> = {
  'baghdad governorate': 'Baghdad',
  'basra governorate': 'Basra',
  'basrah': 'Basra',
  'arbil': 'Erbil',
  'erbil governorate': 'Erbil',
  'duhok governorate': 'Duhok',
  'sulaymaniyah governorate': 'Sulaymaniyah',
  'al sulaymaniyah': 'Sulaymaniyah',
  'kirkuk governorate': 'Kirkuk',
  'najaf governorate': 'Najaf',
  'al najaf': 'Najaf',
  'karbala governorate': 'Karbala',
  'nineveh': 'Mosul',
  'ninawa': 'Mosul',
  'mosul': 'Mosul',
  'al anbar': 'Anbar',
  'anbar governorate': 'Anbar',
  'babil governorate': 'Babil',
  'babylon': 'Babil',
  'diyala governorate': 'Diyala',
  'al diwaniyah': 'Diwaniyah',
  'al qadisiyah': 'Diwaniyah',
  'qadisiyyah': 'Diwaniyah',
  'dhi qar governorate': 'Dhi Qar',
  'thi qar': 'Dhi Qar',
  'maysan governorate': 'Maysan',
  'misan': 'Maysan',
  'al muthanna': 'Muthanna',
  'muthanna governorate': 'Muthanna',
  'salah al-din': 'Salahuddin',
  'saladin': 'Salahuddin',
  'wasit governorate': 'Wasit',
};

function normalize(s?: string | null): string {
  return (s || '').trim().toLowerCase();
}

// Arabic normaliser for geocoder output. Apple returns admin names in the
// DEVICE's language, and this app ships Arabic-only — so on a real phone
// `region` comes back as «محافظة بغداد», not "Baghdad Governorate". The old
// matcher only understood English, so every Arabic-locale device fell
// through to the manual picker no matter how good the GPS fix was.
//
// Folds: the «محافظة» / «اقليم» prefix, the definite article, alef and ya
// variants, ta-marbuta, tatweel and diacritics — the same normalisation the
// search stack already applies to user-typed Arabic.
function normalizeAr(s?: string | null): string {
  return (s || '')
    .replace(/[\u064B-\u0652\u0670]/g, '')   // harakat
    .replace(/\u0640/g, '')                   // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/^\s*(محافظة|محافظه|اقليم|إقليم|قضاء|ناحية|ناحيه)\s+/, '')
    .replace(/\bال/g, '')
    .replace(/\s+/g, '')
    .trim();
}

// Arabic governorate name → canonical English, pre-normalised once.
const AR_NORM_TO_EN: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [ar, en] of Object.entries(GOV_AR_TO_EN)) out[normalizeAr(ar)] = en;
  // Names Apple uses that differ from our label for the same province.
  out[normalizeAr('نينوى')] = 'Mosul';
  out[normalizeAr('الموصل')] = 'Mosul';
  out[normalizeAr('القادسية')] = 'Diwaniyah';
  out[normalizeAr('البصره')] = 'Basra';
  out[normalizeAr('اربيل')] = 'Erbil';
  out[normalizeAr('هولير')] = 'Erbil';
  out[normalizeAr('السليمانيه')] = 'Sulaymaniyah';
  out[normalizeAr('صلاح الدين')] = 'Salahuddin';
  out[normalizeAr('ذي قار')] = 'Dhi Qar';
  out[normalizeAr('الديوانيه')] = 'Diwaniyah';
  return out;
})();

// Province centres, used only as a last-resort fallback when the geocoder
// gives us nothing usable (offline, rate-limited, or an unfamiliar spelling).
// Province-level granularity is all this feature needs, so the capital's
// coordinates are a good enough stand-in for the province centroid.
const GOV_POINTS: Array<[string, number, number]> = [
  ['Baghdad', 33.315, 44.366], ['Basra', 30.508, 47.783], ['Erbil', 36.191, 44.009],
  ['Sulaymaniyah', 35.561, 45.437], ['Duhok', 36.867, 42.988], ['Kirkuk', 35.468, 44.392],
  ['Najaf', 31.996, 44.316], ['Karbala', 32.616, 44.024], ['Mosul', 36.340, 43.130],
  ['Anbar', 33.420, 43.301], ['Babil', 32.470, 44.420], ['Diyala', 33.745, 44.642],
  ['Diwaniyah', 31.989, 44.925], ['Dhi Qar', 31.052, 46.259], ['Maysan', 31.833, 47.145],
  ['Muthanna', 31.331, 45.281], ['Salahuddin', 34.610, 43.679], ['Wasit', 32.514, 45.822],
];

function nearestGov(lat: number, lon: number): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const [en, glat, glon] of GOV_POINTS) {
    // Equirectangular approximation — plenty at this scale and cheap.
    const x = (lon - glon) * Math.cos(((lat + glat) / 2) * Math.PI / 180);
    const y = lat - glat;
    const km = Math.sqrt(x * x + y * y) * 111.32;
    if (km < bestKm) { bestKm = km; best = en; }
  }
  // Outside Iraq entirely (roaming, VPN-skewed fix) — say nothing rather
  // than confidently assigning the nearest Iraqi province.
  return bestKm <= 250 ? best : null;
}

function matchGov(...candidates: Array<string | null | undefined>): string | null {
  for (const cand of candidates) {
    if (!cand) continue;
    const n = normalize(cand);
    if (!n) continue;
    // Direct hit on the canonical English name?
    for (const en of Object.values(GOV_AR_TO_EN)) {
      if (normalize(en) === n) return en;
    }
    // Direct hit on the Arabic name?
    if (GOV_AR_TO_EN[cand]) return GOV_AR_TO_EN[cand];
    // Alias table?
    if (ALIAS_TO_EN[n]) return ALIAS_TO_EN[n];
    // Arabic — the common case on a real device, since the geocoder answers
    // in the device's language and this app is Arabic-only.
    const an = normalizeAr(cand);
    if (an && AR_NORM_TO_EN[an]) return AR_NORM_TO_EN[an];
    for (const [arKey, en] of Object.entries(AR_NORM_TO_EN)) {
      if (an && arKey && an.includes(arKey)) return en;
    }
    // Substring match on canonical English names ("erbil province" → "Erbil")
    for (const en of Object.values(GOV_AR_TO_EN)) {
      if (n.includes(normalize(en))) return en;
    }
  }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export interface DetectedGov {
  governorate: string;     // canonical English form, e.g. "Baghdad"
  governorateAr: string;   // Arabic form
  city?: string | null;    // city/district name as the geocoder reported it
}

export async function detectGovernorate(): Promise<DetectedGov | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    // A cold GPS fix can take a long time, and this call sits behind the
    // onboarding button — without a cap the user stares at a spinner. Fall
    // back to the last known position, which is usually instant and is far
    // more than accurate enough to name a province.
    const loc = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }),
      7000,
    ).catch(() => null) || await Location.getLastKnownPositionAsync().catch(() => null);
    if (!loc) return null;
    const { latitude, longitude } = loc.coords;

    // Reverse geocoding needs the network and is rate-limited by Apple, so
    // it is allowed to fail: the coordinate match below covers us.
    let place: Location.LocationGeocodedAddress | undefined;
    try {
      const places = await withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), 6000);
      place = places?.[0];
    } catch { /* fall through to coordinates */ }

    // Try region first (governorate), then subregion, then city/district.
    const en = matchGov(place?.region, place?.subregion, place?.city, place?.district)
      // Last resort, and the reason this function no longer gives up on an
      // Arabic name it doesn't recognise or a geocoder that didn't answer.
      || nearestGov(latitude, longitude);
    if (!en) return null;
    return {
      governorate: en,
      governorateAr: GOV_EN_TO_AR[en] || en,
      city: place?.city || place?.district || null,
    };
  } catch {
    return null;
  }
}
