// One-off data cleanup: walk every listing, look up its `city` against a
// known map of Iraqi regions/districts/neighborhoods → governorate, and
// fix any that are filed under the wrong governorate.
//
// Example: the seed script put `الدجيل` (a town in Salahuddin) under
// Baghdad because the parser only knew governorate-level names. This
// script corrects those.
//
// Idempotent: re-running just re-checks every listing; matching values
// stay put.
//
// Run from server/ on the droplet:  node scripts/rebucketGovernorates.cjs

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || './data/iqmobile2.db';
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// Iraqi region → canonical English governorate name.
// Compiled from common neighbourhoods, towns, and districts (qadhaa)
// across all 18 governorates. Lookup is substring-aware so a city
// stored as "الدورة أبو طيارة" still matches "الدورة".
const R = {
  // Baghdad (بغداد) and its neighborhoods/districts
  'بغداد': 'Baghdad',
  'الكاظمية': 'Baghdad', 'الكاظميه': 'Baghdad',
  'الكرخ': 'Baghdad', 'كرخ': 'Baghdad',
  'الرصافة': 'Baghdad', 'الرصافه': 'Baghdad',
  'الأعظمية': 'Baghdad', 'الاعظمية': 'Baghdad', 'الاعظميه': 'Baghdad',
  'الدورة': 'Baghdad', 'الدوره': 'Baghdad',
  'أبو طيارة': 'Baghdad', 'ابو طيارة': 'Baghdad', 'ابو طياره': 'Baghdad',
  'الجادرية': 'Baghdad', 'الجادريه': 'Baghdad',
  'الزعفرانية': 'Baghdad', 'الزعفرانيه': 'Baghdad',
  'البياع': 'Baghdad',
  'الشعلة': 'Baghdad', 'الشعله': 'Baghdad',
  'السيدية': 'Baghdad', 'السيديه': 'Baghdad',
  'المنصور': 'Baghdad',
  'الصالحية': 'Baghdad', 'الصالحيه': 'Baghdad',
  'الحرية': 'Baghdad', 'الحريه': 'Baghdad',
  'الكرادة': 'Baghdad', 'الكراده': 'Baghdad',
  'الطالبية': 'Baghdad', 'الطالبيه': 'Baghdad',
  'الجامعة': 'Baghdad', 'الجامعه': 'Baghdad',
  'حي المواصلات': 'Baghdad', 'المواصلات': 'Baghdad',
  'بغداد الجديدة': 'Baghdad', 'بغداد الجديده': 'Baghdad',
  'مدينة الصدر': 'Baghdad', 'الصدر': 'Baghdad',
  'النهروان': 'Baghdad',
  'أبو غريب': 'Baghdad', 'ابو غريب': 'Baghdad',
  'التاجي': 'Baghdad',
  'المحمودية': 'Baghdad', 'المحموديه': 'Baghdad',
  'اليوسفية': 'Baghdad', 'اليوسفيه': 'Baghdad',
  'اللطيفية': 'Baghdad', 'اللطيفيه': 'Baghdad',
  'الراشدية': 'Baghdad', 'الراشديه': 'Baghdad',
  'الزهور': 'Baghdad',
  'الغزالية': 'Baghdad', 'الغزاليه': 'Baghdad',
  'العامرية': 'Baghdad', 'العامريه': 'Baghdad',
  'الجهاد': 'Baghdad',
  'المعامل': 'Baghdad',
  'الرستمية': 'Baghdad', 'الرستميه': 'Baghdad',
  'البتاويين': 'Baghdad',
  'الفضل': 'Baghdad',
  'حي تونس': 'Baghdad', 'تونس': 'Baghdad',
  'الشعب': 'Baghdad',
  'العبيدي': 'Baghdad',
  'الغدير': 'Baghdad',
  'الإعلام': 'Baghdad', 'الاعلام': 'Baghdad',

  // Salahuddin (صلاح الدين)
  'صلاح الدين': 'Salahuddin',
  'تكريت': 'Salahuddin',
  'بلد': 'Salahuddin',
  'سامراء': 'Salahuddin', 'سامرا': 'Salahuddin',
  'الدور': 'Salahuddin',
  'الدجيل': 'Salahuddin',
  'بيجي': 'Salahuddin', 'بيجى': 'Salahuddin',
  'الشرقاط': 'Salahuddin',
  'الإسحاقي': 'Salahuddin', 'الاسحاقي': 'Salahuddin',
  'طوزخورماتو': 'Salahuddin', 'طوز': 'Salahuddin',
  'يثرب': 'Salahuddin',
  'الفارس': 'Salahuddin',
  'العلم': 'Salahuddin',

  // Anbar (الأنبار)
  'الأنبار': 'Anbar', 'الانبار': 'Anbar',
  'الرمادي': 'Anbar',
  'الفلوجة': 'Anbar', 'الفلوجه': 'Anbar',
  'القائم': 'Anbar', 'القايم': 'Anbar',
  'هيت': 'Anbar',
  'حديثة': 'Anbar', 'حديثه': 'Anbar',
  'الكرمة': 'Anbar', 'الكرمه': 'Anbar',
  'الخالدية': 'Anbar', 'الخالديه': 'Anbar',
  'الصقلاوية': 'Anbar', 'الصقلاويه': 'Anbar',
  'عنه': 'Anbar', 'عنة': 'Anbar',
  'راوة': 'Anbar', 'راوه': 'Anbar',

  // Basra (البصرة)
  'البصرة': 'Basra', 'البصره': 'Basra', 'بصرة': 'Basra', 'بصره': 'Basra',
  'أبو الخصيب': 'Basra', 'ابو الخصيب': 'Basra',
  'الزبير': 'Basra',
  'القرنة': 'Basra', 'القرنه': 'Basra',
  'الفاو': 'Basra',
  'سفوان': 'Basra',
  'شط العرب': 'Basra',
  'المعقل': 'Basra',
  'العشار': 'Basra',
  'الجبيلة': 'Basra', 'الجبيله': 'Basra',
  'المدينة': 'Basra', 'المدينه': 'Basra',

  // Erbil (أربيل)
  'أربيل': 'Erbil', 'اربيل': 'Erbil', 'هولير': 'Erbil',
  'شقلاوة': 'Erbil', 'شقلاوه': 'Erbil',
  'سوران': 'Erbil',
  'كويسنجق': 'Erbil',
  'كوية': 'Erbil', 'كويه': 'Erbil',
  'مخمور': 'Erbil',
  'حرير': 'Erbil',
  'چوارقورنة': 'Erbil',

  // Sulaymaniyah (السليمانية)
  'السليمانية': 'Sulaymaniyah', 'السليمانيه': 'Sulaymaniyah',
  'سليمانية': 'Sulaymaniyah', 'سليمانيه': 'Sulaymaniyah',
  'حلبجة': 'Sulaymaniyah', 'حلبجه': 'Sulaymaniyah',
  'دربندخان': 'Sulaymaniyah',
  'كلار': 'Sulaymaniyah',
  'رانية': 'Sulaymaniyah', 'رانيه': 'Sulaymaniyah',
  'بنجوين': 'Sulaymaniyah',
  'دوكان': 'Sulaymaniyah',
  'چمچمال': 'Sulaymaniyah', 'جمجمال': 'Sulaymaniyah',
  'كفري': 'Sulaymaniyah',

  // Duhok (دهوك)
  'دهوك': 'Duhok',
  'زاخو': 'Duhok',
  'العمادية': 'Duhok', 'العماديه': 'Duhok',
  'سيميل': 'Duhok',
  'بردرش': 'Duhok',
  'شيخان': 'Duhok',
  'عقرة': 'Duhok', 'عقره': 'Duhok',

  // Kirkuk (كركوك)
  'كركوك': 'Kirkuk',
  'الحويجة': 'Kirkuk', 'الحويجه': 'Kirkuk',
  'الدبس': 'Kirkuk',
  'داقوق': 'Kirkuk',

  // Najaf (النجف)
  'النجف': 'Najaf', 'نجف': 'Najaf',
  'الكوفة': 'Najaf', 'الكوفه': 'Najaf', 'كوفة': 'Najaf',
  'المناذرة': 'Najaf', 'المناذره': 'Najaf',
  'المشخاب': 'Najaf',

  // Karbala (كربلاء)
  'كربلاء': 'Karbala',
  'الحر': 'Karbala',
  'عين التمر': 'Karbala',
  'الهندية': 'Karbala', 'الهنديه': 'Karbala',

  // Mosul / Nineveh (نينوى / الموصل)
  'نينوى': 'Mosul',
  'الموصل': 'Mosul', 'موصل': 'Mosul',
  'تلعفر': 'Mosul', 'تل عفر': 'Mosul',
  'سنجار': 'Mosul', 'شنگال': 'Mosul',
  'الحمدانية': 'Mosul', 'الحمدانيه': 'Mosul',
  'بعشيقة': 'Mosul', 'بعشيقه': 'Mosul',
  'القوش': 'Mosul', 'الكوش': 'Mosul',
  'بطنايا': 'Mosul',

  // Babil (بابل)
  'بابل': 'Babil',
  'الحلة': 'Babil', 'الحله': 'Babil', 'حلة': 'Babil', 'حله': 'Babil',
  'المسيب': 'Babil',
  'الهاشمية': 'Babil', 'الهاشميه': 'Babil',
  'المحاويل': 'Babil',
  'الإسكندرية': 'Babil', 'الاسكندرية': 'Babil', 'الإسكندريه': 'Babil', 'الاسكندريه': 'Babil',
  'السدة': 'Babil', 'السده': 'Babil',
  'القاسم': 'Babil',

  // Diyala (ديالى)
  'ديالى': 'Diyala',
  'بعقوبة': 'Diyala', 'بعقوبه': 'Diyala',
  'الخالص': 'Diyala',
  'المقدادية': 'Diyala', 'المقدادیه': 'Diyala', 'المقداديه': 'Diyala',
  'بلدروز': 'Diyala',
  'خانقين': 'Diyala',
  'جلولاء': 'Diyala',
  'السعدية': 'Diyala', 'السعديه': 'Diyala',
  'المنصورية': 'Diyala', 'المنصوريه': 'Diyala',

  // Diwaniyah / Qadisiyyah
  'الديوانية': 'Diwaniyah', 'الديوانيه': 'Diwaniyah', 'ديوانية': 'Diwaniyah',
  'القادسية': 'Diwaniyah', 'القادسيه': 'Diwaniyah',
  'عفك': 'Diwaniyah',
  'الشامية': 'Diwaniyah', 'الشاميه': 'Diwaniyah',
  'الحمزة': 'Diwaniyah', 'الحمزه': 'Diwaniyah',
  'السنية': 'Diwaniyah', 'السنيه': 'Diwaniyah',

  // Dhi Qar (ذي قار)
  'ذي قار': 'Dhi Qar',
  'الناصرية': 'Dhi Qar', 'الناصريه': 'Dhi Qar', 'ناصرية': 'Dhi Qar',
  'الشطرة': 'Dhi Qar', 'الشطره': 'Dhi Qar',
  'سوق الشيوخ': 'Dhi Qar',
  'الرفاعي': 'Dhi Qar',
  'الجبايش': 'Dhi Qar',
  'النصر': 'Dhi Qar',
  'الفجر': 'Dhi Qar',

  // Maysan (ميسان)
  'ميسان': 'Maysan',
  'العمارة': 'Maysan', 'العماره': 'Maysan', 'عمارة': 'Maysan',
  'الكحلاء': 'Maysan',
  'المجر': 'Maysan',
  'علي الغربي': 'Maysan',
  'الميمونة': 'Maysan', 'الميمونه': 'Maysan',
  'قلعة صالح': 'Maysan',

  // Muthanna (المثنى)
  'المثنى': 'Muthanna',
  'السماوة': 'Muthanna', 'السماوه': 'Muthanna', 'سماوة': 'Muthanna',
  'الرميثة': 'Muthanna', 'الرميثه': 'Muthanna',
  'الخضر': 'Muthanna',
  'السلمان': 'Muthanna',
  'الوركاء': 'Muthanna',

  // Wasit (واسط)
  'واسط': 'Wasit',
  'الكوت': 'Wasit', 'كوت': 'Wasit',
  'النعمانية': 'Wasit', 'النعمانيه': 'Wasit',
  'الصويرة': 'Wasit', 'الصويره': 'Wasit',
  'بدرة': 'Wasit', 'بدره': 'Wasit',
  'الحي': 'Wasit',
  'العزيزية': 'Wasit', 'العزيزيه': 'Wasit',
  'الزبيدية': 'Wasit', 'الزبيديه': 'Wasit',
  'الصالحية': 'Wasit',  // ⚠ collision with Baghdad — last wins; Baghdad is far more common, keep up top
};

// Re-overwrite the Baghdad-vs-Wasit collision so Baghdad wins (الصالحية
// district in Baghdad is far more populated than الصالحية village in
// Wasit). The above ordering already handles it but be defensive:
R['الصالحية'] = 'Baghdad';
R['الصالحيه'] = 'Baghdad';

// Look up a city string against the map. Substring-aware: a city like
// "الدورة أبو طيارة" matches "الدورة" → Baghdad. Returns null when no
// match is found.
function lookupGovernorate(city) {
  if (!city || typeof city !== 'string') return null;
  const trimmed = city.trim();
  // Exact match first (faster + avoids substring false positives).
  if (R[trimmed]) return R[trimmed];
  // Then substring match — scan longest keys first so the most specific
  // region wins (e.g. "حي المواصلات" before "حي").
  const keys = Object.keys(R).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (trimmed.includes(k)) return R[k];
  }
  return null;
}

// ── walk + update ──────────────────────────────────────────────────────
const rows = db.prepare("SELECT id, brand, model, governorate, city FROM phone_listings WHERE status='active'").all();
const upd = db.prepare("UPDATE phone_listings SET governorate=?, updated_at=? WHERE id=?");
const now = Date.now();

console.log(`Scanning ${rows.length} active listings…\n`);
let changed = 0;
let confirmed = 0;
let unknown = 0;
for (const r of rows) {
  const looked = lookupGovernorate(r.city);
  if (!looked) {
    // No city or city not in our map — leave the gov field alone.
    if (r.city) unknown++;
    continue;
  }
  if (looked === r.governorate) {
    confirmed++;
    continue;
  }
  console.log(`  fix ${String(r.id).padStart(4)}: ${r.governorate} → ${looked}   (city: ${r.city})  [${r.brand} ${r.model}]`);
  upd.run(looked, now, r.id);
  changed++;
}

console.log(`\nDone.  changed=${changed}, confirmed=${confirmed}, unknown_city=${unknown}, no_city=${rows.length - changed - confirmed - unknown}`);
