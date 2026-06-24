// Build-time feature flags.
//
// SHOW_PROMOTE gates the paid "ميّز إعلانك" (feature-your-listing) flow, which
// is paid via airtime/USSD transfer. Google Play's Payments policy requires
// Google Play Billing for unlocking in-app digital features, so we hide this
// entry point in the Play Store artifact while keeping it for direct/sideload
// distribution (and pending the iOS IAP decision).
//
// Default ON. The Play build is produced with EXPO_PUBLIC_HIDE_PROMOTE=1, which
// Expo inlines at bundle time, flipping this off for that artifact only — no
// committed code change, so every other build keeps the feature.
export const SHOW_PROMOTE = process.env.EXPO_PUBLIC_HIDE_PROMOTE !== '1';
