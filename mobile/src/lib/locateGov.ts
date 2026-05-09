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
    // Substring match on canonical English names ("erbil province" → "Erbil")
    for (const en of Object.values(GOV_AR_TO_EN)) {
      if (n.includes(normalize(en))) return en;
    }
  }
  return null;
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
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
    const places = await Location.reverseGeocodeAsync({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });
    const place = places?.[0];
    if (!place) return null;
    // Try region first (governorate), then subregion, then country (just in
    // case the geocoder lumped it differently). City may also help.
    const en = matchGov(place.region, place.subregion, place.city, place.district);
    if (!en) return null;
    return {
      governorate: en,
      governorateAr: GOV_EN_TO_AR[en] || en,
      city: place.city || place.district || null,
    };
  } catch {
    return null;
  }
}
