// Shopping cart for order-enabled shops.
//
// Scoped to ONE shop at a time, because an order is one shop's delivery with
// one shipping fee — a basket spanning two shops has no coherent fulfilment
// path, and the server rejects it outright (`mixed_shops`). Adding an item
// from a different shop therefore asks to start a new cart rather than
// silently producing something checkout would refuse.
//
// Persisted so a cart survives the app being killed mid-shop. Prices are
// cached only to render the basket; the SERVER prices the order at checkout,
// so a stale cached price can never become a stale charge.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CartLine {
  listing_id: number;
  brand: string;
  model: string;
  storage?: string | null;
  color?: string | null;
  image_path?: string | null;
  unit_price: number;
  qty: number;
}
interface CartState {
  shop_id: number | null;
  shop_name: string | null;
  shipping_fee: number;
  lines: CartLine[];
}
const EMPTY: CartState = { shop_id: null, shop_name: null, shipping_fee: 0, lines: [] };
const KEY = 'iq_cart_v1';
const MAX_QTY = 10;

interface CartApi extends CartState {
  ready: boolean;
  count: number;
  subtotal: number;
  total: number;
  /** false = the item belongs to a different shop; caller should confirm a reset. */
  add: (shop: { id: number; name: string; shipping_fee: number }, line: Omit<CartLine, 'qty'>, qty?: number) => boolean;
  /** Discards any existing cart and starts one for this shop. */
  replaceWith: (shop: { id: number; name: string; shipping_fee: number }, line: Omit<CartLine, 'qty'>, qty?: number) => void;
  setQty: (listingId: number, qty: number) => void;
  remove: (listingId: number) => void;
  clear: () => void;
  qtyOf: (listingId: number) => number;
}

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);
  // `ready` gates the first write: without it the initial empty state would
  // be persisted over a stored cart before the load finishes.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => { if (raw) setState({ ...EMPTY, ...JSON.parse(raw) }); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  }, [state, ready]);

  const put = useCallback((
    shop: { id: number; name: string; shipping_fee: number },
    line: Omit<CartLine, 'qty'>,
    qty: number,
  ) => {
    setState((prev) => {
      const base = prev.shop_id === shop.id
        ? prev
        : { shop_id: shop.id, shop_name: shop.name, shipping_fee: shop.shipping_fee, lines: [] };
      const existing = base.lines.find((l) => l.listing_id === line.listing_id);
      const lines = existing
        ? base.lines.map((l) => (l.listing_id === line.listing_id
          ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l))
        : [...base.lines, { ...line, qty: Math.min(MAX_QTY, qty) }];
      // Refresh the fee/name too — the shop may have changed them since the
      // cart was stored.
      return { shop_id: shop.id, shop_name: shop.name, shipping_fee: shop.shipping_fee, lines };
    });
  }, []);

  const api = useMemo<CartApi>(() => {
    const subtotal = state.lines.reduce((s, l) => s + l.unit_price * l.qty, 0);
    return {
      ...state,
      ready,
      count: state.lines.reduce((s, l) => s + l.qty, 0),
      subtotal,
      total: subtotal + (state.lines.length ? state.shipping_fee : 0),
      add: (shop, line, qty = 1) => {
        if (state.shop_id != null && state.shop_id !== shop.id && state.lines.length) return false;
        put(shop, line, qty);
        return true;
      },
      replaceWith: (shop, line, qty = 1) => {
        setState({ shop_id: shop.id, shop_name: shop.name, shipping_fee: shop.shipping_fee, lines: [] });
        // setState is queued, so `put` would read the pre-reset state and
        // see a foreign shop_id. Passing the shop explicitly makes `put`
        // rebuild from scratch anyway, so the reset above is belt-and-braces.
        put(shop, line, qty);
      },
      setQty: (listingId, qty) => setState((p) => {
        const n = Math.max(0, Math.min(MAX_QTY, Math.floor(qty)));
        if (n === 0) {
          const lines = p.lines.filter((l) => l.listing_id !== listingId);
          return lines.length ? { ...p, lines } : EMPTY;
        }
        return { ...p, lines: p.lines.map((l) => (l.listing_id === listingId ? { ...l, qty: n } : l)) };
      }),
      remove: (listingId) => setState((p) => {
        const lines = p.lines.filter((l) => l.listing_id !== listingId);
        // Emptying the cart clears the shop binding too, so the next add
        // from any shop starts cleanly instead of hitting the mismatch path.
        return lines.length ? { ...p, lines } : EMPTY;
      }),
      clear: () => setState(EMPTY),
      qtyOf: (listingId) => state.lines.find((l) => l.listing_id === listingId)?.qty || 0,
    };
  }, [state, ready, put]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart(): CartApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart must be used inside <CartProvider>');
  return v;
}
