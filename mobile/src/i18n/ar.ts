// Arabic strings — RTL only build. This is the source dictionary; the
// exported `ar` below is a LIVE object whose contents are swapped in
// place when the user picks a language (Kurdish), so every screen that
// reads `ar.section.key` at render time sees the active language.
const AR = {
  app: { name: 'IQ Mobile', tagline: 'سوق الموبايل المستعمل والجديد' },
  auth: {
    login: 'تسجيل الدخول',
    register: 'إنشاء حساب',
    phone: 'رقم الهاتف',
    password: 'كلمة المرور',
    displayName: 'الاسم',
    governorate: 'المحافظة',
    city: 'القضاء',
    submit: 'تأكيد',
    logout: 'تسجيل الخروج',
    haveAccount: 'لديك حساب؟ تسجيل الدخول',
    noAccount: 'ليس لديك حساب؟ إنشاء حساب',
  },
  tabs: {
    browse: 'تصفح',
    search: 'بحث',
    saved: 'المفضلة',
    sell: 'بيع',
    chats: 'المحادثات',
    profile: 'حسابي',
  },
  browse: {
    title: 'أحدث الإعلانات',
    search: 'ابحث عن موديل…',
    filter: 'تصفية',
    none: 'لا توجد إعلانات',
    verifiedOnly: 'بائعون موثقون فقط',
    allBrands: 'كل العلامات',
    allConditions: 'كل الحالات',
    allGovs: 'كل المحافظات',
    minPrice: 'الحد الأدنى',
    maxPrice: 'الحد الأقصى',
    apply: 'تطبيق',
    clear: 'إعادة',
  },
  listing: {
    new: 'جديد',
    used: 'مستعمل',
    repaired: 'مصلح',
    refurbished: 'مجدد',
    active: 'نشط',
    reserved: 'محجوز',
    sold: 'مباع',
    expired: 'منتهي',
    removed: 'محذوف',
    asking: 'السعر المطلوب',
    storage: 'السعة',
    color: 'اللون',
    battery: 'صحة البطارية',
    warranty: 'الكفالة',
    accessories: 'الملحقات',
    description: 'الوصف',
    chat: 'محادثة البائع',
    chatShop: 'محادثة المتجر',
    phoneLocked: 'رقم البائع يُكشف بعد تأكيد السعر من الطرفين',
    callSeller: 'اتصال بالبائع',
    save: 'حفظ',
    saved: '✓ محفوظ',
    report: 'إبلاغ',
    rate: 'تقييم البائع',
    by: 'البائع',
    individualSeller: 'بائع فردي',
    shopSeller: 'محل / متجر',
    shopYears: 'سنوات في السوق',
    edit: 'تعديل',
    markSold: 'تحديد كمباع',
    remove: 'حذف',
    renew: 'تجديد',
    buyerChats: 'محادثات المشترين',
  },
  post: {
    title: 'انشر إعلان جديد',
    step1: 'العلامة والموديل',
    step2: 'المواصفات',
    step3: 'السعر والموقع',
    step4: 'الصور',
    step5: 'النشر',
    next: 'التالي',
    back: 'رجوع',
    publish: 'نشر',
    addImages: 'أضف الصور',
    needAtLeast3: 'مطلوب 3 صور على الأقل (أمام، خلف، جانب/علبة)',
    front: 'أمامية',
    back2: 'خلفية',
    side: 'جانبية',
    box: 'علبة / ملحقات',
  },
  chat: {
    listingHeader: 'يخص الإعلان',
    proposePrice: 'اقتراح السعر النهائي',
    enterPrice: 'أدخل السعر النهائي',
    sellerProposed: 'اقترح البائع سعراً نهائياً',
    accept: 'موافق على السعر',
    reject: 'رفض',
    counter: 'عرض مضاد',
    confirmDeal: 'تأكيد الصفقة',
    buyerAccepted: 'وافق المشتري — تأكيد الصفقة',
    cancel: 'إلغاء',
    quick: 'رد سريع',
    blockedHint: 'لا يمكن إرسال أرقام هاتف قبل تأكيد الصفقة',
    type: 'اكتب رسالة…',
    phoneUnlocked: 'تم تأكيد الصفقة — رقم البائع متاح',
    empty: 'لا توجد محادثات بعد — تصفح إعلاناً وابدأ محادثة مع البائع.',
    emptyTitle: 'لا توجد محادثات بعد',
    emptyDesc: 'ابدأ بتصفح الإعلانات وافتح محادثة مع البائع.',
    emptyCta: 'تصفح الإعلانات',
    emptyForListing: 'لا توجد محادثات لهذا الإعلان بعد.',
    newMessage: 'رسالة جديدة',
    fallbackUser: 'مستخدم',
    listingMissing: 'إعلان غير متاح',
    noMessagesTitle: 'لا توجد رسائل بعد',
    noMessagesDesc: 'ابدأ المحادثة برسالة قصيرة — مثلاً "هل المنتج متوفر؟"',
  },
  deal: {
    proposed: 'اقتراح سعر',
    buyer_accepted: 'موافقة المشتري',
    seller_confirmed: 'صفقة مؤكدة',
    rejected: 'مرفوض',
    cancelled: 'ملغى',
    expired: 'منتهي',
  },
  profile: {
    title: 'حسابي',
    listings: 'إعلاناتي',
    deals: 'صفقاتي',
    saved: 'المفضلة',
    notifications: 'الإشعارات',
    edit: 'تعديل المعلومات',
    orders: 'طلباتي',
    savedSearches: 'عمليات البحث المحفوظة',
    wishlist: 'قائمة الرغبات',
    shops: 'المتاجر',
    shopManage: 'إدارة متجري',
    shopRegister: 'سجّل متجرك',
    advertise: 'أعلن معنا',
    how: 'كيف يعمل التطبيق',
    deleteAccount: 'حذف الحساب',
    lists: 'القوائم',
    statListings: 'إعلان',
    statRatings: 'تقييم',
  },
  rate: {
    title: 'قيّم تجربتك',
    submit: 'إرسال التقييم',
    leaveComment: 'ملاحظة (اختياري)',
  },
  // Server error codes → Arabic. Every code returned by the API that
  // can plausibly land in front of a user lives here. Anything missing
  // falls through to the raw English snake_case via the
  //   (ar.errors as any)[e.message] || ar.errors.network
  // pattern used at the call sites — so adding a new code is just a
  // matter of dropping a line in here.
  errors: {
    // Auth / account
    bad_credentials: 'بيانات تسجيل الدخول غير صحيحة',
    guest_blocked: 'يجب إنشاء حساب للمتابعة.',
    user_suspended: 'تم تعليق حسابك. تواصل مع الدعم.',
    phone_taken: 'رقم الهاتف مستخدم مسبقاً',
    weak_password: 'كلمة المرور قصيرة',
    bad_phone: 'رقم الهاتف غير صحيح',
    bad_code: 'الرمز غير صحيح',
    otp_send_failed: 'تعذّر إرسال الرمز، حاول مرة أخرى',
    otp_check_failed: 'تعذّر التحقق من الرمز، حاول مرة أخرى',
    otp_rate_limited: 'تم إرسال عدة محاولات، انتظر قليلاً ثم أعد المحاولة',
    otp_not_configured: 'خدمة التحقق غير متاحة حالياً',
    bad_contact_phone: 'رقم التواصل غير صحيح',
    bad_contact_whatsapp: 'رقم واتساب غير صحيح',
    name_too_short: 'الاسم قصير جداً',
    name_edit_limit_reached: 'لا يمكن تعديل الاسم أكثر من مرتين',
    shop_image_edit_limit_reached: 'لا يمكن تعديل صورة المتجر أكثر من مرتين',
    shop_location_edit_limit_reached: 'لا يمكن تعديل موقع المتجر أكثر من مرتين',
    shop_image_required: 'صورة المتجر مطلوبة',
    shop_location_required: 'موقع المتجر مطلوب',
    unauthorized: 'يجب تسجيل الدخول للمتابعة',
    forbidden: 'لا تملك صلاحية تنفيذ هذا الإجراء',
    // Listings
    bad_governorate: 'محافظة غير صحيحة',
    bad_brand: 'علامة غير صحيحة',
    bad_condition: 'حالة غير صحيحة',
    bad_price: 'سعر غير صحيح',
    bad_status: 'حالة إعلان غير صحيحة',
    listing_quality: 'يبدو أن الإعلان لجهاز معطّل أو مكسور أو مقفول. يُرجى نشر الأجهزة بحالة جيدة فقط.',
    missing_fields: 'يرجى تعبئة جميع الحقول المطلوبة',
    not_found: 'العنصر غير موجود أو تم حذفه',
    listing_not_active: 'الإعلان غير نشط',
    listing_expired: 'انتهت صلاحية الإعلان',
    cannot_renew: 'لا يمكن تجديد هذا الإعلان حالياً',
    listing_hourly_limit: 'يمكنك نشر إعلان واحد كل ساعة. حاول لاحقاً.',
    price_too_low: 'لا نقبل أي جهاز بسعر أقل من 100,000 د.ع.',
    // Images
    too_many_images: 'الحد الأقصى 10 صور',
    not_image: 'الملف ليس صورة',
    empty_image: 'الصورة فارغة',
    no_file: 'لم يتم اختيار صورة',
    no_files: 'لم يتم اختيار صور',
    image_too_large: 'الصورة كبيرة جداً (الحد الأقصى 5 ميغابايت)',
    // Chat / deals
    cannot_chat_self: 'لا يمكنك محادثة نفسك',
    empty_message: 'الرسالة فارغة',
    bad_state: 'لا يمكن تنفيذ هذه العملية الآن',
    seller_only: 'البائع فقط يمكنه تنفيذ هذا الإجراء',
    buyer_only: 'المشتري فقط يمكنه تنفيذ هذا الإجراء',
    not_confirmed: 'يجب تأكيد الصفقة أولاً',
    already_rated: 'تم التقييم مسبقاً',
    bad_stars: 'تقييم غير صحيح',
    bad_reason: 'سبب غير صحيح',
    // Generic
    rate_limited: 'محاولات كثيرة جداً — حاول لاحقاً',
    internal: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
    network: 'خطأ في الاتصال',
  },
};

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ku } from './ku';

export type Lang = 'ar' | 'ku';
export type Strings = typeof AR;

// The LIVE dictionary. A stable object reference (so no import breaks) whose
// contents are replaced in place by setLang. Starts as Arabic.
export const ar: Strings = JSON.parse(JSON.stringify(AR));

const DICTS: Record<Lang, any> = { ar: AR, ku };
let currentLang: Lang = 'ar';
const listeners = new Set<(l: Lang) => void>();

// Deep in-place replace: for identical shapes this keeps `ar`'s reference
// stable while every leaf becomes the new language's string.
function applyInto(target: any, src: any) {
  for (const k of Object.keys(target)) {
    if (!(k in src)) continue;
    if (typeof target[k] === 'object' && target[k] !== null) applyInto(target[k], src[k]);
    else target[k] = src[k];
  }
}

export function getLang(): Lang { return currentLang; }
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Swap the active language, persist it, and notify subscribers (the root
// remounts the tree so all strings refresh).
export async function setLang(lang: Lang) {
  if (!DICTS[lang]) return;
  applyInto(ar, DICTS[lang]);
  currentLang = lang;
  listeners.forEach((fn) => fn(lang));
  try { await AsyncStorage.setItem('app_lang', lang); } catch {}
}

// Restore the saved language on launch. Call once before rendering the tree.
export async function loadLang(): Promise<Lang> {
  try {
    const saved = (await AsyncStorage.getItem('app_lang')) as Lang | null;
    if (saved && DICTS[saved] && saved !== currentLang) {
      applyInto(ar, DICTS[saved]);
      currentLang = saved;
    }
  } catch {}
  return currentLang;
}

export const t = (path: string): string => {
  const parts = path.split('.');
  let cur: any = ar;
  for (const p of parts) cur = cur?.[p];
  return typeof cur === 'string' ? cur : path;
};
