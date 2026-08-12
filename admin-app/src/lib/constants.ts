// Option lists shared by the editors.
//
// Governorates are stored in ENGLISH on the server (see server/governorates.js)
// and shown in Arabic, so the value and the label differ — writing the Arabic
// back would fail validation with `bad_governorate`.

export const GOVERNORATES: { value: string; label: string }[] = [
  { value: 'Baghdad', label: 'بغداد' },
  { value: 'Basra', label: 'البصرة' },
  { value: 'Erbil', label: 'أربيل' },
  { value: 'Sulaymaniyah', label: 'السليمانية' },
  { value: 'Duhok', label: 'دهوك' },
  { value: 'Kirkuk', label: 'كركوك' },
  { value: 'Najaf', label: 'النجف' },
  { value: 'Karbala', label: 'كربلاء' },
  { value: 'Mosul', label: 'نينوى' },
  { value: 'Anbar', label: 'الأنبار' },
  { value: 'Babil', label: 'بابل' },
  { value: 'Diyala', label: 'ديالى' },
  { value: 'Diwaniyah', label: 'الديوانية' },
  { value: 'Dhi Qar', label: 'ذي قار' },
  { value: 'Maysan', label: 'ميسان' },
  { value: 'Muthanna', label: 'المثنى' },
  { value: 'Salahuddin', label: 'صلاح الدين' },
  { value: 'Wasit', label: 'واسط' },
];

/** All four, matching the sell form — the buyer filter used to offer three. */
export const CONDITIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'جديد' },
  { value: 'used', label: 'مستعمل' },
  { value: 'refurbished', label: 'مجدد' },
  { value: 'repaired', label: 'مصلح' },
];

export const LISTING_STATUSES: { value: string; label: string }[] = [
  { value: 'active', label: 'نشط' },
  { value: 'reserved', label: 'محجوز' },
  { value: 'sold', label: 'مباع' },
  { value: 'expired', label: 'منتهي' },
];

export const STORAGES: { value: string; label: string }[] = [
  { value: '64GB', label: '64GB' },
  { value: '128GB', label: '128GB' },
  { value: '256GB', label: '256GB' },
  { value: '512GB', label: '512GB' },
  { value: '1TB', label: '1TB' },
];
