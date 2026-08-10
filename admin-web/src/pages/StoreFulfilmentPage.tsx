// Dispatch sheet: what leaves the shop today.
//
// This page exists because the order queue answers "what is the state of
// order IQ-1042" while dispatch asks two completely different questions:
// which devices do I pull off the shelf, and what do I staple to each bag.
// Both are paper jobs, so both print — the pick list aggregates by device
// (five orders wanting the same phone is one line saying ×5, not five lines
// to hunt through), and the slips are one per order with the address and
// the amount the courier collects in the largest type on the page.
//
// Everything prints from the browser. A courier integration would be a
// bigger commitment than this shop needs today, and paper is what the
// delivery guy actually carries.

import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../api';

type Item = { brand: string; model: string; storage: string | null; color: string | null; qty: number };
type Order = {
  id: number; code: string; status: string; customer_name: string; customer_phone: string;
  governorate: string; address: string; note: string | null;
  subtotal: number; shipping_fee: number; total: number;
  courier: string | null; tracking_note: string | null; delivery_cost: number | null;
  returned_at: number | null; created_at: number;
  items: Item[];
};

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');
const GOV_AR: Record<string, string> = {
  Baghdad: 'بغداد', Basra: 'البصرة', Erbil: 'أربيل', Sulaymaniyah: 'السليمانية',
  Duhok: 'دهوك', Kirkuk: 'كركوك', Najaf: 'النجف', Karbala: 'كربلاء', Nineveh: 'نينوى',
  Anbar: 'الأنبار', Babil: 'بابل', Diyala: 'ديالى', DhiQar: 'ذي قار', Maysan: 'ميسان',
  Muthanna: 'المثنى', Qadisiyyah: 'القادسية', SalahAlDin: 'صلاح الدين', Wasit: 'واسط', Halabja: 'حلبجة',
};
const gov = (g: string) => GOV_AR[g] || g;

// Confirmed and shipped are what's physically in play: confirmed still needs
// picking, shipped is already with the courier but not yet paid for.
const DISPATCH_STATES = ['confirmed', 'shipped'];

export function StoreFulfilmentPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ orders: Order[] }>('/admin/orders');
      const live = r.orders.filter((o) => DISPATCH_STATES.includes(o.status));
      setOrders(live);
      setSel(new Set(live.map((o) => o.id)));
      setErr('');
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const chosen = useMemo(() => orders.filter((o) => sel.has(o.id)), [orders, sel]);

  // Pick list: one row per distinct device across every selected order.
  const pick = useMemo(() => {
    const m = new Map<string, { label: string; qty: number; orders: string[] }>();
    for (const o of chosen) {
      for (const it of o.items) {
        const label = [it.brand, it.model, it.storage, it.color].filter(Boolean).join(' · ');
        const cur = m.get(label) || { label, qty: 0, orders: [] };
        cur.qty += it.qty;
        cur.orders.push(o.code);
        m.set(label, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  }, [chosen]);

  const cashTotal = chosen.reduce((s, o) => s + o.total, 0);

  function toggle(id: number) {
    setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function saveFulfilment(o: Order, body: any) {
    setBusy(o.id);
    try {
      await api(`/admin/orders/${o.id}/fulfilment`, { method: 'PATCH', body: JSON.stringify(body) });
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(null); }
  }

  return (
    <div dir="rtl">
      {/* Print rules live with the page: on paper the app chrome, the nav and
          the controls are noise, and each slip needs its own sheet. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; width: 100%; padding: 0; }
          .no-print { display: none !important; }
          .slip { page-break-after: always; border: none !important; }
          .slip:last-child { page-break-after: auto; }
        }
        .slip { border: 1px dashed rgba(255,255,255,0.25); border-radius: 10px; padding: 16px; margin-bottom: 12px; }
      `}</style>

      {err ? <div className="card no-print" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card no-print" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="chart-title" style={{ marginLeft: 'auto' }}>
          التجهيز والتوصيل ({chosen.length} من {orders.length})
        </div>
        <button className="primary" onClick={() => window.print()} disabled={!chosen.length}>
          طباعة
        </button>
        <button className="secondary" onClick={() => setSel(new Set(orders.map((o) => o.id)))}>تحديد الكل</button>
        <button className="secondary" onClick={() => setSel(new Set())}>إلغاء التحديد</button>
      </div>

      {loading ? <div className="card">…</div> : !orders.length ? (
        <div className="card"><p className="muted">لا طلبات مؤكّدة أو قيد التوصيل الآن.</p></div>
      ) : (
        <>
          {/* Selection + courier fields — screen only. */}
          <div className="card no-print" style={{ marginBottom: 12 }}>
            <table className="data-table">
              <thead>
                <tr><th /><th>الطلب</th><th>الزبون</th><th>المحافظة</th><th>المبلغ</th><th>المندوب</th><th>كلفة التوصيل</th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></td>
                    <td style={{ direction: 'ltr' }}>{o.code}</td>
                    <td>{o.customer_name}<div className="muted" style={{ fontSize: 12, direction: 'ltr' }}>{o.customer_phone}</div></td>
                    <td>{gov(o.governorate)}</td>
                    <td>{iqd(o.total)}</td>
                    <td>
                      <input
                        defaultValue={o.courier || ''}
                        placeholder="اسم المندوب"
                        style={{ width: 130 }}
                        disabled={busy === o.id}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== (o.courier || '')) {
                            void saveFulfilment(o, { courier: e.target.value });
                          }
                        }}
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={o.delivery_cost ?? ''}
                        type="number"
                        placeholder="الفعلية"
                        style={{ width: 100 }}
                        disabled={busy === o.id}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== String(o.delivery_cost ?? '')) {
                            void saveFulfilment(o, { delivery_cost: v === '' ? null : Number(v) });
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="print-area">
            {/* Pick list */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="chart-title">قائمة التجهيز — {chosen.length} طلب</div>
              <table className="data-table" style={{ marginTop: 8 }}>
                <thead><tr><th>الجهاز</th><th>العدد</th><th>الطلبات</th></tr></thead>
                <tbody>
                  {pick.map((p) => (
                    <tr key={p.label}>
                      <td>{p.label}</td>
                      <td style={{ fontWeight: 700, fontSize: 16 }}>{p.qty}</td>
                      <td className="muted" style={{ fontSize: 12, direction: 'ltr' }}>{p.orders.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ marginTop: 8, fontWeight: 700 }}>
                المبلغ المتوقّع تحصيله: {iqd(cashTotal)} د.ع
              </p>
            </div>

            {/* One slip per order */}
            {chosen.map((o) => (
              <div className="slip" key={o.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>iQ Mobile</div>
                    <div className="muted" style={{ fontSize: 12 }}>الدفع عند الاستلام</div>
                  </div>
                  <div style={{ textAlign: 'left', direction: 'ltr', fontWeight: 700, fontSize: 18 }}>{o.code}</div>
                </div>

                <div style={{ marginTop: 12, fontSize: 15 }}>
                  <div><strong>{o.customer_name}</strong></div>
                  <div style={{ direction: 'ltr', textAlign: 'right' }}>{o.customer_phone}</div>
                  <div style={{ marginTop: 4 }}>{gov(o.governorate)} — {o.address}</div>
                  {o.note ? <div className="muted" style={{ marginTop: 4 }}>ملاحظة: {o.note}</div> : null}
                </div>

                <table className="data-table" style={{ marginTop: 10 }}>
                  <tbody>
                    {o.items.map((it, i) => (
                      <tr key={i}>
                        <td>{[it.brand, it.model, it.storage, it.color].filter(Boolean).join(' · ')}</td>
                        <td style={{ width: 40 }}>×{it.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* The one number the courier must not get wrong. */}
                <div style={{
                  marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.2)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                }}>
                  <span style={{ fontSize: 14 }}>
                    البضاعة {iqd(o.subtotal)} + التوصيل {iqd(o.shipping_fee)}
                  </span>
                  <span style={{ fontSize: 22, fontWeight: 700 }}>
                    يُستلم {iqd(o.total)} د.ع
                  </span>
                </div>
                {o.courier ? (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>المندوب: {o.courier}</div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
