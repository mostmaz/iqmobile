import { Platform } from 'react-native';
import RNEventSource from 'react-native-sse';
import { getBaseUrl, getToken } from '../api/client';

type Handler = (event: string, data: any) => void;

type ESLike = {
  addEventListener: (name: string, fn: (e: any) => void) => void;
  close: () => void;
};

let es: ESLike | null = null;
const handlers = new Set<Handler>();

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
  disconnectSSE();
  const token = getToken();
  if (!token) return;

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
      for (const h of handlers) h(ev, data);
    });
  }
  es.addEventListener('error', () => {});
}

export function disconnectSSE() {
  if (es) {
    try { es.close(); } catch {}
    es = null;
  }
}
