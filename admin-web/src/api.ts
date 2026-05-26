const TOKEN_KEY = 'iq_admin_token';
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setStoredToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

// API base URL. In dev (vite dev server) we proxy /admin → localhost:4001
// so relative paths work. In production the bundled app is served from
// iqmobile.org/dashboard/, but the API lives at api.iqmobile.org — so we
// switch to the absolute URL there. import.meta.env.PROD is true during
// `npm run build` output and false for `npm run dev`.
const API_BASE = import.meta.env.PROD ? 'https://api.iqmobile.org' : '';

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err: any = new Error(data?.error || `http_${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}
