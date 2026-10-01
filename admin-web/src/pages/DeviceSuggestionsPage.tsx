import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

// Review queue for "my device isn't in the list" submissions. A seller who
// can't find their device types it by hand; the listing still posts with that
// free-text model and a row lands here. Approving copies it into the device
// catalog so the NEXT seller finds it in the picker.
//
// The brand + model are editable before approving on purpose: sellers type
// things like "ايفون 16" or "4Magic pad", and that string becomes a permanent
// catalog entry every future seller sees. Fixing spelling here is the whole
// point of the review step. The server rejects a brand outside the catalog,
// so brand is a dropdown rather than free text.

type Suggestion = {
  id: number;
  brand: string;
  model: string;
  device_type: 'phone' | 'tablet' | 'watch';
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  user_name: string | null;
  user_phone: string | null;
};
type Brand = { id: number; name: string };
type DailyReport = {
  ran_at: number; apply: boolean;
  summary: Record<string, number>;
  suggestions: { pending: { id: number; from: string; note: string }[] };
  listings: { renamed: { id: number; from: string; to: string }[] };
  catalog: { removed: { id: number; brand: string; model: string; why: string }[] };
} | null;

// The automatic daily pass (server/src/deviceNameDaily.js) decides most of
// this queue by itself at 04:00 Baghdad: devices already in the catalogue,
// devices GSMArena knows, accessories and bare brands. What is left pending
// below is what it could not decide. This card says what it did last.
function DailyPassCard({ onRan }: { onRan: () => void }) {
  const [rep, setRep] = useState<DailyReport>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setRep(await api<DailyReport>('/admin/device-names/daily')); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function run() {
    setBusy(true); setErr('');
    try { setRep(await api<DailyReport>('/admin/device-names/daily/run', { method: 'POST' })); onRan(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const s = rep?.summary || {};
  const when = rep ? new Date(rep.ran_at).toLocaleString('en-GB', { timeZone: 'Asia/Baghdad' }) : '—';
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>التنظيف اليومي التلقائي للأسماء</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        يشتغل كل يوم الساعة 4 الفجر (بغداد): ينظّف الكتالوج، يقرر الاقتراحات الواضحة، ويصحّح أسماء وماركات الإعلانات الجديدة.
        آخر تشغيل: <span dir="ltr">{when}</span>
      </p>
      {rep ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13.5 }}>
          <span>إعلانات فُحصت: <b>{s.listings_scanned ?? 0}</b></span>
          <span>أسماء صُحّحت: <b>{s.listings_renamed ?? 0}</b></span>
          <span>اقتراحات قُبلت: <b>{(s.suggestions_approved ?? 0) + (s.suggestions_added ?? 0)}</b></span>
          <span>أجهزة جديدة أُضيفت: <b>{(s.suggestions_added ?? 0) + (s.catalog_topped_up ?? 0)}</b></span>
          <span>اقتراحات رُفضت: <b>{s.suggestions_rejected ?? 0}</b></span>
          <span>صفوف كتالوج حُذفت/نُقلت: <b>{(s.catalog_removed ?? 0) + (s.catalog_moved ?? 0)}</b></span>
          <span>بقيت للمراجعة: <b>{s.suggestions_left ?? 0}</b></span>
        </div>
      ) : <p className="muted" style={{ margin: 0 }}>لم يشتغل بعد.</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button disabled={busy} onClick={run}>{busy ? 'يشتغل…' : 'شغّله الآن'}</button>
        {rep?.listings?.renamed?.length ? (
          <button className="secondary" onClick={() => setOpen(!open)}>{open ? 'إخفاء التفاصيل' : 'التفاصيل'}</button>
        ) : null}
      </div>
      {open && rep ? (
        <div style={{ fontSize: 12.5, marginTop: 10, maxHeight: 260, overflow: 'auto' }} dir="ltr">
          {rep.listings.renamed.map((x) => <div key={'l' + x.id}>#{x.id} {x.from} → {x.to}</div>)}
          {rep.catalog.removed.map((x) => <div key={'c' + x.id}>catalogue −{x.brand} {x.model} ({x.why})</div>)}
        </div>
      ) : null}
      {err ? <p style={{ color: '#f87171', marginBottom: 0 }}>{err}</p> : null}
    </div>
  );
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  return `قبل ${Math.floor(h / 24)} يوم`;
}

export function DeviceSuggestionsPage({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [edits, setEdits] = useState<Record<number, { brand: string; model: string; device_type: string }>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        api<Suggestion[]>(`/admin/device-suggestions?status=${status}`),
        api<Brand[]>('/admin/brands'),
      ]);
      setRows(s);
      setBrands(b);
      setEdits(Object.fromEntries(s.map((x) => [x.id, { brand: x.brand, model: x.model, device_type: x.device_type }])));
      setErr('');
    } catch (e: any) { setErr(e.message); }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function decide(id: number, action: 'approve' | 'reject') {
    setBusy(id);
    setErr('');
    try {
      const body = action === 'approve' ? JSON.stringify(edits[id] || {}) : undefined;
      await api(`/admin/device-suggestions/${id}/${action}`, { method: 'POST', body });
      await load();
      onChanged?.();   // refresh the nav badge immediately
    } catch (e: any) {
      setErr(e.message === 'unknown_brand'
        ? 'الماركة غير موجودة في الكتالوج — اختر ماركة من القائمة.'
        : e.message);
    } finally { setBusy(null); }
  }

  return (
    <div>
      <DailyPassCard onRan={() => { load(); onChanged?.(); }} />
      <div className="card">
        <h2>أجهزة اقترحها البائعون</h2>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 0, maxWidth: 640 }}>
          بائع لم يجد جهازه في القائمة فكتبه يدوياً. الموافقة تضيفه إلى كتالوج الأجهزة
          ليجده البائع التالي — لذلك صحّح الاسم قبل الموافقة.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['pending', 'approved', 'rejected'] as const).map((s) => (
            <button key={s} className={status === s ? '' : 'secondary'} onClick={() => setStatus(s)}>
              {{ pending: 'بانتظار المراجعة', approved: 'مقبولة', rejected: 'مرفوضة' }[s]}
            </button>
          ))}
        </div>
        {err ? <p style={{ color: '#f87171', marginBottom: 0 }}>{err}</p> : null}
      </div>

      {rows.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>لا توجد اقتراحات في هذه القائمة.</p></div>
      ) : rows.map((r) => {
        const e = edits[r.id] || { brand: r.brand, model: r.model, device_type: r.device_type };
        const set = (patch: Partial<typeof e>) => setEdits((m) => ({ ...m, [r.id]: { ...e, ...patch } }));
        return (
          <div className="card" key={r.id}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              كتبه البائع: <strong style={{ color: '#e5e7eb' }}>{r.brand} {r.model}</strong>
              {' · '}{r.user_name || 'مستخدم محذوف'}
              {r.user_phone ? <span dir="ltr"> · {r.user_phone}</span> : null}
              {' · '}{timeAgo(r.created_at)}
            </div>

            {r.status === 'pending' ? (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={e.brand} onChange={(ev) => set({ brand: ev.target.value })}>
                    {brands.some((b) => b.name === e.brand) ? null : <option value={e.brand}>{e.brand} (غير معروفة)</option>}
                    {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </select>
                  <input value={e.model} onChange={(ev) => set({ model: ev.target.value })} placeholder="اسم الموديل" style={{ minWidth: 220 }} />
                  <select value={e.device_type} onChange={(ev) => set({ device_type: ev.target.value })}>
                    <option value="phone">phone</option>
                    <option value="tablet">tablet</option>
                    <option value="watch">watch</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button disabled={busy === r.id || !e.model.trim()} onClick={() => decide(r.id, 'approve')}>
                    أضِف إلى الكتالوج
                  </button>
                  <button className="danger" disabled={busy === r.id} onClick={() => decide(r.id, 'reject')}>
                    رفض
                  </button>
                </div>
              </>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>
                {r.status === 'approved' ? '✓ أُضيف إلى الكتالوج' : '✕ مرفوض'} — {r.brand} {r.model} ({r.device_type})
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
