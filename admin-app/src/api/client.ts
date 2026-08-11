// Thin fetch wrapper for the admin API.
//
// Two things the marketplace client learned the hard way and this one starts
// with: every request carries a timeout (a hung request is indistinguishable
// from a slow one, and the UI has no way to recover), and AbortSignal.timeout
// is NOT available in this Hermes build — it has to be AbortController plus a
// setTimeout, or every call throws immediately on a missing global.

import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as Record<string, string>;

export const API_BASE = __DEV__
  ? (extra.apiBaseUrlDev || 'http://10.0.2.2:4000')
  : (extra.apiBaseUrl || 'https://api.iqmobile.org');

const DEFAULT_TIMEOUT_MS = 15000;

let token: string | null = null;
export function setToken(t: string | null) { token = t; }
export function getTokenSync() { return token; }

/** Thrown for any non-2xx so callers can branch on `.status` / `.code`. */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  try {
    const res = await fetch(API_BASE + path, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });

    const text = await res.text();
    const body = text ? safeJson(text) : null;

    if (!res.ok) {
      throw new ApiError(res.status, body?.error || `http_${res.status}`);
    }
    return body as T;
  } catch (e: any) {
    if (timedOut) throw new ApiError(0, 'timeout', 'انتهت مهلة الاتصال');
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'network', 'تعذّر الاتصال بالخادم');
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return null; }
}
