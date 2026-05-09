// Single source of truth for Iraqi governorate names — Arabic for display,
// English for the wire (what the server stores). All UI surfaces should
// pass the user's choice through these helpers so we never leak raw
// English city names to the screen.

export const GOV_AR_TO_EN: Record<string, string> = {
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

export const GOV_EN_TO_AR: Record<string, string> = Object.fromEntries(
  Object.entries(GOV_AR_TO_EN).map(([ar, en]) => [en, ar]),
);

export const GOV_AR_LIST = Object.keys(GOV_AR_TO_EN);
export const GOV_EN_LIST = Object.values(GOV_AR_TO_EN);

// Display helper — returns Arabic name from English wire value, falling
// back to the input if unknown (so we never render undefined).
export function arOf(en?: string | null): string {
  if (!en) return '';
  return GOV_EN_TO_AR[en] || en;
}

// New default governorate
export const DEFAULT_GOV_AR = 'نينوى';
export const DEFAULT_GOV_EN = GOV_AR_TO_EN[DEFAULT_GOV_AR];
