// Live updates, and getting them back after a tunnel.
//
// The old failure: `error` logged and stopped. No backoff, no re-dial, no
// AppState listener — so one dead zone killed live chat for the rest of the
// session, and the only cure was signing out. The 3s poll in ChatScreen hid
// it while a chat was open and nothing hid it anywhere else.
//
// Reconnection is deliberately quiet. A dropped SSE stream is not worth
// telling the user about: the data still arrives, just later, and the offline
// banner already covers the case where nothing is arriving at all.
import { AppState, Platform } from 'react-native';
import RNEventSource from 'react-native-sse';
import { getBaseUrl, getToken } from '../api/client';
import { isOnline, subscribeOnline } from '../lib/reachability';

type Handler = (event: string, data: any) => void;

type ESLike = {
  addEventListener: (name: string, fn: (e: any) => void) => void;
  close: () => void;
};

let es: ESLike | null = null;
const handlers = new Set<Handler>();

// Climbing backoff, capped at half a minute. Starts at a second because most
// drops are momentary; caps because a phone in a basement must not spend the
// afternoon opening sockets.
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// Set while the app deliberately has no connection (signed out, or
// disconnectSSE called), so a scheduled retry does not resurrect it.
let wanted = false;
let listenersBound = false;

function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

function scheduleReconnect() {
  if (!wanted || retryTimer) return;
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt++;
  retryTimer = setTimeout(() => { retryTimer = null; openStream(); }, delay);
}

/**
 * Rebuild on foreground and on the connection returning.
 *
 * iOS suspends the socket when the app backgrounds and does not always
 * deliver an error on resume — the stream is simply dead and silent, which
 * is indistinguishable from a quiet server. Re-dialling on foreground is the
 * only reliable fix; a redundant reconnect costs one request.
 */
function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && wanted) { attempt = 0; clearRetry(); openStream(); }
  });
  subscribeOnline((online) => {
    if (online && wanted) { attempt = 0; clearRetry(); openStream(); }
  });
}

const EVENTS = [
  'chat.message',
  'deal.proposed',
  'deal.buyer_accepted',
  'deal.seller_confirmed',
  'deal.rejected',
  'deal.cancelled',
  'deal.counter_offer',
  'deal.expired',
  'phone.unlocked',
  'rating.received',
  'listing.expired',
];

export function subscribeSSE(h: Handler) {
  handlers.add(h);
  return () => handlers.delete(h);
}

export function connectSSE() {
  wanted = true;
  attempt = 0;
  bindListeners();
  openStream();
}

function openStream() {
  closeStream();
  if (!wanted) return;
  const token = getToken();
  if (!token) return;
  // Nothing to gain from opening a socket we know cannot leave the device;
  // subscribeOnline above re-dials the moment that changes.
  if (!isOnline()) { return; }

  if (Platform.OS === 'web') {
    // Browser EventSource has no header support, so the only auth path
    // is the query string. Used only in the web preview build.
    const url = `${getBaseUrl()}/events?token=${encodeURIComponent(token)}`;
    const Native: any = (globalThis as any).EventSource;
    if (!Native) return;
    es = new Native(url) as ESLike;
  } else {
    // react-native-sse supports custom headers — use them so the JWT
    // never ends up in nginx access logs or proxy caches. The server
    // checks Authorization header first, falls back to ?token= for
    // the browser case above.
    const url = `${getBaseUrl()}/events`;
    // @ts-ignore — RNEventSource accepts a second-arg options bag
    es = new RNEventSource(url, { headers: { Authorization: `Bearer ${token}` } }) as ESLike;
  }
  for (const ev of EVENTS) {
    es.addEventListener(ev, (e: any) => {
      let data: any = null;
      try { data = JSON.parse(e.data); } catch {}
      // Logged so we can confirm via `adb logcat -s ReactNativeJS` whether
      // live updates are actually arriving on this device — silent SSE
      // failures are hard to tell apart from "server didn't send" otherwise.
      console.log('[SSE]', ev, data);
      for (const h of handlers) h(ev, data);
    });
  }
  es.addEventListener('open', () => {
    // Only a stream that actually opened may reset the backoff. Resetting on
    // the attempt instead would turn a server that accepts and immediately
    // drops connections into a one-second reconnect loop.
    attempt = 0;
    console.log('[SSE] open');
  });
  es.addEventListener('error', (e: any) => {
    console.log('[SSE] error', e?.type, e?.message || '');
    closeStream();
    scheduleReconnect();
  });
}

function closeStream() {
  if (es) {
    try { es.close(); } catch {}
    es = null;
  }
}

export function disconnectSSE() {
  wanted = false;
  clearRetry();
  attempt = 0;
  closeStream();
}
