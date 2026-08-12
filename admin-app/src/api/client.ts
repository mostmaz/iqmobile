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
    throw new ApiError(0, classifyNetworkError(e), '');
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return null; }
}

/**
 * Tell apart the ways a request can fail before it reaches the server.
 *
 * These were all reported as "تعذّر الاتصال بالخادم", which is actively
 * misleading: a DNS failure ON THE DEVICE reads as "your server is down" and
 * sends you to check the server. That cost a long debugging session against a
 * perfectly healthy API — the emulator simply could not resolve any hostname.
 *
 * React Native surfaces the underlying platform error as free text, so this
 * matches on it. Matching is deliberately loose and always falls back to the
 * generic code, since the wording differs across Android versions and iOS.
 */
export function classifyNetworkError(e: any): string {
  const msg = String(e?.message || e || '').toLowerCase();
  // Android: 'Unable to resolve host "…": No address associated with hostname'
  // iOS:     'A server with the specified hostname could not be found.'
  if (msg.includes('resolve host')
    || msg.includes('no address associated')
    || msg.includes('hostname could not be found')
    || msg.includes('nodename nor servname')) return 'dns';
  // Reached the network, but nothing answered on the other end.
  if (msg.includes('failed to connect')
    || msg.includes('connection refused')
    || msg.includes('econnrefused')
    || msg.includes('connection reset')) return 'unreachable';
  if (msg.includes('no internet')
    || msg.includes('network is unreachable')
    || msg.includes('offline')) return 'offline';
  return 'network';
}

/** One place that turns an error code into something a human can act on. */
export function errorMessage(e: any): string {
  const code = e instanceof ApiError ? e.code : 'network';
  switch (code) {
    case 'dns':
      return 'تعذّر العثور على عنوان الخادم. المشكلة في إعدادات الشبكة أو DNS على هذا الجهاز، وليست في الخادم.';
    case 'unreachable':
      return 'الخادم لا يستجيب على هذا العنوان.';
    case 'offline':
      return 'لا يوجد اتصال بالإنترنت.';
    case 'timeout':
      return 'انتهت مهلة الاتصال. تحقّق من الشبكة وحاول مجدداً.';
    case 'rate_limited':
      return 'محاولات كثيرة. انتظر دقيقة ثم حاول مجدداً.';
    case 'bad_credentials':
      return 'اسم المستخدم أو كلمة المرور غير صحيحة.';
    case 'missing_fields':
      return 'أدخل اسم المستخدم وكلمة المرور.';
    case 'unauthorized':
      return 'انتهت صلاحية الجلسة. سجّل الدخول مجدداً.';
    default:
      return 'تعذّر الاتصال بالخادم.';
  }
}
