import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { api } from '../api';

// Daily users.
//
// Two series, deliberately not merged into one "active users" number:
//   فتح التطبيق (opened)  — made any API call that day. Reach.
//   تفاعل (engaged)       — searched, opened a listing, or tapped contact.
// The gap between them is the interesting part: a tall opened line over a
// flat engaged line means people launch the app and leave.
//
// `opened` only starts from the day the tracking shipped — there is no
// history to backfill, because nothing was recording it. The page says so
// rather than letting the flat early stretch read as "nobody used the app".

type Row = { day: string; opened: number; engaged: number; signups: number; registrations: number; guests: number; listings: number };
type Totals = { dau: number; engaged_today: number; wau: number; mau: number; dau_mau_pct: number };
type Resp = {
  growth: {
    tracking_start: number;
    active_today: { total: number; guests: number; registered: number; returning: number };
    contact_buyers: number;
    cohort_start: string; cohort_end: string;
    retention: { day: number; eligible: number; returned: number; pct: number | null }[];
  };
  series: Row[];
  totals: Totals;
  platforms: { platform: string; users: number }[];
  app_versions: { version: string; users: number }[];
};

const RANGES = [
  { days: 7, label: '٧ أيام' },
  { days: 30, label: '٣٠ يوم' },
  { days: 90, label: '٩٠ يوم' },
];

const AXIS = { stroke: '#64748b', fontSize: 11 };
const TOOLTIP = {
  contentStyle: { background: '#16253c', border: '1px solid #1f3350', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#e8edf5' },
};

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

export function DailyUsersPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setData(null);
    api<Resp>(`/admin/analytics/daily?days=${days}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [days]);

  if (err) return <div className="card"><p style={{ color: 'var(--danger)' }}>{err}</p></div>;
  if (!data) return <div className="card"><p className="muted">جارٍ التحميل…</p></div>;

  const { totals } = data;
  // Short labels: '2026-08-05' -> '08-05'. The full date stays in the tooltip.
  const series = data.series.map((r) => ({ ...r, label: r.day.slice(5) }));
  const everOpened = data.series.some((r) => r.opened > 0);

  return (
    <div dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>المستخدمون اليوميون</h2>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r.days} className={days === r.days ? 'on' : ''} onClick={() => setDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="نشط اليوم" value={totals.dau.toLocaleString('en-US')} sub="فتحوا التطبيق" />
        <Kpi label="تفاعلوا اليوم" value={totals.engaged_today.toLocaleString('en-US')} sub="بحث · مشاهدة · تواصل" />
        <Kpi label="نشط هذا الأسبوع" value={totals.wau.toLocaleString('en-US')} sub="آخر ٧ أيام" />
        <Kpi label="نشط هذا الشهر" value={totals.mau.toLocaleString('en-US')} sub="آخر ٣٠ يوم" />
        <Kpi
          label="النشاط اليومي ÷ الشهري"
          value={`${totals.dau_mau_pct}%`}
          sub="مؤشر نشاط، وليس احتفاظاً بالمستخدمين"
        />
      </div>

      <div className="kpi-row">
        <Kpi label="حسابات مسجلة نشطة اليوم" value={data.growth.active_today.registered.toLocaleString('en-US')} />
        <Kpi label="حسابات ضيوف نشطة اليوم" value={data.growth.active_today.guests.toLocaleString('en-US')} />
        <Kpi label="عادوا اليوم" value={data.growth.active_today.returning.toLocaleString('en-US')} sub="نشطوا في يوم سابق مسجّل؛ يشمل الضيوف" />
        <Kpi label="مشترون تواصلوا" value={data.growth.contact_buyers.toLocaleString('en-US')} sub={`حسابات فريدة خلال ${days} يوم: اتصال، واتساب، رسالة مشتري`} />
      </div>
      <div className="card">
        <h3>الاحتفاظ بعد التسجيل D1 / D7 / D30</h3>
        <p className="muted">مجموعات التسجيل من {data.growth.cohort_start} إلى {data.growth.cohort_end}. النسبة لمن عاد في اليوم المحدد بالضبط بتوقيت بغداد. تُستبعد المجموعات التي لم ينتهِ يوم عودتها بعد.</p>
        <table className="data-table">
          <thead><tr><th>يوم العودة</th><th>المؤهلون</th><th>العائدون</th><th>الاحتفاظ</th></tr></thead>
          <tbody>{data.growth.retention.map(r => <tr key={r.day}><td>D{r.day}</td><td>{r.eligible}</td><td>{r.returned}</td><td>{r.pct === null ? 'لا توجد مجموعة مكتملة بعد' : `${r.pct}%`}</td></tr>)}</tbody>
        </table>
        <p className="muted">بدأ تسجيل تواريخ التسجيل وإنشاء الضيوف في {new Date(data.growth.tracking_start).toLocaleString('en-GB', { timeZone: 'Asia/Baghdad' })} بتوقيت بغداد. التواريخ السابقة غير معروفة وليست صفراً؛ لا تُحتسب الحسابات المستوردة كتسجيلات. اختر ٩٠ يوماً لمتابعة D30. الضيوف حسابات وليست جلسات أو أشخاصاً فريدين. حالة ضيف/مسجل هي الحالة الحالية. قياس الاتصال وواتساب يعتمد على إصدار التطبيق.</p>
      </div>

      {!everOpened ? (
        <div className="card" style={{ borderInlineStart: '3px solid var(--warn)' }}>
          <span style={{ color: 'var(--warn)', fontWeight: 650 }}>«فتح التطبيق» يبدأ من تاريخ تفعيل التتبّع.</span>
          <span className="muted"> لا توجد بيانات تاريخية له — الأرقام تتراكم من الآن. أما «تفاعل» فمسجّل من قبل.</span>
        </div>
      ) : null}

      <div className="card">
        <div className="chart-title">فتح التطبيق مقابل التفاعل</div>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <CartesianGrid stroke="#172741" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={18} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="opened" name="فتح التطبيق" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="engaged" name="تفاعل" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-row">
        <div className="card chart-card">
          <div className="chart-title">تسجيلات وإنشاء ضيوف (من بدء القياس)</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series.map(r => r.day < new Date(data.growth.tracking_start + 10800000).toISOString().slice(0, 10) ? { ...r, registrations: null, guests: null } : r)} margin={{ top: 8, right: 8, bottom: 4, left: -14 }}>
                <CartesianGrid stroke="#172741" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={22} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="registrations" name="تسجيلات فعلية" fill="#fbbf24" radius={[3, 3, 0, 0]} />
                <Bar dataKey="guests" name="حسابات ضيوف جديدة" fill="#64748b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card chart-card">
          <div className="chart-title">إعلانات جديدة</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 8, right: 8, bottom: 4, left: -14 }}>
                <CartesianGrid stroke="#172741" vertical={false} />
                <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} minTickGap={22} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...TOOLTIP} />
                <Bar dataKey="listings" name="إعلانات" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="chart-row">
        <div className="card chart-card">
          <div className="chart-title">المنصّة (آخر ٣٠ يوم)</div>
          {data.platforms.length === 0 ? (
            <p className="faint" style={{ margin: 0, fontSize: 13 }}>
              لا توجد بيانات بعد — التطبيق يرسل المنصّة مع كل طلب ابتداءً من الإصدار القادم.
            </p>
          ) : (
            <table className="data-table">
              <thead><tr><th>المنصّة</th><th>مستخدمون</th></tr></thead>
              <tbody>
                {data.platforms.map((p) => (
                  <tr key={p.platform}><td>{p.platform}</td><td>{p.users.toLocaleString('en-US')}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card chart-card">
          <div className="chart-title">إصدار التطبيق (آخر ٣٠ يوم)</div>
          {data.app_versions.length === 0 ? (
            <p className="faint" style={{ margin: 0, fontSize: 13 }}>
              لا توجد بيانات بعد — يظهر بعد أن ينتشر إصدار يرسل رقم النسخة.
            </p>
          ) : (
            <table className="data-table">
              <thead><tr><th>الإصدار</th><th>مستخدمون</th></tr></thead>
              <tbody>
                {data.app_versions.map((v) => (
                  <tr key={v.version}>
                    <td style={{ fontFamily: 'monospace' }}>{v.version}</td>
                    <td>{v.users.toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
