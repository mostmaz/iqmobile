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
//
// The prod URL is gated on the page's own hostname, not just on PROD:
// the same built bundle is also served by the LOCAL test server
// (http://<mac-ip>:4400/dashboard) for testing unreleased features, and a
// hardcoded prod base there silently sent logins to the production API —
// wrong server, wrong password, blocked by CORS. Off the iqmobile.org
// domains the API is always the origin that served the page.
// Exported because the Import page needs it for the FormData upload
// (which can't go through api() — that helper sets a JSON content-type).
export const API_BASE =
  import.meta.env.PROD && window.location.hostname.endsWith('iqmobile.org')
    ? 'https://api.iqmobile.org'
    : '';

// Multipart helper for file uploads. Unlike api() it must NOT set a JSON
// content-type — the browser sets the multipart boundary itself.
export async function apiForm<T = any>(path: string, form: FormData, method = 'POST'): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { method, headers, body: form });
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
