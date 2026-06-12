// Featured-listing revenue config. No payment gateway: the seller transfers
// airtime ("mobile balance send") to the owner's number, submits a request
// from the app, and an admin approves it from the dashboard. On approval the
// listing is pinned to the top of every view it matches and re-bumped a few
// times per day for the tier's duration.
//
// Amounts are IQD. The mobile app fetches these live via GET /features/tiers
// (no duplicated client copy), so editing here is enough to change the offers.
export const FEATURE_TIERS = [
  { key: 'bronze', amount: 2000, days: 2, boosts_per_day: 2, label_ar: 'برونزي' },
  { key: 'silver', amount: 5000, days: 5, boosts_per_day: 3, label_ar: 'فضي' },
  { key: 'gold', amount: 10000, days: 10, boosts_per_day: 4, label_ar: 'ذهبي' },
];

export const TIERS_BY_KEY = Object.fromEntries(FEATURE_TIERS.map((t) => [t.key, t]));

// Carriers users transfer airtime from. Lowercase canonical keys.
export const CARRIERS = ['asiacell', 'korek'];

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
