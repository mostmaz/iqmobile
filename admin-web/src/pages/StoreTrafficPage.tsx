// Store traffic — who looked, who called, and what they looked at.
//
// Deliberately separate from "أداء المتجر". That page answers "how is the
// shop SELLING" — orders, margin, stock. This one answers "how is the shop
// being USED". They share a shop but not a question, and the operator reads
// them at different moments: one when chasing revenue, one when deciding
// what to put on the home card.
//
// Everything here is new data. The storefront never recorded a view or a
// call before — a shopper who stayed inside the shop produced no signal at
// all — so the page says when tracking began rather than drawing an empty
// chart and letting it read as "no interest".

import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Traffic = {
  window_days: number;
  views: number;
  calls: number;
  orders: number;
  home_calls: number;
  prev: { views: number; calls: number };
  call_rate: number | null;
  order_rate: number | null;
  daily: { bucket: number; views: number; calls: number }[];
  by_product: { brand: string; model: string; views: number; calls: number }[];
  tracking_since: number | null;
};
type Shop = { id: number; shop_name: string | null; display_name: string; shop_orders_enabled: number };

const WINDOWS = [7, 30, 90];
const n = (v: number) => Number(v || 0).toLocaleString('en-US');

/** "+18%" / "−4%" against the previous window of the same length. */
function delta(cur: number, prev: number): { text: string; good: boolean } | null {
  if (!prev) return null;
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return null;
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)}%`, good: d > 0 };
}

export function StoreTrafficPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | null>(null);
  const [days, setDays] = useState(30);
  const [t, setT] = useState<Traffic | null>(null);
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
    api<Traffic>(`/admin/store/${shopId}/traffic?days=${days}`)
      .then((r) => { setT(r); setErr(''); })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [shopId, days]);

  const maxDaily = Math.max(1, ...(t?.daily || []).map((d) => d.views));
  const viewDelta = t ? delta(t.views, t.prev.views) : null;
  const callDelta = t ? delta(t.calls, t.prev.calls) : null;

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="chart-title" style={{ marginLeft: 'auto' }}>حركة المتجر</div>
        {shops.length > 1 ? (
          <select value={shopId ?? ''} onChange={(e) => setShopId(Number(e.target.value))}>
            {shops.map((sh) => <option key={sh.id} value={sh.id}>{sh.shop_name || sh.display_name}</option>)}
          </select>
        ) : null}
        {WINDOWS.map((d) => (
          <button key={d} className={days === d ? 'primary' : 'secondary'} onClick={() => setDays(d)}>
            {d} يوم
          </button>
        ))}
      </div>

      {loading || !t ? <div className="card">…</div> : (
        <>
          {/* Say when the numbers start. Without this an operator reading a
              small number on day one concludes the shop is dead, when in
              fact the counter only just started. */}
          {t.tracking_since ? (
            new Date(t.tracking_since).getTime() > Date.now() - days * 86400000 ? (
              <div className="card" style={{ marginBottom: 12, color: '#E0A33E', fontSize: 12.5 }}>
                تتبّع الحركة بدأ في {new Date(t.tracking_since).toLocaleDateString('ar-IQ')} — الأرقام
                أدناه تغطي منذ ذلك التاريخ فقط، وليست كامل الـ{days} يوماً.
              </div>
            ) : null
          ) : (
            <div className="card" style={{ marginBottom: 12, color: '#E0A33E', fontSize: 12.5 }}>
              لا توجد بيانات حركة بعد. التتبّع يبدأ مع أول نسخة من التطبيق تحتوي عليه —
              قبلها لم يكن المتجر يسجّل أي مشاهدة أو اتصال.
            </div>
          )}

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="chart-title">آخر {t.window_days} يوم</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginTop: 10 }}>
              <Kpi label="مشاهدات المنتجات" value={n(t.views)} delta={viewDelta} />
              <Kpi label="اتصالات" value={n(t.calls)} delta={callDelta} accent={t.calls > 0} />
              <Kpi
                label="نسبة الاتصال"
                value={t.call_rate === null ? '—' : `${t.call_rate}%`}
                sub="من كل مشاهدة"
              />
              <Kpi label="طلبات" value={n(t.orders)} />
              <Kpi
                label="نسبة الطلب"
                value={t.order_rate === null ? '—' : `${t.order_rate}%`}
                sub="من كل مشاهدة"
              />
              <Kpi
                label="اتصال من واجهة المتجر"
                value={n(t.home_calls)}
                sub="بدون منتج محدّد"
              />
            </div>
          </div>

          {t.daily.length ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="chart-title">يومياً</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 130, marginTop: 12 }}>
                {t.daily.map((d) => (
                  <div
                    key={d.bucket}
                    title={`مشاهدات ${d.views} · اتصالات ${d.calls}`}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1 }}
                  >
                    {/* Calls stacked on views, not beside them — a call is a
                        subset of the people who looked, not a rival series. */}
                    <div style={{ height: `${(d.calls / maxDaily) * 100}%`, background: '#E0764F', borderRadius: '2px 2px 0 0', minHeight: d.calls ? 2 : 0 }} />
                    <div style={{ height: `${((d.views - d.calls) / maxDaily) * 100}%`, background: '#3F5F7D', minHeight: d.views ? 2 : 0 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12 }} className="muted">
                <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#3F5F7D', marginLeft: 5 }} />مشاهدات</span>
                <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#E0764F', marginLeft: 5 }} />اتصالات</span>
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="chart-title">حسب المنتج</div>
            {t.by_product.length ? (
              <div className="tbl" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr><th>المنتج</th><th>مشاهدات</th><th>اتصالات</th><th>نسبة الاتصال</th></tr>
                  </thead>
                  <tbody>
                    {t.by_product.map((p) => (
                      <tr key={`${p.brand}-${p.model}`}>
                        <td>{p.brand} {p.model}</td>
                        <td>{n(p.views)}</td>
                        <td style={{ color: p.calls > 0 ? '#E0764F' : undefined }}>{n(p.calls)}</td>
                        <td>{p.views ? `${Math.round((p.calls / p.views) * 1000) / 10}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5 }}>لا توجد مشاهدات في هذه الفترة.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, accent, delta: d }: {
  label: string; value: string; sub?: string; accent?: boolean;
  delta?: { text: string; good: boolean } | null;
}) {
  return (
    <div style={{
      background: 'var(--surface, #161A1F)', border: '1px solid var(--rule, #262B32)',
      borderRadius: 8, padding: '12px 14px',
    }}>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 24, fontWeight: 600, color: accent ? '#E0764F' : undefined }}>{value}</div>
        {d ? (
          <span style={{ fontSize: 12, color: d.good ? '#5FBE92' : '#E8635A' }}>{d.text}</span>
        ) : null}
      </div>
      {sub ? <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}
