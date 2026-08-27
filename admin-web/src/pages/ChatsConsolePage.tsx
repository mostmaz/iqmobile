// Customer chat console — every buyer↔seller conversation in the
// marketplace, readable and answerable from the admin dashboard.
//
// A reply sent here goes out as the THREAD'S SELLER, which is how store
// chats have always been answered from the operator app: the buyer sees one
// consistent counterpart instead of a mystery third party. Use it to answer
// for the house store, and to step into a shop's thread when a customer is
// waiting on someone who has gone quiet.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../api';

type Thread = {
  id: number; buyer_id: number; buyer_name: string;
  seller_id: number; seller_name: string;
  listing_id: number | null; listing_label: string | null; listing_status: string | null;
  last_message: string | null; last_message_at: number;
  closed: boolean; awaiting_seller: boolean;
};
type Msg = {
  id: number; sender_id: number; body: string | null;
  image_path: string | null; created_at: number; sender_name: string;
};

const when = (ms: number) => {
  const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  return new Date(ms).toLocaleDateString();
};

export function ChatsConsolePage() {
  const [rows, setRows] = useState<Thread[] | null>(null);
  const [q, setQ] = useState('');
  const [awaiting, setAwaiting] = useState(false);
  const [open, setOpen] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<Thread[]>(`/admin/chats?q=${encodeURIComponent(q)}${awaiting ? '&awaiting=1' : ''}`);
      setRows(r); setErr('');
    } catch (e: any) { setErr(e.message); }
  }, [q, awaiting]);
  useEffect(() => { load(); const iv = setInterval(load, 25000); return () => clearInterval(iv); }, [load]);

  const loadThread = useCallback(async (id: number) => {
    try {
      const r = await api<{ messages: Msg[] }>(`/admin/chats/${id}/messages`);
      setMsgs(r.messages);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch { /* the poll will retry */ }
  }, []);
  useEffect(() => {
    if (!open) return;
    loadThread(open.id);
    const iv = setInterval(() => loadThread(open.id), 10000);
    return () => clearInterval(iv);
  }, [open, loadThread]);

  async function send() {
    const body = draft.trim();
    if (!body || !open) return;
    setBusy(true);
    try {
      await api(`/admin/chats/${open.id}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      setDraft(''); await loadThread(open.id); load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}
      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="chart-title" style={{ marginInlineEnd: 'auto' }}>محادثات الزبائن</div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={awaiting} onChange={(e) => setAwaiting(e.target.checked)} />
            بانتظار رد البائع فقط
          </label>
          <input placeholder="ابحث بالزبون أو المتجر أو الجهاز…" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: open ? '360px 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
        <div>
          {rows === null ? <div className="card muted">جارٍ التحميل…</div>
            : !rows.length ? <div className="card muted">لا محادثات مطابقة.</div>
              : rows.map((c) => (
                <button key={c.id} onClick={() => setOpen(c)} className="card" style={{
                  display: 'block', width: '100%', textAlign: 'start', cursor: 'pointer',
                  marginBottom: 8, border: open?.id === c.id ? '1px solid #d9583a' : undefined,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13.5 }}>{c.buyer_name}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>← {c.seller_name}</span>
                    {c.awaiting_seller ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>بانتظار رد</span>
                    ) : null}
                    <span className="muted" style={{ fontSize: 11.5, marginInlineStart: 'auto' }}>{when(c.last_message_at)}</span>
                  </div>
                  {c.listing_label ? (
                    <div className="muted" style={{ fontSize: 12, marginTop: 3, direction: 'ltr', textAlign: 'right' }}>
                      {c.listing_label}{c.listing_status === 'sold' ? ' · مباع' : ''}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.last_message || '…'}
                  </div>
                </button>
              ))}
        </div>

        {open ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '70vh', position: 'sticky', top: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 8, borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
              <strong>{open.buyer_name}</strong>
              <span className="muted" style={{ fontSize: 12.5 }}>مع {open.seller_name}</span>
              {open.listing_label ? (
                <span className="muted" style={{ fontSize: 12, direction: 'ltr' }}>· {open.listing_label}</span>
              ) : null}
              <button className="secondary" style={{ marginInlineStart: 'auto' }} onClick={() => setOpen(null)}>إغلاق</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0' }}>
              {msgs.map((m) => {
                const fromSeller = m.sender_id === open.seller_id;
                return (
                  <div key={m.id} style={{
                    alignSelf: fromSeller ? 'flex-start' : 'flex-end', maxWidth: '75%',
                    background: fromSeller ? '#d9583a' : 'rgba(128,128,128,0.16)',
                    color: fromSeller ? '#fff' : undefined,
                    borderRadius: 12, padding: '8px 11px', fontSize: 13.5,
                  }}>
                    {m.body}
                    {m.image_path ? (
                      <img src={`${API_BASE}${m.image_path}`} alt="" style={{ maxWidth: 200, borderRadius: 8, display: 'block', marginTop: 6 }} />
                    ) : null}
                    <div style={{ fontSize: 10.5, opacity: 0.75, marginTop: 4 }}>
                      {m.sender_name} · {when(m.created_at)}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(128,128,128,0.2)' }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                placeholder={`رد باسم ${open.seller_name}…`} style={{ flex: 1 }} />
              <button className="primary" disabled={busy || !draft.trim()} onClick={send}>إرسال</button>
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              الرد يوصل الزبون باسم «{open.seller_name}» مع إشعار بالتطبيق.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
