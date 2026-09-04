// Build-time feature flags.
//
// SHOW_PROMOTE gates the paid "ميّز إعلانك" (feature-your-listing) flow AND the
// wallet that feeds it. They are one unit: balance is earned by buying a promo
// tier and spent on featuring, so a build with featuring hidden must hide the
// balance too or it advertises money with no way to earn it and nowhere to
// spend it.
//
// ON for Android. The Play artifact is built locally with gradlew, which never
// reads eas.json, and featuring has been live on Play for months.
//
// OFF for iOS, set per-platform in eas.json's production profile. Apple's
// guideline 3.1.1 requires In-App Purchase for unlocking digital features, and
// paying by airtime transfer — or from a wallet credited outside IAP — is
// exactly what that rule targets. Not worth a rejection on a build whose point
// is elsewhere. Revisit if IAP is ever added.
export const SHOW_PROMOTE = process.env.EXPO_PUBLIC_HIDE_PROMOTE !== '1';
