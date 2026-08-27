// المحادثات — the store's inbox (spec §9).
//
// This is the app's own chat pipeline seen from the shop's side: a reply
// here inserts as the shop account, so the buyer sees it in their app
// exactly like any seller message, with a push.
//
// Simple stores get the plain thread list. Advanced adds filters, search,
// quick replies and the thread actions — additive, per §12. The channel is
// never auto-disabled and there is no penalty anywhere; a shop that has
// been slow simply sees the nudge banner.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../api';
import {
  T, FONT, shopApi, arNum, money, agoAr, Card, Btn, Chip, inputStyle,
  Skeleton, EmptyState, ErrorState, useWide,
} from './kit';

type Thread = {
  id: number; buyer_id: number; buyer_name: string;
  listing_id: number | null; listing_label: string | null; listing_cover: string | null;
  listing_status: string | null; listing_price: number | null;
  last_message: string | null; last_message_at: number; unread: boolean; closed: boolean;
};
type Msg = { id: number; sender_id: number; body: string | null; image_path: string | null; created_at: number };

export function ChatsView({ shopId, advanced }: { shopId?: number; advanced: boolean }) {
  const wide = useWide();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'closed'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [quick, setQuick] = useState<{ id: number; text: string }[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadList = useCallback(async () => {
    try {
      const params = advanced ? `?filter=${filter}&q=${encodeURIComponent(q)}` : '';
      setThreads(await shopApi<Thread[]>(`/shop-admin/chats${params}`));
      setErr('');
    } catch (e: any) { setErr(e.message); }
  }, [advanced, filter, q]);

  const loadThread = useCallback(async (id: number) => {
    try {
      setMsgs(await shopApi<Msg[]>(`/shop-admin/chats/${id}/messages`));
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch { /* keep the thread on screen if a poll blips */ }
  }, []);

  useEffect(() => { loadList(); const iv = setInterval(loadList, 20000); return () => clearInterval(iv); }, [loadList]);
  useEffect(() => {
    if (!open) return;
    loadThread(open.id);
    const iv = setInterval(() => loadThread(open.id), 8000);
    return () => clearInterval(iv);
  }, [open, loadThread]);
  useEffect(() => {
    if (advanced) shopApi<{ id: number; text: string }[]>('/shop-admin/quick-replies').then(setQuick).catch(() => {});
  }, [advanced]);

  async function send() {
    const body = draft.trim();
    if (!body || !open) return;
    setBusy(true);
    try {
      await shopApi(`/shop-admin/chats/${open.id}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      setDraft('');
      await loadThread(open.id);
      loadList();
    } catch { /* surfaced by the next poll */ }
    setBusy(false);
  }

  async function act(path: string, confirmText?: string) {
    if (!open) return;
    if (confirmText && !window.confirm(confirmText)) return;
    try { await shopApi(`/shop-admin/chats/${open.id}/${path}`, { method: 'POST', body: '{}' }); }
    catch { /* ignore */ }
    setOpen(null); loadList();
  }

  if (err) return <div style={{ padding: 16 }}><ErrorState error={err} onRetry={loadList} /></div>;
  if (threads === null) return <div style={{ padding: 16 }}><Skeleton rows={4} height={72} /></div>;

  // ── thread view ────────────────────────────────────────────────────
  if (open) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: wide ? 'calc(100vh - 170px)' : 'calc(100vh - 150px)', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <button onClick={() => { setOpen(null); loadList(); }} style={{ background: 'transparent', border: 'none', color: T.accent, font: `700 14px ${FONT}`, cursor: 'pointer' }}>
            → رجوع
          </button>
          <div style={{ font: `700 14px ${FONT}`, color: T.ink }}>{open.buyer_name}</div>
        </div>

        {/* Device card pinned at the top (spec §9) */}
        {open.listing_id ? (
          <Card pad={11} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 42, height: 42, borderRadius: 9, background: T.chip, overflow: 'hidden', flexShrink: 0 }}>
                {open.listing_cover ? <img src={`${API_BASE}${open.listing_cover}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `600 13px ${FONT}`, color: T.ink, direction: 'ltr', textAlign: 'right' }}>{open.listing_label}</div>
                <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginTop: 2 }}>
                  {open.listing_price ? `${money(open.listing_price)} د.ع · ` : ''}
                  <span style={{ color: open.listing_status === 'sold' ? T.red : T.green }}>
                    {open.listing_status === 'sold' ? 'مباع' : 'متاح'}
                  </span>
                </div>
              </div>
              {advanced && open.listing_status !== 'sold' ? (
                <Btn kind="ghost" style={{ padding: '7px 11px', fontSize: 12 }} onClick={async () => {
                  const p = prompt('بكم انباع؟ (اختياري)', '');
                  if (p === null) return;
                  await shopApi(`/shop-admin/listings/${open.listing_id}/sold`, { method: 'POST', body: JSON.stringify({ sale_price: p ? Number(p) : null }) });
                  loadList(); setOpen(null);
                }}>انباع</Btn>
              ) : null}
            </div>
          </Card>
        ) : null}

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8 }}>
          {msgs.map((m) => {
            const mine = m.sender_id === shopId;
            return (
              <div key={m.id} style={{
                alignSelf: mine ? 'flex-start' : 'flex-end', maxWidth: '78%',
                background: mine ? T.accent : T.surface,
                border: mine ? 'none' : `1px solid ${T.line}`,
                borderRadius: 14, padding: '9px 12px',
                font: `400 13.5px ${FONT}`, color: mine ? '#fff' : T.ink,
              }}>
                {m.body}
                {m.image_path ? <img src={`${API_BASE}${m.image_path}`} alt="" style={{ maxWidth: 200, borderRadius: 10, display: 'block', marginTop: m.body ? 6 : 0 }} /> : null}
                <div style={{ font: `400 10px ${FONT}`, color: mine ? 'rgba(255,255,255,0.75)' : T.subtle, marginTop: 4 }}>
                  {agoAr(m.created_at)}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {advanced && quick.length ? (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
            {quick.map((qr) => (
              <button key={qr.id} onClick={() => setDraft(qr.text)} style={{
                whiteSpace: 'nowrap', background: T.chip, border: 'none', borderRadius: 999,
                padding: '7px 13px', font: `600 12px ${FONT}`, color: '#3A352D', cursor: 'pointer',
              }}>{qr.text}</button>
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, paddingBottom: 10 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="اكتب رداً…" style={inputStyle} />
          <Btn onClick={send} disabled={busy || !draft.trim()}>إرسال</Btn>
        </div>

        {advanced ? (
          <div style={{ display: 'flex', gap: 8, paddingBottom: 12, flexWrap: 'wrap' }}>
            <Btn kind="ghost" style={{ padding: '7px 11px', fontSize: 12 }}
              onClick={() => act(open.closed ? 'reopen' : 'close')}>
              {open.closed ? 'إعادة فتح' : 'إغلاق المحادثة'}
            </Btn>
            <Btn kind="ghost" style={{ padding: '7px 11px', fontSize: 12 }}
              onClick={async () => {
                const reason = prompt('سبب البلاغ:', '');
                if (reason === null) return;
                await shopApi(`/shop-admin/chats/${open.id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
                alert('وصل البلاغ للإدارة');
              }}>بلاغ</Btn>
            <Btn kind="danger" style={{ padding: '7px 11px', fontSize: 12 }}
              onClick={() => act('block', 'حظر هذا الزبون من مراسلة متجرك؟')}>حظر</Btn>
          </div>
        ) : null}
      </div>
    );
  }

  // ── inbox ──────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 16px' }}>
      {advanced ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <Chip label="الكل" on={filter === 'all'} onClick={() => setFilter('all')} />
          <Chip label="غير مقروء" on={filter === 'unread'} onClick={() => setFilter('unread')} />
          <Chip label="مغلق" on={filter === 'closed'} onClick={() => setFilter('closed')} />
          <input placeholder="ابحث بالجهاز أو الزبون…" value={q} onChange={(e) => setQ(e.target.value)}
            style={{ ...inputStyle, width: 220, marginInlineStart: 'auto' }} />
        </div>
      ) : null}

      {!threads.length ? (
        <EmptyState
          title="ما وصلتك رسائل بعد"
          body="محادثات الزبائن مع متجرك تظهر هنا — نفس المحادثات اللي بالتطبيق، وترد عليها من هنا مباشرة."
        />
      ) : threads.map((c) => (
        <button key={c.id} onClick={() => setOpen(c)} style={{
          display: 'flex', alignItems: 'center', gap: 11, width: '100%',
          background: T.surface, border: `1px solid ${c.unread ? T.accent : T.line}`,
          borderRadius: 16, padding: 12, marginBottom: 8, cursor: 'pointer', textAlign: 'right',
        }}>
          <div style={{ width: 42, height: 42, borderRadius: 9, background: T.chip, overflow: 'hidden', flexShrink: 0 }}>
            {c.listing_cover ? <img src={`${API_BASE}${c.listing_cover}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ font: `700 13.5px ${FONT}`, color: T.ink }}>{c.buyer_name}</span>
              {c.listing_label ? (
                <span style={{ font: `400 11.5px ${FONT}`, color: T.subtle, direction: 'ltr' }}>{c.listing_label}</span>
              ) : null}
              {c.closed ? <span style={{ font: `600 10.5px ${FONT}`, color: T.subtle }}>مغلق</span> : null}
            </div>
            <div style={{
              font: `400 12.5px ${FONT}`, color: c.unread ? T.ink : T.subtle, marginTop: 4,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{c.last_message || '…'}</div>
          </div>
          <div style={{ textAlign: 'left', flexShrink: 0 }}>
            <div style={{ font: `400 10.5px ${FONT}`, color: T.subtle }}>{agoAr(c.last_message_at)}</div>
            {c.unread ? <div style={{ width: 9, height: 9, borderRadius: 999, background: T.accent, marginTop: 6, marginInlineStart: 'auto' }} /> : null}
          </div>
        </button>
      ))}
    </div>
  );
}
