// Every price, name, governorate and caption in one editable place. Figures
// are grounded in real IQ Mobile listings — Iraqi viewers spot an invented
// phone price instantly, so these mirror what the marketplace actually
// carries (an iPhone 13 128GB sits around 410,000 used in Baghdad).

export const AD = {
  brand: {
    name: "IQ Mobile",
    tagline: "سوق الموبايلات في العراق",
  },

  // Scene 1 — the seller who undersold: took 250,000 for a phone worth 400,000.
  problem: {
    soldFor: 250000,
    worth: 400000,
    caption: "بعت جهازك بأقل من سعره؟",
  },

  advice: {
    caption: "جرّب IQ Mobile",
    bubble: "جرّب IQ Mobile",
  },

  // Scene 3 — the three steps to publish a listing.
  steps: {
    caption: "٣ خطوات بس",
    items: [
      { icon: "camera" as const, label: "صوّر جهازك" },
      { icon: "price" as const, label: "حط سعرك" },
      { icon: "bell" as const, label: "انتظر التواصل" },
    ],
  },

  // Scene 4 — the hero. New price vs used price on a real device.
  hero: {
    device: "iPhone 13",
    capacity: "١٢٨ گيگا",
    governorate: "بغداد",
    newPrice: 650000,
    usedPrice: 410000,
    caption: "تشوف سعر الجديد جنب المستعمل",
    savingsLabel: "توفّر",
  },

  // Scene 5 — exactly one incoming message. The platform average is ~1.4
  // contacts per listing; a notification flood would be a liability.
  contact: {
    message: "أربعمية سعره؟ نظيف؟",
    caption: "تواصل مباشر — بدون تسجيل",
    channels: ["واتساب", "محادثة", "اتصال"] as const,
  },

  outro: {
    caption: "IQ Mobile — نزّله مجاناً",
    stores: ["Google Play", "App Store"] as const,
    disclaimer: "الأسعار للتوضيح فقط",
  },

  currency: "د.ع",
} as const;

// Arabic-Indic numerals with thousands separators, as prices are written
// locally: 410000 → ٤١٠,٠٠٠
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const toArabicDigits = (s: string | number) =>
  String(s).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
export const formatPrice = (n: number) =>
  toArabicDigits(Math.round(n).toLocaleString("en-US"));
