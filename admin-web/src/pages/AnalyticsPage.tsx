import React, { useEffect, useState } from 'react';
import { api } from '../api';

// Mirrors server/src/governorates.js — a fixed list, so inline is fine.
const GOVERNORATES = [
  'Baghdad', 'Basra', 'Erbil', 'Sulaymaniyah', 'Duhok', 'Kirkuk',
  'Najaf', 'Karbala', 'Mosul', 'Anbar', 'Babil', 'Diyala',
  'Diwaniyah', 'Dhi Qar', 'Maysan', 'Muthanna', 'Salahuddin', 'Wasit',
];

const PERIODS: Array<{ k: string; label: string }> = [
  { k: 'today', label: 'اليوم' },
  { k: '7d', label: 'آخر ٧ أيام' },
  { k: '30d', label: 'آخر ٣٠ يوم' },
];

interface ContactRow {
  id: number; brand: string; model: string; governorate: string;
  calls: number; whatsapps: number; chats: number; total: number;
}
interface NoContactRow {
  id: number; brand: string; model: string; governorate: string;
  seller_name: string; seller_phone: string; created_at: number;
}
interface Analytics {
  filters: { period: string; governorate: string | null; brand: string | null };
  kpis: {
    total_listings: number; listings_with_contact: number; listings_with_contact_pct: number;
    listings_without_contact: number; avg_contact_attempts: number; sold_count: number;
  };
  contact_per_listing: ContactRow[];
  listings_without_contact: NoContactRow[];
  listings_without_contact_total: number;
  demand: {
    top_searches: Array<{ query: string; n: number }>;
    zero_result_searches: Array<{ query: string; n: number }>;
    most_viewed: Array<{ id: number; brand: string; model: string; governorate: string; views: number }>;
  };
  sellers_without_listings: Array<{ id: number; display_name: string; phone: string; created_at: number }>;
  sellers_without_listings_total: number;
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState('7d');
  const [gov, setGov] = useState('');
  const [brand, setBrand] = useState('');
  const [brands, setBrands] = useState<string[]>([]);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Array<{ name: string }>>('/admin/brands')
      .then((r) => setBrands(r.map((b) => b.name).sort()))
      .catch(() => setBrands([]));
  }, []);

  useEffect(() => {
    setLoading(true); setErr('');
    const qs = new URLSearchParams({ period });
    if (gov) qs.set('governorate', gov);
    if (brand) qs.set('brand', brand);
    api<Analytics>(`/admin/analytics?${qs.toString()}`)
      .then(setData)
      .catch((e) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, [period, gov, brand]);

  const k = data?.kpis;

  return (
    <div dir="rtl" style={{ textAlign: 'right' }}>
      <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>تحليل التواصل والطلب</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {PERIODS.map((p) => (
            <button key={p.k} className={period === p.k ? '' : 'secondary'} onClick={() => setPeriod(p.k)}>{p.label}</button>
          ))}
          <select value={gov} onChange={(e) => setGov(e.target.value)}>
            <option value="">كل المحافظات</option>
            {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">كل الماركات</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {/* Honesty note: call/WhatsApp taps open an external app, so they can
          only be counted once the mobile build that reports them ships. */}
      <div className="card" style={{ borderInlineStart: '3px solid #f59e0b', fontSize: 13, color: '#d1d5db' }}>
        ملاحظة: ضغطات «اتصال» و«واتساب» تُفتح في تطبيق خارجي، لذلك تبدأ بالظهور بعد تحديث التطبيق القادم.
        أما محادثات الشات فمحسوبة بالكامل (بأثر رجعي).
      </div>

      {err ? <div className="card" style={{ color: '#dc2626' }}>خطأ في التحميل: {err}</div> : null}
      {loading && !data ? <div className="card empty">جارٍ التحميل…</div> : null}

      {k ? (
        <>
          <div className="kpi-row">
            <Kpi label="إعلانات وصلها تواصل" value={`${k.listings_with_contact}`} sub={`${k.listings_with_contact_pct}% من ${k.total_listings} إعلان`} color="#10b981" />
            <Kpi label="إعلانات بدون أي تواصل" value={`${k.listings_without_contact}`} sub="بائعون قد ينسحبون" color="#ef4444" />
            <Kpi label="متوسط محاولات التواصل" value={`${k.avg_contact_attempts}`} sub="لكل إعلان" />
            <Kpi label="إعلانات مباعة" value={`${k.sold_count}`} sub="تحوّلت إلى مباع" color="#3b82f6" />
          </div>

          {/* Contact per listing */}
          <div className="card">
            <div className="chart-title">التواصل مع الإعلانات (الأكثر تفاعلاً)</div>
            {data!.contact_per_listing.length === 0 ? (
              <div className="empty muted">لا يوجد تواصل مسجّل في هذه الفترة.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead><tr>
                    <th>#</th><th>الإعلان</th><th>المحافظة</th>
                    <th>اتصال</th><th>واتساب</th><th>محادثة</th><th>الإجمالي</th>
                  </tr></thead>
                  <tbody>
                    {data!.contact_per_listing.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>{r.brand} {r.model}</td>
                        <td>{r.governorate}</td>
                        <td>{r.calls}</td><td>{r.whatsapps}</td><td>{r.chats}</td>
                        <td style={{ fontWeight: 700 }}>{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Demand */}
          <div className="chart-row">
            <div className="card chart-card">
              <div className="chart-title">أكثر الكلمات بحثاً</div>
              <RankList rows={data!.demand.top_searches.map((s) => ({ label: s.query, n: s.n }))} empty="لا عمليات بحث في هذه الفترة." />
            </div>
            <div className="card chart-card">
              <div className="chart-title">بحث بدون نتائج · طلب بلا عرض 🎯</div>
              <RankList rows={data!.demand.zero_result_searches.map((s) => ({ label: s.query, n: s.n }))} empty="لا يوجد — كل عمليات البحث لها نتائج." accent="#f59e0b" />
            </div>
            <div className="card chart-card">
              <div className="chart-title">الأكثر مشاهدة</div>
              <RankList rows={data!.demand.most_viewed.map((v) => ({ label: `${v.brand} ${v.model}`, n: v.views }))} empty="لا مشاهدات في هذه الفترة." />
            </div>
          </div>

          {/* Action lists */}
          <div className="card">
            <div className="chart-title">
              إعلانات بدون تواصل — نشطة ولم تصلها أي ضغطة
              {data!.listings_without_contact_total > data!.listings_without_contact.length
                ? ` (أول ${data!.listings_without_contact.length} من ${data!.listings_without_contact_total})` : ''}
            </div>
            {data!.listings_without_contact.length === 0 ? (
              <div className="empty muted">كل الإعلانات النشطة وصلها تواصل 👍</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead><tr><th>#</th><th>الإعلان</th><th>المحافظة</th><th>البائع</th><th>منذ</th></tr></thead>
                  <tbody>
                    {data!.listings_without_contact.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>{r.brand} {r.model}</td>
                        <td>{r.governorate}</td>
                        <td>{r.seller_name}<br /><small style={{ color: '#9ca3af' }} dir="ltr">{r.seller_phone}</small></td>
                        <td><small>{daysAgo(r.created_at)}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="chart-title">
              بائعون سجّلوا ولم ينشروا أي إعلان — للتحفيز
              {data!.sellers_without_listings_total > data!.sellers_without_listings.length
                ? ` (أول ${data!.sellers_without_listings.length} من ${data!.sellers_without_listings_total})` : ''}
            </div>
            {data!.sellers_without_listings.length === 0 ? (
              <div className="empty muted">لا يوجد.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead><tr><th>#</th><th>الاسم</th><th>الهاتف</th><th>مسجّل منذ</th></tr></thead>
                  <tbody>
                    {data!.sellers_without_listings.map((u) => (
                      <tr key={u.id}>
                        <td>{u.id}</td>
                        <td>{u.display_name}</td>
                        <td dir="ltr" style={{ textAlign: 'right' }}>{u.phone}</td>
                        <td><small>{daysAgo(u.created_at)}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
      {sub ? <div className="kpi-sub muted">{sub}</div> : null}
    </div>
  );
}

function RankList({ rows, empty, accent }: { rows: Array<{ label: string; n: number }>; empty: string; accent?: string }) {
  if (rows.length === 0) return <div className="empty muted">{empty}</div>;
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="activity-list">
      {rows.map((r, i) => (
        <li key={i} style={{ display: 'block' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ whiteSpace: 'nowrap' }}>{r.label}</span>
            <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.n}</span>
          </div>
          {/* thin proportion bar */}
          <div style={{ height: 4, borderRadius: 2, marginTop: 4, background: '#1f2e47' }}>
            <div style={{ height: '100%', borderRadius: 2, width: `${(r.n / max) * 100}%`, background: accent || '#3b82f6' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function daysAgo(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'اليوم';
  if (d === 1) return 'يوم';
  if (d === 2) return 'يومين';
  if (d <= 10) return `${d} أيام`;
  return `${d} يوم`;
}
