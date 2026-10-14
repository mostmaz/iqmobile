// Reading a reported chat and banning from it.
//
// A scam report on a chat used to show "chat #4312" and nothing else: the
// operator had to go and find the thread, then go to Users to find the
// person. Here the thread opens from the report, both people are named with
// their number, whether they are already banned and how often they have been
// reported, and the ban is one press (with a confirm) next to each of them.
// The reporter is marked so it is obvious which side is accused.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE, listingUrl, listingLinkStyle } from '../api';

export type ChatParty = {
  role: 'buyer' | 'seller';
  id: number;
  name: string;
  phone: string | null;
  is_guest?: boolean;
  seller_type?: string;
  suspended_at: number | null;
  reports_against?: number;
  missing?: boolean;
  // The business's own account (house store, price shop): never bannable.
  protected?: boolean;
};
type Msg = {
  id: number; sender_id: number; body: string | null;
  image_path: string | null; created_at: number; sender_name: string;
};
type Thread = {
  chat: { id: number; buyer_id: number; seller_id: number; listing_id: number | null };
  messages: Msg[];
  parties: ChatParty[];
  listing: { id: number; brand: string; model: string; asking_price: number; status: string } | null;
};

const ROLE_AR = { buyer: 'المشتري', seller: 'البائع' } as const;
const stamp = (ms: number) => new Date(ms).toLocaleString();

/** The two people in a thread, each with a ban / unban button. */
export function ChatPartiesBar({ parties, reporterId, onChanged }: {
  parties: ChatParty[]; reporterId?: number | null; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');

  async function setBan(p: ChatParty, ban: boolean) {
    const who = `${p.name || 'المستخدم'}${p.phone ? ` (${p.phone})` : ''}`;
    if (!confirm(ban
      ? `حظر ${who}؟\nما يقدر يستخدم التطبيق بعد: لا رسائل ولا إعلانات.`
      : `إلغاء حظر ${who}؟`)) return;
    setBusy(p.id); setErr('');
    try {
      await api(`/admin/users/${p.id}/suspend`, {
        method: 'PATCH', body: JSON.stringify({ suspended: ban, from: 'chat_review' }),
      });
      onChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {parties.map((p) => {
          const banned = !!p.suspended_at;
          const isReporter = reporterId != null && p.id === reporterId;
          return (
            <div key={p.role} style={{
              border: `1px solid ${banned ? 'rgba(239,68,68,0.6)' : 'rgba(128,128,128,0.25)'}`,
              borderRadius: 10, padding: '8px 10px',
              background: banned ? 'rgba(239,68,68,0.08)' : undefined,
            }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 11.5 }}>{ROLE_AR[p.role]}</span>
                <strong style={{ fontSize: 13.5 }}>{p.name || '—'}</strong>
                {isReporter ? <span style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700 }}>صاحب البلاغ</span> : null}
                {banned ? <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>محظور</span> : null}
              </div>
              <div className="muted" style={{ fontSize: 12, direction: 'ltr', textAlign: 'right', marginTop: 2 }}>
                {p.phone || (p.is_guest ? 'ضيف — بدون رقم' : '—')} · #{p.id}
              </div>
              {p.reports_against ? (
                <div style={{ fontSize: 11.5, marginTop: 2, color: p.reports_against > 1 ? '#f59e0b' : undefined }}>
                  بلاغات ضده: {p.reports_against}
                </div>
              ) : null}
              {p.protected ? (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>حساب المتجر — ما ينحظر</div>
              ) : !p.missing ? (
                <button
                  className={banned ? 'secondary' : 'danger'}
                  disabled={busy === p.id}
                  style={{ marginTop: 6, width: '100%' }}
                  onClick={() => setBan(p, !banned)}
                >
                  {busy === p.id ? '…' : banned ? 'إلغاء الحظر' : `حظر ${ROLE_AR[p.role]}`}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {err ? <div style={{ color: 'salmon', fontSize: 12.5, marginTop: 6 }}>Error: {err}</div> : null}
    </div>
  );
}

/** A reported chat, read in full, with the ban controls above it. */
export function ChatReviewModal({ chatId, reporterId, onClose, onChanged }: {
  chatId: number; reporterId?: number | null; onClose: () => void; onChanged?: () => void;
}) {
  const [data, setData] = useState<Thread | null>(null);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<Thread>(`/admin/chats/${chatId}/messages`);
      setData(r); setErr('');
      setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 60);
    } catch (e: any) { setErr(e.message); }
  }, [chatId]);
  useEffect(() => { load(); }, [load]);

  const sellerId = data?.chat.seller_id;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto', zIndex: 50,
    }}>
      <div className="card" dir="rtl" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(760px, 100%)', marginTop: 20, display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>محادثة #{chatId}</h2>
          {data?.listing ? (
            <a href={listingUrl(data.listing.id)} target="_blank" rel="noreferrer" style={{ ...listingLinkStyle, fontSize: 12.5 }}>
              {data.listing.brand} {data.listing.model} · #{data.listing.id}
            </a>
          ) : null}
          <button className="secondary" style={{ marginInlineStart: 'auto' }} onClick={onClose}>إغلاق</button>
        </div>

        {err ? <div style={{ color: 'salmon', marginBottom: 8 }}>Error: {err}</div> : null}
        {!data ? <div className="muted">جارٍ التحميل…</div> : (
          <>
            <ChatPartiesBar parties={data.parties} reporterId={reporterId}
              onChanged={() => { load(); onChanged?.(); }} />
            <div style={{
              flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6,
              padding: '12px 2px', marginTop: 10, borderTop: '1px solid rgba(128,128,128,0.2)', minHeight: 200,
            }}>
              {!data.messages.length ? <div className="muted">لا رسائل في هذي المحادثة.</div> : null}
              {data.messages.map((m) => {
                const fromSeller = m.sender_id === sellerId;
                const fromReporter = reporterId != null && m.sender_id === reporterId;
                return (
                  <div key={m.id} style={{
                    alignSelf: fromSeller ? 'flex-start' : 'flex-end', maxWidth: '78%',
                    background: fromSeller ? '#d9583a' : 'rgba(128,128,128,0.16)',
                    color: fromSeller ? '#fff' : undefined,
                    borderRadius: 12, padding: '8px 11px', fontSize: 13.5,
                    outline: fromReporter ? '1px dashed #60a5fa' : undefined,
                  }}>
                    {m.body}
                    {m.image_path ? (
                      <a href={`${API_BASE}${m.image_path}`} target="_blank" rel="noreferrer">
                        <img src={`${API_BASE}${m.image_path}`} alt="" style={{ maxWidth: 220, borderRadius: 8, display: 'block', marginTop: 6 }} />
                      </a>
                    ) : null}
                    <div style={{ fontSize: 10.5, opacity: 0.75, marginTop: 4 }}>
                      {m.sender_name} · {stamp(m.created_at)}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
