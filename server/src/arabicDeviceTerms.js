// The single Arabic→Latin device vocabulary.
//
// This used to exist twice: a smaller copy in searchNormalize.js (for buyer
// search) and a richer one in listingNameNormalize.js (for the name cleanup
// and the device picker). They drifted, and the drift was user-visible —
// "ايفون 13 برو ماكس" found listings while "تكنو بوفا 6 برو" found nothing,
// purely because بوفا had been added to one dictionary and not the other.
//
// One table, imported by both. Adding a product line here fixes search, the
// device picker and the nightly name cleanup in the same commit.

// Arabic-Indic and Eastern-Arabic-Indic digits → ASCII.
export const AR_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Collapse Arabic orthography variants so dictionary keys stay simple:
 * hamza forms → bare alef, alef maqsura → ya, taa marbuta → haa, and strip
 * tatweel + diacritics. Note this maps ة→ه, which is why the dictionary
 * carries "تكنه" as well as "تكنو" — people type both.
 */
export function normalizeArabic(s) {
  return String(s)
    .replace(/[ـً-ْ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');
}

// token (already normalizeArabic'd) → Latin. Multiple spellings per target
// are listed explicitly because users type them all.
export const DEVICE_TERMS = {
  // ─── brands ────────────────────────────────────────────────────────
  'سامسونج': 'samsung', 'سامسونغ': 'samsung', 'سمسونج': 'samsung',
  'سامسونك': 'samsung', 'سامسونگ': 'samsung',
  'ايفون': 'iphone', 'ايفونن': 'iphone', 'اايفون': 'iphone', 'آيفون': 'iphone',
  'ابل': 'apple',
  'شاومي': 'xiaomi', 'شياومي': 'xiaomi', 'اكسياومي': 'xiaomi', 'شاومى': 'xiaomi',
  'ريدمي': 'redmi', 'ريدمى': 'redmi', 'بوكو': 'poco',
  'هواوي': 'huawei', 'هاواوي': 'huawei', 'هواوى': 'huawei',
  'اوبو': 'oppo', 'فيفو': 'vivo',
  'ريلمي': 'realme', 'ريلمى': 'realme',
  // "تكنه" is what normalizeArabic makes of the very common "تكنة" typo.
  'تكنو': 'tecno', 'تيكنو': 'tecno', 'التكنو': 'tecno', 'تكنه': 'tecno', 'تكنوو': 'tecno',
  'انفنكس': 'infinix', 'انفينكس': 'infinix', 'انفينيكس': 'infinix', 'انفكس': 'infinix',
  'هونر': 'honor', 'اونر': 'honor', 'هونور': 'honor',
  'نوكيا': 'nokia', 'موتورولا': 'motorola', 'موترلا': 'motorola', 'موتو': 'moto',
  'جوجل': 'google', 'غوغل': 'google', 'قوقل': 'google',
  'ايتل': 'itel', 'سوني': 'sony', 'ون بلس': 'oneplus',

  // ─── product lines ─────────────────────────────────────────────────
  'جالكسي': 'galaxy', 'جالاكسي': 'galaxy', 'غالاكسي': 'galaxy',
  'غالكسي': 'galaxy', 'جلكسي': 'galaxy',
  'ماجك': 'magic', 'ماجيك': 'magic',
  'سبارك': 'spark', 'سبارت': 'spark', 'سبارك': 'spark',
  'كامون': 'camon', 'كمون': 'camon', 'كومون': 'camon',
  'بوفا': 'pova', 'بوغا': 'pova', 'بوفة': 'pova',
  'هوت': 'hot', 'سمارت': 'smart', 'نوفا': 'nova', 'ميت': 'mate',
  'ايباد': 'ipad', 'ايبود': 'ipod', 'بكسل': 'pixel', 'بيكسل': 'pixel',
  'نوت': 'note', 'ريدمى': 'redmi', 'دركسون': 'dragon',
  'ريتشي': 'reachy', 'رينو': 'reno', 'انجوي': 'enjoy',

  // ─── modifiers ─────────────────────────────────────────────────────
  'برو': 'pro', 'بروماكس': 'promax', 'برور': 'pro',
  'ماكس': 'max', 'مكس': 'max', 'بلس': 'plus', 'بلاس': 'plus',
  'الترا': 'ultra', 'ميني': 'mini', 'مني': 'mini', 'لايت': 'lite',
  'فولد': 'fold', 'فليب': 'flip', 'اير': 'air', 'ايير': 'air',
  'ساعه': 'watch', 'واتش': 'watch', 'جيل': 'gen',

  // ─── letter names ("اس ٢٣" → s 23) ─────────────────────────────────
  'اس': 's', 'ايه': 'a', 'سي': 'c', 'ام': 'm', 'اكس': 'x',
  'زد': 'z', 'كي': 'k', 'جي': 'g', 'تي': 't', 'واي': 'y',
  'ار': 'r', 'دي': 'd', 'اف': 'f', 'اتش': 'h', 'ان': 'n', 'يو': 'u',
  'وان': 'one', 'ون': 'one',

  // ─── spelled-out numbers ───────────────────────────────────────────
  'سفن': '7', 'ايت': '8', 'ناين': '9', 'تن': '10', 'سكس': '6', 'فايف': '5',

  // ─── storage / specs ───────────────────────────────────────────────
  'جيجا': 'gb', 'غيغا': 'gb', 'قيقا': 'gb', 'كيكا': 'gb',
  'تيرا': 'tb', 'رام': 'ram',
};

/** Look a token up, tolerating a leading definite article ("الايفون"). */
export function mapDeviceToken(tok) {
  if (DEVICE_TERMS[tok]) return DEVICE_TERMS[tok];
  if (tok.length > 3 && tok.startsWith('ال') && DEVICE_TERMS[tok.slice(2)]) {
    return DEVICE_TERMS[tok.slice(2)];
  }
  return tok;
}
