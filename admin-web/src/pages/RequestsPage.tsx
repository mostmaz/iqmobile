// طلبات الأجهزة — the demand side of the console.
//
// Every other page in here measures what the site HAS. This one measures
// what people came asking for, and the only reading that matters is the pair
// of numbers on each row:
//
//   أجهزة مطابقة — listings live right now that satisfy the request
//   عروض          — sellers who actually replied to it
//
// Both zero is stock we do not carry: an import decision. Devices but no
// offers is a broadcast that failed: the phones are here and their sellers
// said nothing, which is a nudge, not a purchase order. Collapsed into one
// "unanswered" column those two look identical and lead to opposite work, so
// the table never merges them and the KPI row counts them apart.
//
// Read-only on purpose — a request belongs to the buyer who posted it, and
// the close/fulfil paths carry his rate limits and notifications.

import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api, listingUrl, listingLinkStyle } from '../api';

// Mirrors server/src/governorates.js, same as AnalyticsPage — a fixed list.
const GOVERNORATES = [
  'Baghdad', 'Basra', 'Erbil', 'Sulaymaniyah', 'Duhok', 'Kirkuk',
  'Najaf', 'Karbala', 'Mosul', 'Anbar', 'Babil', 'Diyala',
  'Diwaniyah', 'Dhi Qar', 'Maysan', 'Muthanna', 'Salahuddin', 'Wasit',
];

type Row = {
  id: number;
  brand: string; model: string; condition: string | null;
  max_price: number; governorate: string; note: string | null;
  status: string; is_live: boolean;
  created_at: number; expires_at: number; closed_at: number | null;
  buyer: { id: number; name: string | null; phone: string | null; seller_type: string | null; governorate: string | null };
  matched_devices: number; matched_in_budget: number; matched_call_for_price: number;
  cheapest_match: number | null;
  offers: number; offers_withdrawn: number; offer_count_stored: number;
  best_offer: number | null; first_offer_at: number | null; last_offer_at: number | null;
  first_response_ms: number | null;
};

type Summary = {
  window_days: number;
  totals: {
    all_time: number; open: number; open_awaiting_expiry: number; fulfilled: number;
    closed: number; expired: number; new_24h: number; new_7d: number; new_window: number;
    expiring_48h: number; buyers: number;
  };
  offers: {
    sent: number; withdrawn: number; sent_7d: number; sent_window: number; with_listing: number;
    sellers: number; answered_requests: number; answer_rate: number | null;
    per_answered_request: number | null; unanswered_open: number;
    median_first_response_ms: number | null;
  };
  supply: {
    open_scanned: number; with_match: number; without_match: number; with_match_pct: number | null;
    matched_devices: number; matched_but_unanswered: number; scan_capped: boolean; scanned: number;
  };
  top_models: Array<{ brand: string; model: string; requests: number; offers: number; matched: number; unanswered: number; median_budget: number | null }>;
  by_governorate: Array<{ name: string; requests: number; offers: number; unanswered: number }>;
  by_brand: Array<{ name: string; count: number }>;
};

type Detail = {
  request: Row;
  offers: Array<{
    id: number; price: number; note: string | null; status: string; created_at: number;
    waited_ms: number; above_budget: boolean; listing_id: number | null;
    seller: { id: number; name: string; is_shop: boolean; governorate: string; phone: string | null; rating_avg: number | null; rating_count: number | null; verified: boolean };
  }>;
  matched_listings: Array<{
    id: number; brand: string; model: string; storage: string | null; color: string | null;
    condition: string | null; asking_price: number; status: string; governorate: string;
    created_at: number; above_budget: boolean; call_for_price: boolean; image_path: string | null;
    seller: { id: number; name: string; is_shop: boolean; phone: string | null } | null;
    seller_answered: boolean;
  }>;
  stats: { matched_sellers: number; matched_sellers_answered: number; offer_count_drift: number };
};

const n = (v: number | null | undefined) => Number(v || 0).toLocaleString('en-US');
const iqd = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toLocaleString('en-US')} د.ع`);

/** Latin digits, Arabic unit — the console's own house style. */
function dur(ms: number | null): string {
  if (ms == null) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ساعة`;
  return `${Math.round(h / 24)} يوم`;
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 3600) return `قبل ${Math.max(1, Math.floor(s / 60))} دقيقة`;
  if (s < 86400) return `قبل ${Math.floor(s / 3600)} ساعة`;
  return `قبل ${Math.floor(s / 86400)} يوم`;
}

function until(ts: number): string {
  const s = Math.floor((ts - Date.now()) / 1000);
  if (s <= 0) return 'انتهى';
  if (s < 86400) return `${Math.max(1, Math.floor(s / 3600))} ساعة`;
  return `${Math.floor(s / 86400)} يوم`;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'مفتوح', fulfilled: 'تم', closed: 'مغلق', expired: 'منتهي',
};

const STATUS_TABS: Array<{ k: string; label: string }> = [
  { k: 'live', label: 'الحية' },
  { k: 'open', label: 'المفتوحة' },
  { k: 'fulfilled', label: 'المنجزة' },
  { k: 'closed', label: 'المغلقة' },
  { k: 'expired', label: 'المنتهية' },
  { k: 'all', label: 'الكل' },
];

const WINDOWS = [7, 30, 90];
const PAGE = 50;

export function RequestsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [scanCapped, setScanCapped] = useState(false);
  const [status, setStatus] = useState('live');
  const [gov, setGov] = useState('');
  const [brand, setBrand] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [unanswered, setUnanswered] = useState(false);
  const [unmatched, setUnmatched] = useState(false);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Summary>(`/admin/requests/summary?days=${days}`)
      .then(setSummary)
      .catch((e) => setErr(String(e?.message || e)));
  }, [days]);

  const load = useCallback(() => {
    const p = new URLSearchParams({ status, limit: String(PAGE), offset: String(offset) });
    if (gov) p.set('governorate', gov);
    if (brand) p.set('brand', brand);
    if (query) p.set('q', query);
    if (unanswered) p.set('unanswered', '1');
    if (unmatched) p.set('unmatched', '1');
    setLoading(true);
    api<{ requests: Row[]; total: number; scan_capped: boolean }>(`/admin/requests?${p}`)
      .then((r) => { setRows(r.requests); setTotal(r.total); setScanCapped(r.scan_capped); setErr(''); })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [status, gov, brand, query, unanswered, unmatched, offset]);

  useEffect(() => { load(); }, [load]);
  // Any change of filter puts you back on page one — page 3 of the previous
  // filter is a different set of rows and lands on nothing.
  useEffect(() => { setOffset(0); }, [status, gov, brand, query, unanswered, unmatched]);

  useEffect(() => {
    if (openId == null) { setDetail(null); return; }
    setDetail(null);
    api<Detail>(`/admin/requests/${openId}`).then(setDetail).catch(() => setDetail(null));
  }, [openId]);

  const s = summary;

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon' }}>{err}</div> : null}

      <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="chart-title" style={{ margin: 0, marginLeft: 'auto' }}>طلبات الأجهزة</div>
        {WINDOWS.map((d) => (
          <button key={d} className={days === d ? '' : 'secondary'} onClick={() => setDays(d)}>{d} يوم</button>
        ))}
      </div>

      {!s ? <div className="card">…</div> : (
        <>
          <div className="kpi-row">
            <Kpi
              label="طلبات مفتوحة"
              value={n(s.totals.open)}
              sub={`${n(s.totals.new_7d)} جديد خلال 7 أيام · ${n(s.totals.expiring_48h)} ينتهي خلال 48 ساعة`}
            />
            <Kpi
              label="بدون أي عرض"
              value={n(s.offers.unanswered_open)}
              warn={s.offers.unanswered_open > 0}
              sub={`${n(s.supply.matched_but_unanswered)} منها الجهاز موجود على الموقع`}
            />
            <Kpi
              label="طلبات يمكن تلبيتها اليوم"
              value={n(s.supply.with_match)}
              sub={s.supply.with_match_pct == null
                ? 'لا طلبات مفتوحة'
                : `${s.supply.with_match_pct}% من المفتوحة · ${n(s.supply.matched_devices)} إعلان مطابق`}
            />
            <Kpi
              label="طلب بلا جهاز مطابق"
              value={n(s.supply.without_match)}
              sub="لا نملك هذا الجهاز أصلاً — قرار استيراد، لا تنبيه بائع"
            />
          </div>

          <div className="kpi-row">
            <Kpi label="عروض مرسلة" value={n(s.offers.sent)} sub={`${n(s.offers.sellers)} بائع · ${n(s.offers.sent_7d)} خلال 7 أيام`} />
            <Kpi
              label="نسبة الطلبات المُجابة"
              value={s.offers.answer_rate == null ? '—' : `${s.offers.answer_rate}%`}
              sub={`${n(s.offers.answered_requests)} من ${n(s.totals.all_time)} طلب منذ البداية`}
            />
            <Kpi
              label="متوسط زمن أول رد"
              value={dur(s.offers.median_first_response_ms)}
              sub="الوسيط، لا المعدّل — رد متأخر واحد لا يزيّن الرقم"
            />
            <Kpi
              label="عروض لكل طلب مُجاب"
              value={s.offers.per_answered_request == null ? '—' : String(s.offers.per_answered_request)}
              sub={`${n(s.offers.with_listing)} عرض مربوط بإعلان حقيقي`}
            />
          </div>

          {s.totals.open_awaiting_expiry > 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              {n(s.totals.open_awaiting_expiry)} طلب ما زال مخزّناً كـ«مفتوح» لكن انتهت مدته — الكنس كسول،
              واللوحة لا تعرضها. تظهر تحت «المفتوحة» لا تحت «الحية».
            </p>
          ) : null}
          {s.supply.scan_capped ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              أرقام العرض والمطابقة محسوبة على أحدث {n(s.supply.scanned)} طلب. المجاميع أعلاه دقيقة على كامل الجدول.
            </p>
          ) : null}

          <div className="chart-row">
            <div className="card chart-card">
              <div className="chart-title">أكثر الأجهزة طلباً · آخر {s.window_days} يوم</div>
              {s.top_models.length === 0 ? <Empty /> : (
                <table>
                  <thead>
                    <tr>
                      <th>الجهاز</th><th>طلبات</th><th>أجهزة مطابقة</th><th>عروض</th>
                      <th>بلا رد</th><th>وسيط الميزانية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.top_models.map((m) => (
                      <tr key={`${m.brand}-${m.model}`}>
                        <td>{m.brand} {m.model}</td>
                        <td>{n(m.requests)}</td>
                        {/* Zero here is the import signal; zero in the next
                            column with stock beside it is a seller problem. */}
                        <td style={{ color: m.matched === 0 ? 'var(--warn)' : undefined }}>{n(m.matched)}</td>
                        <td>{n(m.offers)}</td>
                        <td style={{ color: m.unanswered ? 'var(--text-dim)' : undefined }}>{n(m.unanswered)}</td>
                        <td>{iqd(m.median_budget)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card chart-card">
              <div className="chart-title">الطلب حسب المحافظة · آخر {s.window_days} يوم</div>
              {s.by_governorate.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={s.by_governorate} margin={{ top: 8, right: 8, bottom: 28, left: 4 }}>
                    <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#bbb' }} angle={-25} textAnchor="end" interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#bbb' }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff' }} />
                    <Bar dataKey="requests" name="طلبات" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="unanswered" name="بلا رد" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div className="seg">
            {STATUS_TABS.map((t) => (
              <button key={t.k} className={status === t.k ? 'on' : ''} onClick={() => setStatus(t.k)}>{t.label}</button>
            ))}
          </div>
          <select value={gov} onChange={(e) => setGov(e.target.value)}>
            <option value="">كل المحافظات</option>
            {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">كل الماركات</option>
            {(summary?.by_brand || []).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
          <form
            onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جهاز، اسم مشتري، رقم هاتف…"
              style={{ minWidth: 200 }}
            />
            <button className="secondary" type="submit">بحث</button>
          </form>
          <button className={unanswered ? '' : 'secondary'} onClick={() => setUnanswered((v) => !v)}>بدون عروض</button>
          <button className={unmatched ? '' : 'secondary'} onClick={() => setUnmatched((v) => !v)}>بدون جهاز مطابق</button>
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12.5 }}>
            {loading ? '…' : `${n(total)} طلب`}
          </span>
        </div>

        {scanCapped ? (
          <p className="muted" style={{ fontSize: 12.5 }}>
            «بدون جهاز مطابق» يفحص أحدث 500 طلب ضمن هذا الفلتر — ضيّق بالحالة أو المحافظة للوصول لما قبلها.
          </p>
        ) : null}

        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>الجهاز</th><th>المشتري</th><th>السقف</th><th>المحافظة</th>
              <th>أجهزة مطابقة</th><th>عروض</th><th>أفضل عرض</th><th>الحالة</th><th>العمر</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr><td colSpan={10}><div className="empty muted">لا توجد طلبات بهذا الفلتر.</div></td></tr>
            ) : null}
            {rows.map((row) => (
              <React.Fragment key={row.id}>
                <tr
                  onClick={() => setOpenId((cur) => (cur === row.id ? null : row.id))}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="faint">{row.id}</td>
                  <td>
                    <strong>{row.brand} {row.model}</strong>
                    {row.condition ? <span className="muted"> · {row.condition}</span> : null}
                  </td>
                  <td>
                    {row.buyer.name || '—'}
                    {row.buyer.phone ? <div className="faint" style={{ fontSize: 12 }}>{row.buyer.phone}</div> : null}
                  </td>
                  <td>{iqd(row.max_price)}</td>
                  <td className="muted">{row.governorate}</td>
                  <td><Matched row={row} /></td>
                  <td>
                    {row.offers ? n(row.offers) : <span className="faint">0</span>}
                    {row.offers_withdrawn ? <span className="faint" style={{ fontSize: 11.5 }}> (+{n(row.offers_withdrawn)} مسحوب)</span> : null}
                  </td>
                  <td>{row.best_offer == null ? <span className="faint">—</span> : iqd(row.best_offer)}</td>
                  <td>
                    <span className="pill" style={{ background: row.is_live ? 'var(--ok)' : 'var(--surface-2)' }}>
                      {row.is_live ? 'حيّ' : STATUS_LABEL[row.status] || row.status}
                    </span>
                  </td>
                  <td className="faint" style={{ fontSize: 12 }}>
                    {ago(row.created_at)}
                    {row.is_live ? <div>ينتهي بعد {until(row.expires_at)}</div> : null}
                  </td>
                </tr>
                {openId === row.id ? (
                  <tr>
                    <td colSpan={10} style={{ background: 'rgba(255,255,255,.02)' }}>
                      <RequestDetail row={row} detail={detail} />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            أحدث
          </button>
          <button className="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            أقدم
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            {total ? `${offset + 1}–${Math.min(total, offset + PAGE)} من ${n(total)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The pair, in one cell: how many devices, and how many of them fit the budget. */
function Matched({ row }: { row: Row }) {
  if (!row.matched_devices) return <span style={{ color: 'var(--warn)' }}>0</span>;
  const extras: string[] = [];
  if (row.matched_in_budget !== row.matched_devices) extras.push(`${row.matched_in_budget} ضمن السقف`);
  if (row.matched_call_for_price) extras.push(`${row.matched_call_for_price} بالاتصال`);
  return (
    <>
      <strong>{n(row.matched_devices)}</strong>
      {extras.length ? <div className="faint" style={{ fontSize: 11.5 }}>{extras.join(' · ')}</div> : null}
      {row.cheapest_match != null ? (
        <div className="faint" style={{ fontSize: 11.5 }}>الأرخص {iqd(row.cheapest_match)}</div>
      ) : null}
    </>
  );
}

function RequestDetail({ row, detail }: { row: Row; detail: Detail | null }) {
  if (!detail) return <div className="muted" style={{ padding: 12 }}>…</div>;
  const { offers, matched_listings, stats } = detail;
  const quiet = matched_listings.filter((m) => !m.seller_answered).length;

  return (
    <div style={{ padding: '12px 4px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 360px', minWidth: 0 }}>
        <h3>العروض ({offers.length})</h3>
        {row.note ? <p className="muted" style={{ fontSize: 12.5 }}>ملاحظة المشتري: {row.note}</p> : null}
        {offers.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5 }}>
            لا عروض.{' '}
            {matched_listings.length
              ? `${stats.matched_sellers} بائع يملك هذا الجهاز الآن ولم يرد أحد منهم.`
              : 'ولا جهاز مطابق على الموقع — الطلب بلا مخزون يقابله.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>البائع</th><th>السعر</th><th>بعد</th><th>الإعلان</th><th></th></tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} style={{ opacity: o.status === 'sent' ? 1 : 0.55 }}>
                  <td>
                    {o.seller.name}
                    {o.seller.is_shop ? <span className="faint" style={{ fontSize: 11.5 }}> · متجر</span> : null}
                    {o.seller.phone ? <div className="faint" style={{ fontSize: 11.5 }}>{o.seller.phone}</div> : null}
                  </td>
                  <td>
                    {iqd(o.price)}
                    {o.above_budget ? <div style={{ color: 'var(--warn)', fontSize: 11.5 }}>فوق السقف</div> : null}
                  </td>
                  <td className="faint" style={{ fontSize: 12 }}>{dur(o.waited_ms)}</td>
                  <td>
                    {o.listing_id
                      ? <a href={listingUrl(o.listing_id)} target="_blank" rel="noreferrer" style={listingLinkStyle}>#{o.listing_id}</a>
                      : <span className="faint">بدون</span>}
                  </td>
                  <td>{o.status === 'sent' ? null : <span className="faint" style={{ fontSize: 11.5 }}>مسحوب</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {offers.some((o) => o.note) ? (
          <ul className="activity-list" style={{ marginTop: 8 }}>
            {offers.filter((o) => o.note).map((o) => (
              <li key={o.id}><strong>{o.seller.name}</strong><span className="muted">{o.note}</span></li>
            ))}
          </ul>
        ) : null}
      </div>

      <div style={{ flex: '1 1 360px', minWidth: 0 }}>
        <h3>أجهزة مطابقة ({matched_listings.length})</h3>
        <p className="muted" style={{ fontSize: 12.5 }}>
          نفس القاعدة التي يستخدمها البث للبائعين: الماركة والموديل بعد التوحيد، وسعر لا يتجاوز سقف المشتري +20%.
          {quiet ? ` ${quiet} من أصحابها لم يرسل عرضاً.` : ''}
        </p>
        {matched_listings.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5 }}>لا يوجد على الموقع جهاز يطابق هذا الطلب.</p>
        ) : (
          <table>
            <thead>
              <tr><th>الإعلان</th><th>السعر</th><th>البائع</th><th>الحالة</th></tr>
            </thead>
            <tbody>
              {matched_listings.map((m) => (
                <tr key={m.id}>
                  <td>
                    <a href={listingUrl(m.id)} target="_blank" rel="noreferrer" style={listingLinkStyle}>
                      {m.brand} {m.model}
                    </a>
                    <div className="faint" style={{ fontSize: 11.5 }}>
                      {[m.storage, m.color, m.condition, m.governorate].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    {m.call_for_price ? <span className="faint">بالاتصال</span> : iqd(m.asking_price)}
                    {m.above_budget && !m.call_for_price
                      ? <div style={{ color: 'var(--warn)', fontSize: 11.5 }}>فوق السقف</div> : null}
                  </td>
                  <td>
                    {m.seller?.name || '—'}
                    {m.seller?.phone ? <div className="faint" style={{ fontSize: 11.5 }}>{m.seller.phone}</div> : null}
                  </td>
                  <td>
                    {m.seller_answered
                      ? <span className="pill" style={{ background: 'var(--ok)' }}>ردّ</span>
                      : <span className="pill" style={{ background: 'var(--surface-2)' }}>لم يرد</span>}
                    {m.status !== 'active' ? <div className="faint" style={{ fontSize: 11.5 }}>{m.status}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {stats.offer_count_drift !== 0 ? (
          <p style={{ color: 'var(--warn)', fontSize: 12.5 }}>
            عدّاد العروض المخزّن في الطلب يختلف عن الصفوف بمقدار {stats.offer_count_drift} — التطبيق يعرض العدّاد، وهذه الصفحة تعدّ الصفوف.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={warn ? { color: 'var(--warn)' } : undefined}>{value}</div>
      {sub ? <div className="kpi-sub muted">{sub}</div> : null}
    </div>
  );
}

function Empty() {
  return <div className="empty muted">لا بيانات بعد.</div>;
}
