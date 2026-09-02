// Featured-listing revenue config. No payment gateway: the seller transfers
// airtime ("mobile balance send") to the owner's number, submits a request
// from the app, and an admin approves it from the dashboard. On approval the
// listing is pinned to the top of every view it matches and re-bumped a few
// times per day for the tier's duration.
//
// Amounts are IQD. The mobile app fetches these live via GET /features/tiers
// (no duplicated client copy), so editing here is enough to change the offers.
export const FEATURE_TIERS = [
  // LAUNCH PROMOTION (added 2026-09-02). The gold package — 10 days, 4 boosts
  // a day — at half price. Listed first so it leads the sheet.
  //
  // While this runs it strictly dominates silver (5000 for 5 days) and gold
  // (10000 for the same 10 days), so both are dead offers; decide whether to
  // hide them rather than leave a shopper comparing an offer nobody would take.
  //
  // To END the promotion, delete this line and deploy. Requests already filed
  // under it stay valid: the row snapshots amount/days/boosts_per_day at submit
  // time and the approve path falls back to those when the key is gone.
  { key: 'promo', amount: 5000, days: 10, boosts_per_day: 4, label_ar: 'عرض خاص · باقة ١٠٠٠٠ بـ٥٠٠٠' },
  { key: 'bronze', amount: 2000, days: 2, boosts_per_day: 2, label_ar: 'برونزي' },
  { key: 'silver', amount: 5000, days: 5, boosts_per_day: 3, label_ar: 'فضي' },
  { key: 'gold', amount: 10000, days: 10, boosts_per_day: 4, label_ar: 'ذهبي' },
];

export const TIERS_BY_KEY = Object.fromEntries(FEATURE_TIERS.map((t) => [t.key, t]));

// Carriers users transfer airtime from. Lowercase canonical keys.
export const CARRIERS = ['asiacell', 'korek', 'qicard'];

// Qi Card transfers land on this account — shown in-app once a tier is
// chosen (qicard has no USSD template; the user transfers from their Qi
// app and we match the incoming transfer by the sender's account name).
export const QI_CARD = { account: '7117114582', name: 'مصطفى مازن' };

// Airtime transfers must come from a SIM of the receiving network —
// Asiacell numbers are 077x, Korek 075x. Validated on both ends.
export const CARRIER_PREFIXES = { asiacell: '077', korek: '075' };

// Shop-level featuring (ميّز متجري) — requested from the merchant panel,
// paid the same three ways as listing featuring. Amounts are IQD; edit
// here to change the offer (served live, no deploy of the panel needed).
export const SHOP_FEATURE_TIERS = [
  { key: 'week', amount: 10000, days: 7, label_ar: 'أسبوع' },
  { key: 'half', amount: 20000, days: 15, label_ar: 'نصف شهر' },
  { key: 'month', amount: 35000, days: 30, label_ar: 'شهر كامل' },
];

// Owner contact. OWNER_PHONE is the primary (Asiacell) line; OWNER_WHATSAPP is
// the wa.me number the banner "contact us" form opens. Digits only for
// wa.me (country code + number, no +).
export const OWNER_PHONE = '07736969091';
export const OWNER_WHATSAPP = '9647736969091';

// Per-carrier receiving numbers + the USSD dial codes that perform the
// balance transfer. The app fills {amount} (tier price in IQD) and {number}
// (the matching receiving number below), then opens the dialer with the
// result. Served via GET /features/tiers so changing a SIM here doesn't
// require an app update. NOTE the operand order differs between carriers:
//   Asiacell: *133*<amount>*<recipient>#
//   Korek:    *123*<recipient>*<amount>#
export const TRANSFER_NUMBERS = {
  asiacell: '07736969091',
  korek: '07502062804',
};
export const USSD_TEMPLATES = {
  asiacell: '*133*{amount}*{number}#',
  korek: '*123*{number}*{amount}#',
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function tierFor(key) {
  return TIERS_BY_KEY[key] || null;
}

// Given a tier, the boost interval in ms (24h / boosts_per_day) and the
// total featured duration in ms.
export function tierTiming(tier) {
  return {
    durationMs: tier.days * DAY_MS,
    boostIntervalMs: Math.floor(DAY_MS / Math.max(1, tier.boosts_per_day)),
  };
}
