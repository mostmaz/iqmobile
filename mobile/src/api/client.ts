import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Two backend URLs in app.json's `extra`:
//   apiBaseUrl     → production (DigitalOcean droplet)
//   apiBaseUrlDev  → local LAN dev server (Mac running on the same Wi-Fi)
//
// Resolution rules:
//   - Web preview runs in the browser on the same machine — hit localhost
//     directly to avoid the prod CORS round-trip during dev.
//   - When __DEV__ (Expo Go / dev build) AND apiBaseUrlDev is set, prefer
//     it. To force any build to hit production, just delete or comment
//     out apiBaseUrlDev in app.json.
//   - Production builds use apiBaseUrl unconditionally.
const extra = (Constants.expoConfig?.extra as any) || {};
// The fallback is the REAL production API, not an emulator alias. It used
// to be 'http://10.0.2.2:4000', which is the Android-emulator alias for the
// host Mac and is unroutable anywhere else. Whenever `extra` came back empty
// — a debug build launched without the Metro manifest, for instance — every
// request on iOS went to that dead address, hung until the OS timeout, and
// never rejected, so the app sat on its loading state forever with no error
// in the console. Degrading to production means a missing manifest costs you
// the dev-server override, not the whole app.
const prodUrl: string = extra.apiBaseUrl ?? 'https://api.iqmobile.org';
const rawDevUrl: string | undefined = extra.apiBaseUrlDev;

// 10.0.2.2 is the Android emulator's alias for the host machine. It means
// nothing anywhere else — an iOS simulator shares the Mac's own network
// stack, so that address just times out and the app comes up with empty
// feeds. Rather than making every dev config platform-specific, translate
// the alias to localhost off Android; a dev URL that names a real host
// (a LAN IP, a tunnel) is passed through untouched.
const devUrl: string | undefined =
  rawDevUrl && Platform.OS !== 'android'
    ? rawDevUrl.replace('10.0.2.2', 'localhost')
    : rawDevUrl;

const rawBaseUrl: string =
  Platform.OS === 'web'
    ? 'http://localhost:4000'
    : (__DEV__ && devUrl ? devUrl : prodUrl);

// Final backstop: apply the alias rewrite to whatever we ended up with, not
// just to the dev URL. Any 10.0.2.2 reaching this point off Android — from
// `extra.apiBaseUrl`, from a stale cached manifest, from anywhere — would
// otherwise reproduce the silent-hang above.
const baseUrl: string =
  Platform.OS !== 'android' ? rawBaseUrl.replace('10.0.2.2', 'localhost') : rawBaseUrl;

// Read once at module load. Falls back to '0' rather than 'unknown' so an
// unparseable value still sorts below every real release in a comparison.
const APP_VERSION: string = Constants.expoConfig?.version || '0';

let _token: string | null = null;
export function setToken(token: string | null) {
  _token = token;
}
export function getToken() {
  return _token;
}
// 20s: long enough for a cold server + a slow 3G round trip, short enough
// that a dead connection surfaces as an error while the user is still
// looking at the screen.
const DEFAULT_TIMEOUT_MS = 20000;
type RequestInitWithTimeout = RequestInit & { timeoutMs?: number };

export function getBaseUrl() {
  return baseUrl;
}

export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // bypass localtunnel browser interstitial when API is tunneled via *.loca.lt
    'bypass-tunnel-reminder': 'true',
    // Identify the client on every call. The server records these against the
    // daily-active row, which is the only way to know the version spread of
    // people actually using the app — the stores report installs, not usage,
    // and can't tell you who is stuck on an old build.
    'x-app-platform': Platform.OS,
    'x-app-version': APP_VERSION,
    ...((init.headers as Record<string, string>) || {}),
  };
  if (_token) headers.authorization = `Bearer ${_token}`;

  // Every request gets a deadline. Without one a stalled socket — a phone
  // that has "signal" but no working data path, which is routine on Iraqi
  // mobile networks — leaves the promise pending forever, and a screen
  // waiting on it shows loading skeletons until the user force-quits.
  // Aborting rejects instead, so react-query can retry and then surface a
  // real error state.
  // AbortController + setTimeout rather than AbortSignal.timeout(): the
  // static helper is recent and NOT present in every Hermes build, and
  // calling a missing function here would turn every single request into a
  // failure. The controller pair has been in React Native for years.
  const timeoutMs = (init as RequestInitWithTimeout).timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  let res: Response;
  try {
    res = await fetch(baseUrl + path, {
      ...init,
      headers,
      signal: (init as any).signal ?? controller.signal,
    });
  } catch (e: any) {
    // An abort we caused is a timeout as far as callers are concerned; give
    // it a stable code so screens can tell "slow network" from "server said
    // no". Anything else is a genuine transport failure.
    if (timedOut || e?.name === 'AbortError') {
      const err: any = new Error('network_timeout');
      err.isTimeout = true;
      throw err;
    }
    const err: any = new Error('network_error');
    err.isNetwork = true;
    err.cause = e;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err: any = new Error(data?.error || `http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}
