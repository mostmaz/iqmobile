// Printed QR stickers: who asked for one, and who has earned the free week.
//
// Two queues on one screen because they are two decisions the same person
// makes in the same sitting, minutes apart: print-and-post, then later
// "yes, that photo is the sticker on their wall".
//
// The proof queue leads, because it is the one with a shop waiting on an
// answer — the fulfilment queue is work we owe ourselves.
import React, { useCallback, useEffect, useState } from 'react';
import { api, API_BASE } from '../api';

type Req = {
  id: number; shop_id: number; sticker_kind: 'window' | 'stand'; qty: number;
  store_name?: string; governorate?: string; address?: string; phone?: string;
  status: string; admin_note?: string | null; created_at: number;
  printing_at?: number | null; shipped_at?: number | null;
  shop_name?: string; display_name?: string; shop_governorate?: string;
  account_phone?: string; shop_phone?: string; shop_whatsapp?: string; verified?: number;
  shipped_before?: number; sticker_url: string;
  active_listings?: number; scans?: number;
};

type Proof = Req & {
  proof_image_path?: string | null; proof_at?: number | null;
  proof_listings?: number | null; proof_note?: string | null;
  shop_featured_until?: number | null;
};

const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : '—');
const KIND_AR: Record<string, string> = { window: 'ملصق واجهة', stand: 'ستاند طاولة' };
const STATUS_AR: Record<string, string> = {
  pending: 'جديد', printing: 'قيد الطباعة', shipped: 'أُرسل', rejected: 'مرفوض',
};

export function StickerRequestsPage({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<'pending' | 'printing' | 'shipped' | 'rejected'>('pending');
  const [rows, setRows] = useState<Req[]>([]);
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reward, setReward] = useState({ days: 7, min_listings: 5 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ requests: Req[]; proofs: Proof[]; counts: any; reward: any }>(
        `/admin/sticker-requests?status=${status}`,
      );
      setRows(r.requests); setProofs(r.proofs); setCounts(r.counts || {});
      if (r.reward) setReward(r.reward);
      setErr('');
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function move(r: Req, action: 'printing' | 'shipped' | 'reject') {
    const note = action === 'reject'
      ? prompt('سبب الرفض — يُرسل للمتجر إذا كتبته:', '')
      : '';
    if (note === null) return;
    setBusy(true);
    try {
      await api(`/admin/sticker-requests/${r.id}/${action}`, { method: 'POST', body: JSON.stringify({ note }) });
      await load(); onChanged?.();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function decideProof(p: Proof, action: 'grant' | 'reject') {
    const note = action === 'grant'
      ? ''
      : prompt('شنو ناقص بالصورة؟ يُرسل للمتجر:', 'ابعث صورة تبيّن الملصق مثبّت بالمحل.');
    if (note === null) return;
    if (action === 'grant' && !confirm(`منح ${reward.days} أيام تمييز مجاني لهذا المتجر؟`)) return;
    setBusy(true);
    try {
      await api(`/admin/sticker-requests/${p.id}/proof/${action}`, {
        method: 'POST', body: JSON.stringify({ note }),
      });
      await load(); onChanged?.();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  // Pre-written WhatsApp follow-up from the owner's own number — same
  // pattern as the tier queue, there being no WhatsApp API in the stack.
  function waLink(r: Req, text: string) {
    const phone = (r.shop_phone || r.phone || r.account_phone || '').replace(/\D/g, '').replace(/^0/, '964');
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}

      {/* ── the free week ─────────────────────────────────────────── */}
      <div className="card">
        <div className="chart-title">إثباتات الملصق — تمييز مجاني ({proofs.length})</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          المتجر يرفع صورة الملصق مثبّت بمحله من داخل التطبيق. عدد الأجهزة محسوب
          تلقائياً من إعلاناته الفعّالة — ما يحتاج تعدّه. القبول يمنحه{' '}
          {reward.days} أيام تمييز، وتنضاف على أي تمييز مدفوع عنده أصلاً.
        </div>
      </div>

      {proofs.map((p) => {
        const enough = (p.proof_listings ?? 0) >= reward.min_listings;
        return (
          <div key={`p${p.id}`} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {p.proof_image_path ? (
                <a href={API_BASE + p.proof_image_path} target="_blank" rel="noreferrer">
                  <img
                    src={API_BASE + p.proof_image_path}
                    alt="صورة الملصق بالمحل"
                    style={{ width: 190, height: 190, objectFit: 'cover', borderRadius: 10, background: '#222' }}
                  />
                </a>
              ) : (
                <div className="muted" style={{
                  width: 190, height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 10, background: 'rgba(128,128,128,0.12)', fontSize: 12.5, textAlign: 'center',
                }}>
                  وصلت بالواتساب<br />بدون صورة مرفوعة
                </div>
              )}

              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{p.shop_name || p.display_name}</strong>
                    {p.verified ? <span style={{ marginInlineStart: 6 }}>✔️</span> : null}
                    <span className="muted" style={{ marginInlineStart: 8, fontSize: 12.5 }}>
                      {p.shop_governorate} · متجر #{p.shop_id}
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>{when(p.proof_at)}</span>
                </div>

                <div style={{
                  display: 'flex', gap: 14, flexWrap: 'wrap', margin: '10px 0',
                  padding: '10px 12px', background: 'rgba(128,128,128,0.08)', borderRadius: 10,
                }}>
                  <Sig
                    label="أجهزة وقت الإرسال"
                    value={p.proof_listings ?? 0}
                    hit={enough}
                    target={String(reward.min_listings)}
                  />
                  <Sig label="أجهزة اليوم" value={p.active_listings ?? 0} hit={(p.active_listings ?? 0) >= reward.min_listings} />
                  {/* Scans of the printed sticker. The photo says it exists;
                      this says customers are actually using it. */}
                  <Sig label="مسحات الكود" value={p.scans ?? 0} hit={(p.scans ?? 0) > 0} />
                  <Sig label="حالة الملصق" value={STATUS_AR[p.status] || p.status} hit={p.status === 'shipped'} />
                  {p.shop_featured_until && p.shop_featured_until > Date.now() ? (
                    <Sig label="مميّز لحد" value={new Date(p.shop_featured_until).toLocaleDateString()} hit />
                  ) : null}
                </div>

                {p.proof_note ? <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>ملاحظة المتجر: {p.proof_note}</div> : null}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="primary" disabled={busy} onClick={() => decideProof(p, 'grant')}>
                    امنح {reward.days} أيام تمييز
                  </button>
                  <button className="danger" disabled={busy} onClick={() => decideProof(p, 'reject')}>صورة غير كافية</button>
                  <a href={API_BASE + `/shop/${p.shop_id}`} target="_blank" rel="noreferrer">
                    <button className="secondary" type="button">صفحة المتجر</button>
                  </a>
                  <a href={waLink(p, `مرحباً ${p.shop_name || ''} 👋\nوصلتنا صورة الملصق — متجرك صار مميّز ${reward.days} أيام على iQ Mobile. شكراً!`)} target="_blank" rel="noreferrer">
                    <button className="secondary" type="button">واتساب</button>
                  </a>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {!proofs.length && !loading ? <div className="card muted">ما في إثباتات بانتظار المراجعة.</div> : null}

      {/* ── printing and posting ──────────────────────────────────── */}
      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="chart-title">طلبات ملصقات QR ({rows.length})</div>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="pending">جديد ({counts.pending ?? 0})</option>
            <option value="printing">قيد الطباعة ({counts.printing ?? 0})</option>
            <option value="shipped">أُرسل ({counts.shipped ?? 0})</option>
            <option value="rejected">مرفوض ({counts.rejected ?? 0})</option>
          </select>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          «ملف الطباعة» يفتح ملصق المتجر بمقاس A5 — اطبعه من المتصفح مباشرة أو
          احفظه PDF. كل ملصق يحمل كود متجره وحده.
        </div>
      </div>

      {loading ? <div className="card muted">جارٍ التحميل…</div>
        : !rows.length ? <div className="card muted">لا طلبات بهذي الحالة.</div>
          : rows.map((r) => (
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

              <div style={{
                display: 'flex', gap: 14, flexWrap: 'wrap', margin: '10px 0',
                padding: '10px 12px', background: 'rgba(128,128,128,0.08)', borderRadius: 10,
              }}>
                <Sig label="النوع" value={KIND_AR[r.sticker_kind] || r.sticker_kind} hit={false} />
                <Sig label="العدد" value={r.qty} hit={false} />
                <Sig label="أجهزة معروضة" value={r.active_listings ?? 0} hit={(r.active_listings ?? 0) >= reward.min_listings} />
                <Sig label="مسحات الكود" value={r.scans ?? 0} hit={(r.scans ?? 0) > 0} />
                {r.shipped_before ? <Sig label="ملصقات سابقة" value={r.shipped_before} hit={false} /> : null}
              </div>

              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>العنوان: {r.address || '—'}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  هاتف: <a href={`tel:${r.phone || r.shop_phone || r.account_phone}`}>{r.phone || r.shop_phone || r.account_phone || '—'}</a>
                  {r.printing_at ? ` · طباعة: ${when(r.printing_at)}` : ''}
                  {r.shipped_at ? ` · إرسال: ${when(r.shipped_at)}` : ''}
                </div>
              </div>
              {r.admin_note ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>ملاحظة: {r.admin_note}</div> : null}

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <a href={r.sticker_url} target="_blank" rel="noreferrer">
                  <button className="primary" type="button">ملف الطباعة (A5)</button>
                </a>
                {r.status === 'pending' ? (
                  <button className="secondary" disabled={busy} onClick={() => move(r, 'printing')}>علّم «قيد الطباعة»</button>
                ) : null}
                {r.status !== 'shipped' && r.status !== 'rejected' ? (
                  <button className="secondary" disabled={busy} onClick={() => move(r, 'shipped')}>علّم «أُرسل»</button>
                ) : null}
                {r.status !== 'shipped' && r.status !== 'rejected' ? (
                  <button className="danger" disabled={busy} onClick={() => move(r, 'reject')}>رفض</button>
                ) : null}
                <a
                  href={waLink(r, `مرحباً ${r.shop_name || ''} 👋\nملصق QR مال متجرك جاهز وبالطريق إلك. أول ما تلصقه بالمحل، ابعثلنا صورة من التطبيق وناخذها ${reward.days} أيام تمييز مجاني.`)}
                  target="_blank" rel="noreferrer"
                >
                  <button className="secondary" type="button">واتساب</button>
                </a>
              </div>
            </div>
          ))}
    </div>
  );
}

function Sig({ label, value, hit, target }: { label: string; value: number | string; hit: boolean; target?: string }) {
  return (
    <div style={{ minWidth: 104 }}>
      <div className="muted" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: hit ? '#7bd88f' : undefined }}>
        {value}{target ? <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> / {target}</span> : null}
      </div>
    </div>
  );
}
