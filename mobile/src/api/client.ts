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
const prodUrl: string = extra.apiBaseUrl ?? 'http://10.0.2.2:4000';
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

const baseUrl: string =
  Platform.OS === 'web'
    ? 'http://localhost:4000'
    : (__DEV__ && devUrl ? devUrl : prodUrl);

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
  const res = await fetch(baseUrl + path, { ...init, headers });
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
