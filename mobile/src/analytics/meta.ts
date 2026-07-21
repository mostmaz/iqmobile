// Meta (Facebook) SDK — app-install + in-app event tracking for running and
// optimising Facebook/Instagram ad campaigns. We use App Events only (no
// Facebook Login, no Audience Network).
//
// Credentials live in app.json: extra.metaAppId (mirrored) and the
// react-native-fbsdk-next plugin (appID + clientToken). Until those are
// replaced with a real Meta App ID, every function here no-ops, so the app
// runs fine before the Meta app exists.
//
// iOS 14.5+ requires App Tracking Transparency consent before the SDK may
// use the advertising identifier (IDFA). We ask once on first launch, then
// tell the SDK whether tracking is allowed.

import { Platform } from 'react-native';
import Constants from 'expo-constants';

const metaAppId = (Constants.expoConfig?.extra as any)?.metaAppId as string | undefined;

// Real credentials present? Placeholder string ships in source until the
// Meta app is created — treat it (and empty) as "not configured".
export const META_ENABLED = !!metaAppId && !metaAppId.startsWith('REPLACE_WITH_');

let initialized = false;

// Initialise the SDK and resolve iOS tracking consent. Safe to call multiple
// times; the heavy work runs once. Called from App.tsx on mount.
export async function initMeta(): Promise<void> {
  if (!META_ENABLED || initialized) return;
  initialized = true;
  try {
    const { Settings } = await import('react-native-fbsdk-next');

    // On iOS, gate advertiser tracking behind the ATT prompt. Default the
    // SDK to no-tracking first so nothing leaks before consent, then flip it
    // on only if the user allows.
    if (Platform.OS === 'ios') {
      Settings.setAdvertiserTrackingEnabled(false);
      const { requestTrackingPermissionsAsync } = await import('expo-tracking-transparency');
      const { status } = await requestTrackingPermissionsAsync();
      Settings.setAdvertiserTrackingEnabled(status === 'granted');
    }

    // initializeSDK activates the app (logs the install/activate event that
    // Meta uses for install attribution) using the appID/clientToken baked
    // in by the config plugin.
    Settings.initializeSDK();
  } catch {
    // Never let analytics break app start-up.
    initialized = false;
  }
}

// Log a custom App Event (e.g. 'CompleteRegistration', 'ViewContent',
// 'Contact'). Fire-and-forget; no-ops until Meta is configured.
export async function logMetaEvent(name: string, params?: Record<string, string | number>): Promise<void> {
  if (!META_ENABLED) return;
  try {
    const { AppEventsLogger } = await import('react-native-fbsdk-next');
    if (params) AppEventsLogger.logEvent(name, params);
    else AppEventsLogger.logEvent(name);
  } catch {
    // ignore
  }
}
