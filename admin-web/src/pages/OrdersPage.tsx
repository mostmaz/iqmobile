// Order fulfilment queue for the COD storefront.
//
// The job this page does is a phone call: read the customer's name, number
// and address, ring them, then move the order along. So the address and the
// number are always visible on the row — not hidden behind an expander — and
// the line items sit right under them for the picking list.
//
// Status buttons only ever offer LEGAL next steps (the server enforces the
// same map and answers 409 otherwise), so there's no way to click an order
// from delivered back to shipped.

import React, { useEffect, useMemo, useState } from 'react';
import { api, API_BASE } from '../api';

type OrderItem = {
  id: number; listing_id: number | null; brand: string; model: string;
  storage: string | null; color: string | null; image_path: string | null;
  unit_price: number; qty: number; line_total: number;
};
type Order = {
  id: number; code: string; shop_id: number; shop_name: string | null;
  user_id: number | null; customer_name: string; customer_phone: string;
  governorate: string; address: string; note: string | null;
  subtotal: number; shipping_fee: number; total: number;
  payment_method: string; status: OrderStatus; cancel_reason: string | null;
  created_at: number; updated_at: number;
  items: OrderItem[];
};
type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

const STATUS_AR: Record<OrderStatus, string> = {
  pending: 'جديد',
  confirmed: 'مؤكّد',
  shipped: 'قيد التوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};
// Mirrors ORDER_NEXT on the server. Kept in sync deliberately: the client
// only *offers* transitions, the server is what enforces them.
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};
const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: '#E0A33E', confirmed: '#378ADD', shipped: '#7F77DD',
  delivered: '#34C77B', cancelled: '#E05C4B',
};
const TABS: Array<{ key: '' | OrderStatus; label: string }> = [
  { key: '', label: 'الكل' },
  { key: 'pending', label: 'جديد' },
  { key: 'confirmed', label: 'مؤكّد' },
  { key: 'shipped', label: 'قيد التوصيل' },
  { key: 'delivered', label: 'تم التسليم' },
  { key: 'cancelled', label: 'ملغي' },
];

const GOV_AR: Record<string, string> = {
  Baghdad: 'بغداد', Basra: 'البصرة', Erbil: 'اربيل', Sulaymaniyah: 'السليمانية',
  Duhok: 'دهوك', Kirkuk: 'كركوك', Najaf: 'النجف', Karbala: 'كربلاء',
  Mosul: 'الموصل', Anbar: 'الأنبار', Babil: 'بابل', Diyala: 'ديالى',
  Diwaniyah: 'الديوانية', 'Dhi Qar': 'ذي قار', Maysan: 'ميسان',
  Muthanna: 'المثنى', Salahuddin: 'صلاح الدين', Wasit: 'واسط',
};

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');
const when = (ms: number) => new Date(ms).toLocaleString('en-GB', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

const ERRORS: Record<string, string> = {
  bad_transition: 'لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية.',
  bad_status: 'حالة غير صالحة.',
  not_found: 'الطلب غير موجود (ربما حُذف من نافذة أخرى).',
};
const friendly = (e: any) => ERRORS[e?.message] || e?.message || 'خطأ غير متوقع';

export function OrdersPage({ onChanged }: { onChanged?: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<'' | OrderStatus>('pending');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (tab) p.set('status', tab);
      if (q.trim()) p.set('q', q.trim());
      const r = await api<{ total: number; counts: Record<string, number>; orders: Order[] }>(
        `/admin/orders?${p.toString()}`);
      setOrders(r.orders); setCounts(r.counts); setTotal(r.total); setErr('');
    } catch (e: any) { setErr(friendly(e)); } finally { setLoading(false); }
  }

  // Debounced so typing in search doesn't fire a request per keystroke.
  useEffect(() => { const h = setTimeout(load, 300); return () => clearTimeout(h); }, [tab, q]);

  async function move(o: Order, status: OrderStatus) {
    if (status === 'cancelled' && !confirm(
      `إلغاء الطلب ${o.code}؟\n${o.customer_name} · ${iqd(o.total)} د.ع\n\nسيصل إشعار للزبون بالإلغاء.`
    )) return;
    setBusy(o.id);
    try {
      await api(`/admin/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load();
      onChanged?.();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(null); }
  }

  const revenue = useMemo(
    () => orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0),
    [orders],
  );

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chart-title" style={{ marginLeft: 'auto' }}>
            الطلبات ({total.toLocaleString('en-US')})
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث برقم الطلب، الاسم، الهاتف أو العنوان…"
            style={{ minWidth: 280 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {TABS.map((t) => (
            <button
              key={t.key || 'all'}
              className={tab === t.key ? 'primary' : 'secondary'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key && counts[t.key] ? ` (${counts[t.key]})` : ''}
            </button>
          ))}
        </div>

        {orders.length ? (
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            مجموع الطلبات المعروضة (بدون الملغاة): <strong>{iqd(revenue)} د.ع</strong>
          </div>
        ) : null}
      </div>

      {loading ? <div className="card muted">Loading…</div> : null}

      {!loading && !orders.length ? (
        <div className="card muted" style={{ textAlign: 'center', padding: 32 }}>
          لا توجد طلبات {tab ? `بحالة "${STATUS_AR[tab as OrderStatus]}"` : ''}.
        </div>
      ) : null}

      {orders.map((o) => (
        <div className="card" key={o.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              background: STATUS_COLOR[o.status], color: '#fff', borderRadius: 999,
              padding: '3px 10px', fontSize: 12, fontWeight: 500,
            }}>
              {STATUS_AR[o.status]}
            </span>
            <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{o.code}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{when(o.created_at)}</span>
            <span className="muted" style={{ fontSize: 12 }}>{o.shop_name}</span>
            <strong style={{ marginRight: 'auto', color: 'var(--text-accent, #D9583A)' }}>
              {iqd(o.total)} د.ع
            </strong>
          </div>

          {/* Everything needed to make the delivery call, in one block. */}
          <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 14 }}>
            <div><strong>{o.customer_name}</strong> · <a href={`tel:${o.customer_phone}`} style={{ fontFamily: 'ui-monospace, monospace' }}>{o.customer_phone}</a></div>
            <div>{GOV_AR[o.governorate] || o.governorate} — {o.address}</div>
            {o.note ? <div className="muted">ملاحظة: {o.note}</div> : null}
            {o.cancel_reason ? <div className="muted">سبب الإلغاء: {o.cancel_reason}</div> : null}
          </div>

          <div style={{ marginTop: 10, borderTop: '1px solid var(--border, #333)', paddingTop: 8 }}>
            {o.items.map((it) => (
              <div key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0' }}>
                {it.image_path ? (
                  <img src={API_BASE + it.image_path} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
                ) : <div style={{ width: 40, height: 40, borderRadius: 6, background: '#2a2a2a' }} />}
                <div style={{ flex: 1, fontSize: 13 }}>
                  {it.brand} {it.model}
                  {it.storage ? ` · ${it.storage}` : ''}{it.color ? ` · ${it.color}` : ''}
                  {it.qty > 1 ? <strong> × {it.qty}</strong> : null}
                </div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{iqd(it.line_total)}</div>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              البضاعة {iqd(o.subtotal)} + التوصيل {iqd(o.shipping_fee)} = <strong>{iqd(o.total)} د.ع</strong> (الدفع عند الاستلام)
            </div>
          </div>

          {NEXT[o.status].length ? (
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {NEXT[o.status].map((s) => (
                <button
                  key={s}
                  className={s === 'cancelled' ? 'secondary' : 'primary'}
                  disabled={busy === o.id}
                  onClick={() => move(o, s)}
                  style={s === 'cancelled' ? { color: 'salmon' } : undefined}
                >
                  {s === 'cancelled' ? 'إلغاء' : `→ ${STATUS_AR[s]}`}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
