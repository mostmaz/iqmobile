// Store dashboard — how the storefront is actually doing.
//
// The whole page is built around one fact about cash on delivery: an order
// that was PLACED is not money. A share of them are refused at the door and
// the shop still pays the courier. So "revenue" never appears as a single
// number here — placed, delivered and cancelled are always shown side by
// side, and the average order value is computed over delivered orders only.
//
// Everything else is a question the operator can act on this morning: what
// needs a phone call (pending), what sells, and what has been sitting on the
// shelf since it was added and has never once been ordered.

import React, { useEffect, useState } from 'react';

import { api } from '../api';

type Stats = {
  today: { orders: number; value: number };
  window_days: number;
  placed: { orders: number; value: number };
  delivered: { orders: number; value: number };
  cancelled: { orders: number; value: number };
  open_orders: number;
  pending_orders: number;
  aov: number;
  margin: {
    revenue: number; cost: number; profit: number; pct: number | null;
    lines_with_cost: number; lines_total: number; covered_pct: number;
  };
  cancel_rate: number;
  by_status: Array<{ status: string; n: number }>;
  series: Array<{ bucket: number; placed: number; delivered: number; revenue: number }>;
  top_products: Array<{ brand: string; model: string; units: number; revenue: number }>;
  dead_stock: Array<{ id: number; brand: string; model: string; storage: string | null; asking_price: number; created_at: number }>;
  inventory: {
    listings: number; products: number; retail_value: number;
    out_of_stock: number; low_stock: number; untracked: number; cost_value: number;
  };
};
type Shop = { id: number; shop_name: string | null; display_name: string; shop_orders_enabled: number };

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');
const WINDOWS = [7, 30, 90];

export function StoreOverviewPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | null>(null);
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Same source and filter StorePage uses: /admin/shops returns a bare
    // array and storefronts are the ones with ordering switched on.
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
    api<Stats>(`/admin/store/${shopId}/stats?days=${days}`)
      .then((r) => { setS(r); setErr(''); })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [shopId, days]);

  const maxPlaced = Math.max(1, ...(s?.series || []).map((p) => p.placed));

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="chart-title" style={{ marginLeft: 'auto' }}>أداء المتجر</div>
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

      {loading || !s ? <div className="card">…</div> : (
        <>
          {/* Needs-attention row first: these are the ones costing money today. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 12 }}>
            <Kpi label="طلبات اليوم" value={s.today.orders} sub={`${iqd(s.today.value)} د.ع`} />
            <Kpi label="بانتظار الاتصال" value={s.pending_orders} accent={s.pending_orders > 0} />
            <Kpi label="قيد التنفيذ" value={s.open_orders} />
            <Kpi label="المخزون" value={s.inventory.products} sub={`${s.inventory.listings} إعلان · ${iqd(s.inventory.retail_value)} د.ع`} />
            <Kpi
              label="نفد / على وشك"
              value={`${s.inventory.out_of_stock} / ${s.inventory.low_stock}`}
              sub={s.inventory.untracked ? `${s.inventory.untracked} بلا تتبّع` : 'كل الأصناف متتبَّعة'}
              bad={s.inventory.out_of_stock > 0}
              accent={s.inventory.out_of_stock === 0 && s.inventory.low_stock > 0}
            />
          </div>

          {/* Placed vs delivered, never merged. */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="chart-title">آخر {s.window_days} يوم</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginTop: 10 }}>
              <Kpi label="طلبات مُسجّلة" value={s.placed.orders} sub={`${iqd(s.placed.value)} د.ع`} />
              <Kpi label="تم التسليم — مبيعات فعلية" value={s.delivered.orders} sub={`${iqd(s.delivered.value)} د.ع`} good />
              <Kpi label="ملغاة" value={s.cancelled.orders} sub={`${iqd(s.cancelled.value)} د.ع`} bad={s.cancelled.orders > 0} />
              <Kpi label="معدل الإلغاء" value={`${s.cancel_rate}%`} bad={s.cancel_rate >= 20} />
              <Kpi label="معدل قيمة الطلب" value={`${iqd(s.aov)} د.ع`} sub="من الطلبات المسلَّمة فقط" />
            </div>
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              الدفع عند الاستلام: الطلب المُسجّل ليس مبيعاً حتى يُسلَّم. الأرقام أعلاه تفصل الاثنين عمداً.
            </p>

            {/* Margin is only as good as its cost coverage, so the coverage
                is shown next to it rather than buried — a profit figure
                drawn from a fifth of the lines is not a profit figure. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginTop: 10 }}>
              <Kpi
                label="الربح"
                value={s.margin.lines_with_cost ? `${iqd(s.margin.profit)} د.ع` : '—'}
                sub={s.margin.lines_with_cost
                  ? `هامش ${s.margin.pct}% · محسوب على ${s.margin.covered_pct}% من المبيعات`
                  : 'أدخل كلفة الشراء في المخزون لحساب الربح'}
                good={!!s.margin.lines_with_cost && s.margin.profit > 0}
                bad={!!s.margin.lines_with_cost && s.margin.profit < 0}
              />
              <Kpi label="كلفة البضاعة المباعة" value={s.margin.lines_with_cost ? `${iqd(s.margin.cost)} د.ع` : '—'} />
              <Kpi
                label="كلفة المخزون الحالي"
                value={s.inventory.cost_value ? `${iqd(s.inventory.cost_value)} د.ع` : '—'}
                sub="رأس المال على الرف"
              />
            </div>
          </div>

          {s.series.length ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="chart-title">الطلبات يومياً</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, marginTop: 12, direction: 'ltr' }}>
                {s.series.map((p) => (
                  <div key={p.bucket} style={{ flex: 1, minWidth: 3 }} title={`مُسجّل ${p.placed} · مُسلّم ${p.delivered}`}>
                    <div style={{
                      height: `${(p.placed / maxPlaced) * 70}px`,
                      background: 'rgba(120,140,180,0.35)', borderRadius: '3px 3px 0 0',
                      position: 'relative',
                    }}>
                      {/* Delivered drawn INSIDE placed — the gap is the loss. */}
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        height: `${p.placed ? (p.delivered / p.placed) * 100 : 0}%`,
                        background: '#34C77B', borderRadius: '3px 3px 0 0',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                الأخضر = تم التسليم، الرمادي = مُسجّل ولم يُسلَّم بعد أو أُلغي
              </div>
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 12 }}>
            <div className="card">
              <div className="chart-title">الأكثر مبيعاً</div>
              {s.top_products.length ? (
                <table className="data-table" style={{ marginTop: 8 }}>
                  <thead><tr><th>الجهاز</th><th>القطع</th><th>مبيعات مسلَّمة</th></tr></thead>
                  <tbody>
                    {s.top_products.map((p) => (
                      <tr key={`${p.brand}|${p.model}`}>
                        <td>{p.brand} {p.model}</td>
                        <td>{p.units}</td>
                        <td>{iqd(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="muted">لا مبيعات في هذه الفترة.</p>}
            </div>

            <div className="card">
              <div className="chart-title">بضاعة راكدة</div>
              <p className="muted" style={{ fontSize: 12 }}>معروضة ولم تُطلب ولا مرة — الأقدم أولاً.</p>
              {s.dead_stock.length ? (
                <table className="data-table" style={{ marginTop: 8 }}>
                  <thead><tr><th>الجهاز</th><th>السعر</th><th>معروض منذ</th></tr></thead>
                  <tbody>
                    {s.dead_stock.map((d) => (
                      <tr key={d.id}>
                        <td>{d.brand} {d.model}{d.storage ? ` · ${d.storage}` : ''}</td>
                        <td>{iqd(d.asking_price)}</td>
                        <td>{Math.max(0, Math.round((Date.now() - d.created_at) / 86400000))} يوم</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="muted">كل جهاز في المتجر طُلب مرة على الأقل.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, good, bad, accent }: {
  label: string; value: number | string; sub?: string;
  good?: boolean; bad?: boolean; accent?: boolean;
}) {
  const color = bad ? '#E05C4B' : good ? '#34C77B' : accent ? '#E0A33E' : undefined;
  return (
    <div className="card" style={{ margin: 0, padding: 12 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color }}>
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </div>
      {sub ? <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
