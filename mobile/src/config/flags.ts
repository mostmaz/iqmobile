// Build-time feature flags.
//
// SHOW_PROMOTE gates the paid "ميّز إعلانك" (feature-your-listing) flow, and
// with it the wallet's only spend path — the two ship together or not at all.
//
// It is ON everywhere, including the store builds. It was briefly set off for
// the EAS production profile out of caution over Google Play's Payments policy
// and Apple 3.1.1, both of which require their own billing for unlocking
// digital features. That never reached Play in practice: the Android artifacts
// are built locally with gradlew, which does not read eas.json, so the shipped
// store app has always shown featuring. The config now matches what ships.
//
// The switch is kept rather than deleted: if a review ever does object, setting
// EXPO_PUBLIC_HIDE_PROMOTE=1 on the build removes the entry points again with
// no code change.
export const SHOW_PROMOTE = process.env.EXPO_PUBLIC_HIDE_PROMOTE !== '1';
