// Advanced-dashboard upgrade requests (spec §1, §3).
//
// The point of this screen is EVIDENCE: every request is shown next to the
// signals actually measured for that shop, so approval is a judgement about
// a real business rather than about a name in a list. Shops flagged by the
// 60-day rule appear below — for review, never for automatic revocation.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type Req = {
  id: number; shop_id: number; store_name: string; governorate: string;
  device_count_approx: number | null; sells_new: number; phone: string; whatsapp: string;
  status: string; created_at: number; admin_note?: string | null;
  shop_name?: string; display_name?: string; shop_governorate?: string;
  account_phone?: string; shop_tier?: string; verified?: number;
  active_listings?: number; listings_30d?: number; contacts_30d?: number;
  whatsapp_30d?: number; chat_30d?: number; call_30d?: number; qualifies?: number;
  // The shop's stored flag — what qualification reads. `sells_new` on the
  // row is only what the owner ticked on the form.
  shop_sells_new?: number;
};
type Flagged = {
  id: number; shop_name?: string; display_name?: string; shop_tier_flagged_at: number;
  active_listings?: number; listings_30d?: number; contacts_30d?: number;
};

const when = (ms: number) => new Date(ms).toLocaleString();

export function TierRequestsPage({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rows, setRows] = useState<Req[]>([]);
  const [flagged, setFlagged] = useState<Flagged[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ requests: Req[]; flagged: Flagged[] }>(`/admin/tier-requests?status=${status}`);
      setRows(r.requests); setFlagged(r.flagged); setErr('');
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function decide(r: Req, action: 'approve' | 'reject') {
    const note = prompt(
      action === 'approve'
        ? 'ملاحظة داخلية (اختياري):'
        : 'سبب الرفض — يُرسل للمتجر إذا كتبته:',
      '',
    );
    if (note === null) return;
    setBusy(true);
    try {
      await api(`/admin/tier-requests/${r.id}/${action}`, { method: 'POST', body: JSON.stringify({ note }) });
      await load(); onChanged?.();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  // The store is notified in-app automatically; this is the manual WhatsApp
  // follow-up, pre-written so it goes out in one tap from the owner's own
  // number (no WhatsApp API in the stack).
  function waLink(r: Req, approved: boolean) {
    const phone = (r.phone || r.whatsapp || r.account_phone || '').replace(/\D/g, '').replace(/^0/, '964');
    const text = approved
      ? `مرحباً ${r.store_name || ''} 👋\nتمت ترقية لوحة متجرك على iQ Mobile — صار عندك تعديل الأسعار بالجملة، جدول الأجهزة على الكمبيوتر، وتنبيهات شنو يدور عليه الناس بمحافظتك.\nسجّل دخولك: https://iqmobile.org/dashboard/`
      : `مرحباً ${r.store_name || ''} 👋\nراجعنا طلب ترقية لوحة متجرك. تكدر تعيد الطلب بعد ٣٠ يوم — وإذا عندك أي سؤال راسلنا.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="chart-title">طلبات ترقية لوحة المتجر ({rows.length})</div>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="pending">قيد المراجعة</option>
            <option value="approved">مقبولة</option>
            <option value="rejected">مرفوضة</option>
          </select>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          الأرقام محسوبة يومياً من نشاط المتجر الفعلي — يؤهل المتجر إذا تحقق أي شرط:
          ١٠ أجهزة معروضة · ٨ أجهزة خلال ٣٠ يوم · ٣٠ تواصل خلال ٣٠ يوم · يبيع أجهزة جديدة.
        </div>
      </div>

      {loading ? <div className="card muted">جارٍ التحميل…</div>
        : !rows.length ? <div className="card muted">لا طلبات بهذي الحالة.</div>
          : rows.map((r) => {
            const qualifies = !!r.qualifies;
            return (
              <div key={r.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{r.shop_name || r.store_name || r.display_name}</strong>
                    {r.verified ? <span style={{ marginInlineStart: 6 }}>✔️</span> : null}
                    <span className="muted" style={{ marginInlineStart: 8, fontSize: 12.5 }}>
                      {r.shop_governorate || r.governorate} · متجر #{r.shop_id}
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>{when(r.created_at)}</span>
                </div>

                {/* Evidence */}
                <div style={{
                  display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0',
                  padding: '10px 12px', background: 'rgba(128,128,128,0.08)', borderRadius: 10,
                }}>
                  <Sig label="أجهزة معروضة" value={r.active_listings ?? 0} hit={(r.active_listings ?? 0) >= 10} target="١٠" />
                  <Sig label="نشر ٣٠ يوم" value={r.listings_30d ?? 0} hit={(r.listings_30d ?? 0) >= 8} target="٨" />
                  <Sig label="تواصل ٣٠ يوم" value={r.contacts_30d ?? 0} hit={(r.contacts_30d ?? 0) >= 30} target="٣٠" />
                  <Sig label="أجهزة جديدة" value={r.shop_sells_new ? 'نعم' : 'لا'} hit={!!r.shop_sells_new} />
                  <span style={{
                    marginInlineStart: 'auto', alignSelf: 'center', fontSize: 12.5, fontWeight: 700,
                    color: qualifies ? '#7bd88f' : '#f59e0b',
                  }}>{qualifies ? 'مؤهل' : 'غير مؤهل — قرار يدوي'}</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  قال بالطلب: {r.device_count_approx ?? '—'} جهاز · أجهزة جديدة {r.sells_new ? 'نعم' : 'لا'} ·{' '}
                  <a href={`tel:${r.phone || r.account_phone}`}>{r.phone || r.account_phone || '—'}</a>
                  {' · '}تفصيل التواصل: واتساب {r.whatsapp_30d ?? 0} · محادثات {r.chat_30d ?? 0} · اتصال {r.call_30d ?? 0}
                </div>
                {r.admin_note ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>ملاحظة: {r.admin_note}</div> : null}

                {r.status === 'pending' ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button className="primary" disabled={busy} onClick={() => decide(r, 'approve')}>قبول الترقية</button>
                    <button className="danger" disabled={busy} onClick={() => decide(r, 'reject')}>رفض</button>
                    <a href={waLink(r, true)} target="_blank" rel="noreferrer">
                      <button className="secondary" type="button">واتساب: قبول</button>
                    </a>
                    <a href={waLink(r, false)} target="_blank" rel="noreferrer">
                      <button className="secondary" type="button">واتساب: رفض</button>
                    </a>
                  </div>
                ) : null}
              </div>
            );
          })}

      {flagged.length ? (
        <div className="card">
          <div className="chart-title">متاجر تحتاج مراجعة</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
            نزلت تحت كل شروط التأهيل ٦٠ يوم متواصلة. لا يُسحب الوصول تلقائياً — القرار لك.
          </div>
          {flagged.map((f) => (
            <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(128,128,128,0.2)' }}>
              <span style={{ flex: 1 }}>{f.shop_name || f.display_name || `متجر #${f.id}`}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {f.active_listings ?? 0} معروض · {f.listings_30d ?? 0} نشر · {f.contacts_30d ?? 0} تواصل
              </span>
              <button className="secondary" disabled={busy} onClick={async () => {
                if (!confirm('إرجاع المتجر للوحة البسيطة؟')) return;
                setBusy(true);
                try { await api(`/admin/shops/${f.id}/tier`, { method: 'POST', body: JSON.stringify({ tier: 'simple' }) }); await load(); onChanged?.(); }
                finally { setBusy(false); }
              }}>إرجاع للبسيطة</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Sig({ label, value, hit, target }: { label: string; value: number | string; hit: boolean; target?: string }) {
  return (
    <div style={{ minWidth: 108 }}>
      <div className="muted" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: hit ? '#7bd88f' : undefined }}>
        {value}{target ? <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> / {target}</span> : null}
      </div>
    </div>
  );
}
