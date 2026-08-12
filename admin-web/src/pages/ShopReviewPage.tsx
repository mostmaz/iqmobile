// Shop review queue.
//
// A first registration no longer publishes. Approving here publishes the
// shop's IDENTITY — directory entry, متجر badge, shop page. It deliberately
// does not touch the owner's listings, which have been live the whole time:
// shops are over half of active inventory, and freezing that on our response
// time would punish honest sellers.
//
// The call and WhatsApp buttons are not a convenience. Every shop owner is
// currently on app 0.2.1, which has no review screen at all — so for now the
// phone IS the review conversation, and the in-app thread only starts
// mattering once they update.

import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Shop = {
  id: number; shop_name: string | null; display_name: string;
  phone: string | null; shop_phone: string | null; shop_whatsapp: string | null;
  shop_bio: string | null; shop_address: string | null; governorate: string | null;
  shop_image_path: string | null;
  shop_status: string; shop_review_note: string | null;
  shop_reviewed_at: number | null; shop_created_at: number | null;
  listing_count: number; message_count: number; unread_from_shop: number;
  app_version: string | null;
};
type Msg = { id: number; author: 'admin' | 'shop'; body: string; created_at: number };

const TABS: { key: 'pending' | 'approved' | 'rejected'; label: string }[] = [
  { key: 'pending', label: 'بانتظار المراجعة' },
  { key: 'approved', label: 'مقبولة' },
  { key: 'rejected', label: 'مرفوضة' },
];

// Below this the owner's app has no review screen — no banner, no thread.
const REVIEW_UI_MIN = '0.3.0';
function tooOld(v: string | null): boolean {
  if (!v) return true;
  const a = v.split('.').map((x) => parseInt(x, 10) || 0);
  const b = REVIEW_UI_MIN.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d < 0; }
  return false;
}

const when = (t: number | null) => (t ? new Date(t).toLocaleString('ar-IQ') : '—');
const intl = (p: string) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.startsWith('0') ? `964${d.slice(1)}` : d.startsWith('964') ? d : d;
};

export function ShopReviewPage() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [shops, setShops] = useState<Shop[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ shops: Shop[]; counts: Record<string, number> }>(
        `/admin/shops/review?status=${tab}`,
      );
      setShops(r.shops); setCounts(r.counts || {}); setErr('');
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); setOpen(null); }, [tab]);

  async function openThread(id: number) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setThread([]); setDraft('');
    try {
      const r = await api<{ messages: Msg[] }>(`/admin/shops/${id}/review`);
      setThread(r.messages);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }

  async function decide(id: number, status: 'approved' | 'rejected' | 'pending') {
    setBusy(true);
    try {
      await api(`/admin/shops/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note: note.trim() || null }),
      });
      setNote(''); setOpen(null); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  async function send(id: number) {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api(`/admin/shops/${id}/review/messages`, {
        method: 'POST', body: JSON.stringify({ body }),
      });
      setDraft('');
      const r = await api<{ messages: Msg[] }>(`/admin/shops/${id}/review`);
      setThread(r.messages);
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="chart-title" style={{ marginLeft: 'auto' }}>مراجعة المتاجر</div>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'primary' : 'secondary'} onClick={() => setTab(t.key)}>
            {t.label}{counts[t.key] ? ` (${counts[t.key]})` : ''}
          </button>
        ))}
        <button className="secondary" onClick={() => void load()}>تحديث</button>
      </div>

      {loading ? <div className="card">…</div> : !shops.length ? (
        <div className="card muted" style={{ fontSize: 13 }}>
          {tab === 'pending' ? 'لا توجد متاجر بانتظار المراجعة.' : 'لا شيء هنا.'}
        </div>
      ) : shops.map((sh) => (
        <div key={sh.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {sh.shop_name || sh.display_name}
                {sh.unread_from_shop > 0 ? (
                  <span style={{ marginRight: 8, background: '#E0764F', color: '#fff', borderRadius: 999, padding: '1px 7px', fontSize: 11 }}>
                    {sh.unread_from_shop} رد
                  </span>
                ) : null}
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {sh.governorate || '—'} · {sh.listing_count} إعلان نشط · سجّل {when(sh.shop_created_at)}
              </div>
              {sh.shop_address ? <div className="muted" style={{ fontSize: 12.5 }}>{sh.shop_address}</div> : null}
              {sh.shop_bio ? <div style={{ fontSize: 13, marginTop: 6 }}>{sh.shop_bio}</div> : null}
            </div>
            {sh.shop_image_path ? (
              <img
                src={sh.shop_image_path.startsWith('http') ? sh.shop_image_path : `https://api.iqmobile.org${sh.shop_image_path}`}
                alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8 }}
              />
            ) : (
              <div className="muted" style={{
                width: 84, height: 84, borderRadius: 8, display: 'grid', placeItems: 'center',
                border: '1px dashed var(--rule,#262B32)', fontSize: 11, textAlign: 'center',
              }}>لا صورة</div>
            )}
          </div>

          {/* Reach him. For the current population this is the only channel
              that works, so it sits above the in-app thread, not below it. */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {(sh.shop_phone || sh.phone) ? (
              <>
                <a className="btn secondary" href={`tel:+${intl(sh.shop_phone || sh.phone || '')}`}>
                  ☎ {sh.shop_phone || sh.phone}
                </a>
                <a
                  className="btn secondary"
                  href={`https://wa.me/${intl(sh.shop_whatsapp || sh.shop_phone || sh.phone || '')}`}
                  target="_blank" rel="noreferrer"
                >
                  واتساب
                </a>
              </>
            ) : <span className="muted" style={{ fontSize: 12.5 }}>لا يوجد رقم</span>}
            <span className="muted" style={{ fontSize: 11.5 }}>
              نسخة التطبيق: {sh.app_version || 'غير معروفة'}
            </span>
            {tooOld(sh.app_version) ? (
              <span style={{ color: '#E0A33E', fontSize: 11.5 }}>
                — لا يرى الرسائل داخل التطبيق؛ سيصله إشعار فقط، والأفضل الاتصال به
              </span>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="secondary" onClick={() => void openThread(sh.id)}>
              {open === sh.id ? 'إغلاق المحادثة' : `المحادثة${sh.message_count ? ` (${sh.message_count})` : ''}`}
            </button>
            {sh.shop_status !== 'approved' ? (
              <button className="primary" disabled={busy} onClick={() => void decide(sh.id, 'approved')}>قبول ونشر</button>
            ) : (
              <button className="secondary" disabled={busy} onClick={() => void decide(sh.id, 'pending')}>إعادة للمراجعة</button>
            )}
            {sh.shop_status !== 'rejected' ? (
              <button className="secondary" disabled={busy} onClick={() => void decide(sh.id, 'rejected')} style={{ color: '#E8635A' }}>رفض</button>
            ) : null}
          </div>

          {open === sh.id ? (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--rule,#262B32)', paddingTop: 10 }}>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="سبب القرار (يُرسل له مع الإشعار) — اختياري"
                style={{ width: '100%', marginBottom: 10 }}
              />
              <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 8 }}>
                {thread.length ? thread.map((m) => (
                  <div key={m.id} style={{
                    marginBottom: 6, padding: '7px 10px', borderRadius: 8, fontSize: 13,
                    background: m.author === 'admin' ? 'rgba(63,95,125,0.18)' : 'rgba(224,118,79,0.14)',
                  }}>
                    <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>
                      {m.author === 'admin' ? 'الإدارة' : 'صاحب المتجر'} · {when(m.created_at)}
                    </div>
                    {m.body}
                  </div>
                )) : <p className="muted" style={{ fontSize: 12.5 }}>لا رسائل بعد.</p>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void send(sh.id); }}
                  placeholder="اكتب ما يحتاج تعديله…"
                  style={{ flex: 1 }}
                />
                <button className="primary" disabled={busy || !draft.trim()} onClick={() => void send(sh.id)}>إرسال</button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
