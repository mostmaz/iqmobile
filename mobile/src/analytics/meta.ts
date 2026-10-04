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

import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';

const metaAppId = (Constants.expoConfig?.extra as any)?.metaAppId as string | undefined;
const metaClientToken = (Constants.expoConfig?.extra as any)?.metaClientToken as string | undefined;

// Real credentials present? Placeholder strings ship in source until the Meta
// app is created — treat those (and empty) as "not configured". BOTH the app
// id and the client token must be real, so a half-filled config stays off
// rather than initialising the SDK with a bad token.
const isReal = (v?: string) => !!v && !v.startsWith('REPLACE_WITH_');
export const META_ENABLED = isReal(metaAppId) && isReal(metaClientToken);

let initialized = false;
let warnedDisabled = false;

// Say so, once, when Meta is off in development.
//
// Every function here fails silently by design, which is right in production —
// analytics must never break the app — but in development that silence cost a
// long debugging session: a stale simulator binary whose EMBEDDED config
// predated these keys reported META_ENABLED=false, so every event no-opped
// while Metro happily served JS that looked correct.
//
// The embedded config is the thing to suspect: expo-constants reads
// Constants.expoConfig from the app bundle, baked in at NATIVE build time, not
// from Metro. Fresh JS over an old binary cannot fix a missing key — that
// needs a rebuild.
function warnIfDisabled(context: string): void {
  if (!__DEV__ || warnedDisabled) return;
  warnedDisabled = true;
  console.warn(
    `[meta] disabled — ${context} will not be sent. ` +
    `metaAppId=${metaAppId ?? 'undefined'} metaClientToken=${metaClientToken ? 'set' : 'undefined'}. ` +
    'These come from Constants.expoConfig.extra, which is embedded at native build time: ' +
    'if they are present in app.json but undefined here, this binary is older than they are — rebuild it.',
  );
}

// Initialise the SDK and resolve iOS tracking consent. Safe to call multiple
// times; the heavy work runs once. Called from App.tsx on mount.
//
// Apple rejected 1.0.0 (3 Oct 2026, guideline 2.1) because the reviewer
// never saw the tracking prompt on iOS 27. Two reasons, both fixed here:
//   1. It was requested the instant App mounted, which on a cold launch is
//      before iOS considers the app active — and iOS silently drops an ATT
//      request from an inactive app. Now: wait until the app is active, let
//      the first screen settle, and re-check before asking.
//   2. The SDK auto-initialised and auto-logged from native code at launch,
//      before the question was asked at all. Info.plist now has
//      FacebookAutoInitEnabled / AutoLogAppEvents / AdvertiserIDCollection
//      off; the SDK starts below, after the answer, and only then logs.
// Every event waits for that (see logMetaEvent), so nothing is sent first.
let ready: Promise<void> | null = null;

function activeApp(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { sub.remove(); resolve(); }
    });
  });
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function askTracking(): Promise<boolean> {
  const { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } = await import('expo-tracking-transparency');
  let { status } = await getTrackingPermissionsAsync();
  if (status !== 'undetermined') return status === 'granted';
  // Active, settled, and still active — another system alert (the
  // notification permission) makes the app inactive, and an ATT request
  // made under it is dropped just the same.
  for (let i = 0; i < 5; i++) {
    await activeApp();
    await pause(1000);
    if (AppState.currentState === 'active') break;
  }
  ({ status } = await requestTrackingPermissionsAsync());
  return status === 'granted';
}

export function initMeta(): Promise<void> {
  if (!META_ENABLED) { warnIfDisabled('app events'); return Promise.resolve(); }
  if (ready) return ready;
  ready = (async () => {
    try {
      const { Settings } = await import('react-native-fbsdk-next');
      let tracking = true;
      if (Platform.OS === 'ios') {
        // Off until the user answers; on only if they allow.
        Settings.setAdvertiserTrackingEnabled(false);
        Settings.setAdvertiserIDCollectionEnabled(false);
        tracking = await askTracking();
        Settings.setAdvertiserTrackingEnabled(tracking);
      }
      Settings.setAdvertiserIDCollectionEnabled(tracking);
      // initializeSDK activates the app (the install/activate event Meta uses
      // for attribution) with the appID/clientToken from Info.plist.
      Settings.initializeSDK();
      Settings.setAutoLogAppEventsEnabled(true);
      initialized = true;
    } catch {
      // Never let analytics break app start-up.
      ready = null;
    }
  })();
  return ready;
}

// Log a custom App Event (e.g. 'CompleteRegistration', 'ViewContent',
// 'Contact'). Fire-and-forget; no-ops until Meta is configured.
export async function logMetaEvent(name: string, params?: Record<string, string | number>): Promise<void> {
  if (!META_ENABLED) { warnIfDisabled(`event "${name}"`); return; }
  try {
    // Nothing goes to Meta before the tracking question is answered.
    await initMeta();
    if (!initialized) return;
    const { AppEventsLogger } = await import('react-native-fbsdk-next');
    if (params) AppEventsLogger.logEvent(name, params);
    else AppEventsLogger.logEvent(name);
  } catch {
    // ignore
  }
}
