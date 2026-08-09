// Store customers, keyed on phone number.
//
// Checkout collects a name and a number and most buyers never make an
// account, so the phone IS the identity — grouping on user_id would show
// almost nobody.
//
// The column that earns this page its place is "ملغاة". Under cash on
// delivery the shop's real loss is the customer who orders and then refuses
// at the door: the courier is paid either way and the device comes back.
// That pattern is invisible in an order list sorted by date, so it's sorted
// and badged here, and the operator can ask for prepayment before
// dispatching to a repeat refuser.

import React, { useEffect, useState } from 'react';

import { api } from '../api';

type Customer = {
  phone: string; name: string; orders: number; delivered: number;
  cancelled: number; open: number; delivered_value: number;
  last_order_at: number; first_order_at: number; governorate: string;
  repeat: boolean; risk: 'ok' | 'watch' | 'high';
};
type HistoryOrder = {
  id: number; code: string; status: string; total: number;
  governorate: string; address: string; created_at: number; cancel_reason: string | null;
  items: Array<{ brand: string; model: string; storage: string | null; qty: number; line_total: number }>;
};
type Shop = { id: number; shop_name: string | null; display_name: string; shop_orders_enabled: number };

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB');
const STATUS_AR: Record<string, string> = {
  pending: 'جديد', confirmed: 'مؤكّد', shipped: 'قيد التوصيل',
  delivered: 'تم التسليم', cancelled: 'ملغي',
};
const RISK: Record<Customer['risk'], { label: string; color: string } | null> = {
  ok: null,
  watch: { label: 'انتباه', color: '#E0A33E' },
  high: { label: 'رفض متكرر', color: '#E05C4B' },
};
const SORTS: Array<{ key: string; label: string }> = [
  { key: 'recent', label: 'الأحدث' },
  { key: 'spend', label: 'الأكثر شراءً' },
  { key: 'orders', label: 'الأكثر طلباً' },
  { key: 'risk', label: 'الأكثر إلغاءً' },
];

export function StoreCustomersPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | null>(null);
  const [rows, setRows] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryOrder[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Shop[]>('/admin/shops')
      .then((all) => {
        const list = all.filter((x) => x.shop_orders_enabled);
        setShops(list);
        setShopId((cur) => cur ?? list[0]?.id ?? null);
        if (!list.length) setLoading(false);
      })
      .catch((e) => { setErr(String(e?.message || e)); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!shopId) return;
    setLoading(true);
    const h = setTimeout(() => {
      const p = new URLSearchParams({ sort });
      if (q.trim()) p.set('q', q.trim());
      api<{ total: number; customers: Customer[] }>(`/admin/store/${shopId}/customers?${p}`)
        .then((r) => { setRows(r.customers); setTotal(r.total); setErr(''); })
        .catch((e) => setErr(String(e?.message || e)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(h);
  }, [shopId, q, sort]);

  function toggle(phone: string) {
    if (open === phone) { setOpen(null); setHistory([]); return; }
    setOpen(phone);
    setHistory([]);
    api<{ orders: HistoryOrder[] }>(`/admin/store/${shopId}/customers/${encodeURIComponent(phone)}`)
      .then((r) => setHistory(r.orders))
      .catch((e) => setErr(String(e?.message || e)));
  }

  const risky = rows.filter((r) => r.risk === 'high').length;

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chart-title" style={{ marginLeft: 'auto' }}>
            الزبائن ({total.toLocaleString('en-US')})
          </div>
          {shops.length > 1 ? (
            <select value={shopId ?? ''} onChange={(e) => setShopId(Number(e.target.value))}>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.shop_name || s.display_name}</option>)}
            </select>
          ) : null}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم أو رقم الهاتف…"
            style={{ minWidth: 240 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {SORTS.map((s) => (
            <button key={s.key} className={sort === s.key ? 'primary' : 'secondary'} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        {risky ? (
          <p style={{ color: '#E05C4B', fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
            {risky} زبون رفض الاستلام ٣ مرات أو أكثر. اطلب الدفع المسبق قبل إرسال طلب جديد لهم.
          </p>
        ) : null}
      </div>

      {loading ? <div className="card">…</div> : !rows.length ? (
        <div className="card"><p className="muted">لا زبائن بعد.</p></div>
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>الزبون</th><th>الطلبات</th><th>مُسلّمة</th><th>ملغاة</th>
                <th>قيد التنفيذ</th><th>أنفق</th><th>آخر طلب</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const badge = RISK[c.risk];
                return (
                  <React.Fragment key={c.phone}>
                    <tr>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong>{c.name || '—'}</strong>
                          {c.repeat ? (
                            <span style={{
                              background: 'rgba(52,199,123,0.18)', color: '#34C77B',
                              borderRadius: 999, padding: '1px 7px', fontSize: 11,
                            }}>زبون متكرر</span>
                          ) : null}
                          {badge ? (
                            <span style={{
                              background: `${badge.color}28`, color: badge.color,
                              borderRadius: 999, padding: '1px 7px', fontSize: 11,
                            }}>{badge.label}</span>
                          ) : null}
                        </div>
                        <a href={`tel:${c.phone}`} className="muted" style={{ fontSize: 12, direction: 'ltr', display: 'inline-block' }}>
                          {c.phone}
                        </a>
                      </td>
                      <td>{c.orders}</td>
                      <td style={{ color: c.delivered ? '#34C77B' : undefined }}>{c.delivered}</td>
                      <td style={{ color: c.cancelled ? '#E05C4B' : undefined }}>{c.cancelled}</td>
                      <td>{c.open || ''}</td>
                      <td>{iqd(c.delivered_value)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{day(c.last_order_at)}</td>
                      <td>
                        <button className="secondary" onClick={() => toggle(c.phone)}>
                          {open === c.phone ? 'إخفاء' : 'الطلبات'}
                        </button>
                      </td>
                    </tr>
                    {open === c.phone ? (
                      <tr>
                        <td colSpan={8} style={{ background: 'rgba(255,255,255,0.02)' }}>
                          {!history.length ? <span className="muted">…</span> : (
                            <div style={{ display: 'grid', gap: 8 }}>
                              {history.map((o) => (
                                <div key={o.id} style={{ fontSize: 13 }}>
                                  <strong style={{ direction: 'ltr', display: 'inline-block' }}>{o.code}</strong>
                                  {' · '}{STATUS_AR[o.status] || o.status}
                                  {' · '}{iqd(o.total)} د.ع
                                  {' · '}<span className="muted">{day(o.created_at)}</span>
                                  {o.cancel_reason ? <span style={{ color: '#E05C4B' }}> · {o.cancel_reason}</span> : null}
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    {o.items.map((i) => `${i.brand} ${i.model}${i.storage ? ` ${i.storage}` : ''} ×${i.qty}`).join('، ')}
                                  </div>
                                  <div className="muted" style={{ fontSize: 12 }}>{o.address}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
