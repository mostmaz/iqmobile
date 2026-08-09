// Stock movement for storefront inventory.
//
// Only ONE rule matters here and it's easy to get wrong: a cancelled order
// must put its units back. Cash on delivery means refusals are routine — a
// meaningful share of orders come back — and if the reservation is never
// released the shop's stock drains to zero on paper while the devices are
// still sitting on the shelf, and the storefront quietly stops selling them.
//
// stock_qty NULL means the listing doesn't track stock (a private seller's
// single phone), so every mutation here is a no-op on those rows: the
// `stock_qty IS NOT NULL` guard is doing real work, not being defensive.

import { db, now } from './db.js';

/** Give back the units an order reserved. Idempotent per call site — see restoreOnce. */
export function restoreStockForOrder(orderId) {
  const items = db.prepare(
    'SELECT listing_id, qty FROM order_items WHERE order_id=? AND listing_id IS NOT NULL',
  ).all(orderId);
  if (!items.length) return 0;
  const t = now();
  const add = db.prepare(
    'UPDATE phone_listings SET stock_qty = stock_qty + ?, updated_at=? WHERE id=? AND stock_qty IS NOT NULL',
  );
  let touched = 0;
  db.transaction(() => {
    for (const it of items) touched += add.run(it.qty, t, it.listing_id).changes;
  })();
  return touched;
}

/**
 * Apply the stock consequence of an order status change.
 * Cancelling releases the reservation; every other transition leaves stock
 * alone, because the units stay committed until the order is dead.
 */
export function applyStatusToStock(order, nextStatus) {
  if (nextStatus !== 'cancelled') return 0;
  if (order.status === 'cancelled') return 0; // already released
  return restoreStockForOrder(order.id);
}
