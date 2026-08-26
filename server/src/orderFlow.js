// COD-order lifecycle shared between the admin dashboard and the per-shop
// merchant panel. Linear on purpose: pending → confirmed → shipped →
// delivered, cancel available until delivery; the map rejects impossible
// writes (delivered → shipped, resurrecting a cancelled order).
export const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
export const ORDER_NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

// Customer-facing push/inbox text per transition. The body leads with the
// order code and the amount due — that's what the customer needs on a lock
// screen when the courier knocks.
export function orderStatusNotification(order, next) {
  const AR = {
    confirmed: 'تم تأكيد طلبك',
    shipped: 'طلبك في الطريق',
    delivered: 'تم تسليم طلبك',
    cancelled: 'أُلغي طلبك',
  };
  if (!AR[next]) return null;
  const money = `${Number(order.total || 0).toLocaleString('en-US')} د.ع`;
  const body = next === 'shipped' || next === 'confirmed'
    ? `${order.code} · ${money} تُدفع عند الاستلام`
    : `${order.code} · ${money}`;
  return { title: AR[next], body };
}
