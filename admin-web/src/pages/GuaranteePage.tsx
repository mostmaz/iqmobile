// ضمان iQ Mobile — the operator console for guarantee orders.
//
// Same philosophy as the COD orders page: the job at every stage is a phone
// call, so both numbers (buyer AND seller) sit on the card unhidden, and
// status buttons only offer legal next steps. The one stage with data entry
// is الفحص — the report and the deposit are entered together, in one PATCH,
// because "inspected" without a report is not a state we allow.

import React, { useEffect, useState } from 'react';
import { api, API_BASE } from '../api';

type GStatus =
  | 'new' | 'buyer_confirmed' | 'seller_confirmed' | 'picked_up'
  | 'inspected' | 'front_paid' | 'shipped' | 'delivered' | 'cancelled';

type GOrder = {
  id: number; code: string; listing_id: number | null;
  brand: string; model: string; storage: string | null; color: string | null;
  image_path: string | null; governorate: string | null;
  asking_price: number; fee_pct: number; fee: number; total: number;
  buyer_id: number | null; buyer_phone: string;
  seller_id: number | null; seller_phone: string | null; seller_opted_in: number;
  status: GStatus; front_payment: number | null; inspection_report: string | null;
  cancel_reason: string | null; cancelled_stage: string | null;
  delivered_at: number | null; created_at: number; updated_at: number;
};

const STATUS_AR: Record<GStatus, string> = {
  new: 'جديد',
  buyer_confirmed: 'المشتري مؤكّد',
  seller_confirmed: 'البائع موافق',
  picked_up: 'الجهاز عندنا',
  inspected: 'تم الفحص',
  front_paid: 'العربون مدفوع',
  shipped: 'قيد التوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};
// Mirrors GUARANTEE_NEXT on the server — the client offers, the server enforces.
const NEXT: Record<GStatus, GStatus[]> = {
  new: ['buyer_confirmed', 'cancelled'],
  buyer_confirmed: ['seller_confirmed', 'cancelled'],
  seller_confirmed: ['picked_up', 'cancelled'],
  picked_up: ['inspected', 'cancelled'],
  inspected: ['front_paid', 'cancelled'],
  front_paid: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [], cancelled: [],
};
const STATUS_COLOR: Record<GStatus, string> = {
  new: '#E0A33E', buyer_confirmed: '#378ADD', seller_confirmed: '#2FA3A0',
  picked_up: '#7F77DD', inspected: '#B078D6', front_paid: '#5E9E52',
  shipped: '#7F77DD', delivered: '#34C77B', cancelled: '#E05C4B',
};
const TABS: Array<{ key: '' | GStatus; label: string }> = [
  { key: '', label: 'الكل' },
  { key: 'new', label: 'جديد' },
  { key: 'buyer_confirmed', label: 'المشتري مؤكّد' },
  { key: 'seller_confirmed', label: 'البائع موافق' },
  { key: 'picked_up', label: 'الجهاز عندنا' },
  { key: 'inspected', label: 'تم الفحص' },
  { key: 'front_paid', label: 'العربون مدفوع' },
  { key: 'shipped', label: 'قيد التوصيل' },
  { key: 'delivered', label: 'تم التسليم' },
  { key: 'cancelled', label: 'ملغي' },
];
const CANCEL_REASONS = ['رفض البائع', 'رفض المشتري', 'فشل الفحص', 'أخرى'];

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');
const when = (ms: number) => new Date(ms).toLocaleString('en-GB', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

const ERRORS: Record<string, string> = {
  bad_transition: 'لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية.',
  bad_status: 'حالة غير صالحة.',
  report_required: 'اكتب تقرير الفحص أولاً.',
  bad_front_payment: 'مبلغ العربون غير صالح (يجب أن يكون رقماً بين صفر والمجموع).',
  not_found: 'الطلب غير موجود.',
};
const friendly = (e: any) => ERRORS[e?.message] || e?.message || 'خطأ غير متوقع';

export function GuaranteePage({ onChanged }: { onChanged?: () => void }) {
  const [orders, setOrders] = useState<GOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<'' | GStatus>('new');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  // Inspection entry state — which order has the form open, and its draft.
  const [inspecting, setInspecting] = useState<number | null>(null);
  const [report, setReport] = useState('');
  const [deposit, setDeposit] = useState('');

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (tab) p.set('status', tab);
      if (q.trim()) p.set('q', q.trim());
      const r = await api<{ total: number; counts: Record<string, number>; orders: GOrder[] }>(
        `/admin/guarantee?${p.toString()}`);
      setOrders(r.orders); setCounts(r.counts); setTotal(r.total); setErr('');
    } catch (e: any) { setErr(friendly(e)); } finally { setLoading(false); }
  }
  useEffect(() => { const h = setTimeout(load, 300); return () => clearTimeout(h); }, [tab, q]);

  async function move(o: GOrder, status: GStatus, extra: any = {}) {
    setBusy(o.id);
    try {
      await api(`/admin/guarantee/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status, ...extra }) });
      setInspecting(null);
      await load();
      onChanged?.();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(null); }
  }

  function cancelOrder(o: GOrder) {
    const reason = prompt(
      `إلغاء طلب الضمان ${o.code}؟\n\nاكتب السبب (أو اختر): ${CANCEL_REASONS.join(' / ')}`,
      CANCEL_REASONS[0],
    );
    if (!reason) return;
    move(o, 'cancelled', { cancel_reason: reason });
  }

  function startInspect(o: GOrder) {
    setInspecting(o.id);
    setReport(o.inspection_report || '');
    setDeposit(o.front_payment != null ? String(o.front_payment) : '');
  }

  // Post-inspection fix-ups without moving the status.
  async function saveDetails(o: GOrder) {
    setBusy(o.id);
    try {
      await api(`/admin/guarantee/${o.id}/details`, {
        method: 'PATCH',
        body: JSON.stringify({ inspection_report: report, front_payment: Number(deposit) }),
      });
      setInspecting(null);
      await load();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(null); }
  }

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chart-title" style={{ marginLeft: 'auto' }}>
            🛡️ ضمان iQ ({total.toLocaleString('en-US')})
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث برقم الطلب، الهاتف أو الجهاز…"
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
      </div>

      {loading ? <div className="card muted">Loading…</div> : null}
      {!loading && !orders.length ? (
        <div className="card muted" style={{ textAlign: 'center', padding: 32 }}>
          لا توجد طلبات ضمان{tab ? ` بحالة "${STATUS_AR[tab as GStatus]}"` : ''}.
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
            {o.seller_opted_in ? (
              <span style={{
                background: 'rgba(52,199,123,0.16)', color: '#34C77B', borderRadius: 999,
                padding: '3px 10px', fontSize: 12, fontWeight: 600,
              }}>
                البائع موافق مسبقاً
              </span>
            ) : null}
            <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{o.code}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{when(o.created_at)}</span>
            <strong style={{ marginRight: 'auto', color: 'var(--text-accent, #D9583A)' }}>
              {iqd(o.total)} د.ع
            </strong>
          </div>

          {/* The device + the money math, always visible. */}
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            {o.image_path ? (
              <img src={API_BASE + o.image_path} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
            ) : <div style={{ width: 48, height: 48, borderRadius: 6, background: '#2a2a2a' }} />}
            <div style={{ flex: 1, fontSize: 14 }}>
              <div><strong>{o.brand} {o.model}</strong>{o.storage ? ` · ${o.storage}` : ''}{o.color ? ` · ${o.color}` : ''}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                السعر {iqd(o.asking_price)} + رسوم {o.fee_pct}% ({iqd(o.fee)}) = <strong>{iqd(o.total)} د.ع</strong>
                {o.listing_id ? <> · إعلان #{o.listing_id}</> : null}
              </div>
            </div>
          </div>

          {/* Both phone calls this pipeline runs on. */}
          <div style={{ marginTop: 10, display: 'grid', gap: 4, fontSize: 14 }}>
            <div>
              المشتري: <a href={`tel:${o.buyer_phone}`} style={{ fontFamily: 'ui-monospace, monospace' }}>{o.buyer_phone}</a>
              {o.governorate ? <span className="muted"> · {o.governorate}</span> : null}
            </div>
            <div>
              البائع: {o.seller_phone
                ? <a href={`tel:${o.seller_phone}`} style={{ fontFamily: 'ui-monospace, monospace' }}>{o.seller_phone}</a>
                : <span className="muted">بدون رقم — عبر محادثة التطبيق</span>}
            </div>
            {o.front_payment != null ? (
              <div>العربون: <strong>{iqd(o.front_payment)} د.ع</strong>
                <span className="muted"> · المتبقي عند التسليم {iqd(o.total - o.front_payment)} د.ع</span>
              </div>
            ) : null}
            {o.inspection_report ? (
              <div className="muted" style={{ whiteSpace: 'pre-wrap', borderRight: '2px solid var(--border, #333)', paddingRight: 8 }}>
                📋 {o.inspection_report}
              </div>
            ) : null}
            {o.cancel_reason ? (
              <div className="muted">
                سبب الإلغاء: {o.cancel_reason}
                {o.cancelled_stage ? ` (عند مرحلة ${STATUS_AR[o.cancelled_stage as GStatus] || o.cancelled_stage})` : ''}
              </div>
            ) : null}
          </div>

          {/* الفحص form — the one stage with data entry. */}
          {inspecting === o.id ? (
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <textarea
                value={report}
                onChange={(e) => setReport(e.target.value)}
                placeholder="تقرير الفحص — حالة الشاشة، البطارية، الهيكل، مطابقة الوصف…"
                rows={4}
                style={{ width: '100%', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label>العربون (د.ع):</label>
                <input
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="مثلاً 50000"
                  style={{ width: 140, fontFamily: 'ui-monospace, monospace' }}
                />
                {o.status === 'picked_up' ? (
                  <button className="primary" disabled={busy === o.id}
                    onClick={() => move(o, 'inspected', { inspection_report: report, front_payment: Number(deposit) })}>
                    حفظ وإشعار المشتري
                  </button>
                ) : (
                  <button className="primary" disabled={busy === o.id} onClick={() => saveDetails(o)}>
                    حفظ التعديل
                  </button>
                )}
                <button className="secondary" onClick={() => setInspecting(null)}>إغلاق</button>
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {NEXT[o.status].filter((s) => s !== 'cancelled').map((s) => (
              s === 'inspected' ? (
                <button key={s} className="primary" disabled={busy === o.id} onClick={() => startInspect(o)}>
                  → تسجيل الفحص والعربون
                </button>
              ) : (
                <button key={s} className="primary" disabled={busy === o.id} onClick={() => move(o, s)}>
                  → {STATUS_AR[s]}
                </button>
              )
            ))}
            {/* Post-inspection fix-ups. */}
            {o.inspection_report && o.status !== 'picked_up' && inspecting !== o.id
              && !['delivered', 'cancelled'].includes(o.status) ? (
              <button className="secondary" disabled={busy === o.id} onClick={() => startInspect(o)}>
                تعديل التقرير/العربون
              </button>
            ) : null}
            {NEXT[o.status].includes('cancelled') ? (
              <button className="secondary" disabled={busy === o.id}
                style={{ color: 'salmon' }} onClick={() => cancelOrder(o)}>
                إلغاء
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
