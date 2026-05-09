import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Mobile uses the tunnel URL from app.json so devices on any network can
// reach the dev server. Web preview runs in the browser on the same
// machine — bypass the tunnel and hit localhost directly to avoid
// Cloudflare's browser-only challenge interstitial.
const tunnelUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl ?? 'http://10.0.2.2:4000';
const baseUrl: string = Platform.OS === 'web' ? 'http://localhost:4000' : tunnelUrl;

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
