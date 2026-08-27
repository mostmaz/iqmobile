// لوحة التاجر — merchant panel, direction 1a "الشيفت" from the design
// project (IQ Mobile Shop Dashboard — Directions). Phone-first, dark admin
// tokens. Structure: money strip on top (delivered-today cash vs recorded,
// with a delivered/in-flight/refused mix bar), then ONLY decisions —
// طلبات بانتظار الاتصال (call-the-oldest CTA), نفد المخزون والإعلان شغّال,
// محادثات بلا رد — and a two-tab footer: المهام (this screen) / الطلبات
// (the fulfilment board). Every number is live from /shop-admin/me.

import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../api';

const TOKEN_KEY = 'iq_shop_token';
export const getShopToken = () => localStorage.getItem(TOKEN_KEY);
const setShopToken = (t: string | null) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

async function shopApi<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  const token = getShopToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err: any = new Error(data?.error || `http_${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

// ── Design 1a tokens ────────────────────────────────────────────────
const T = {
  bg: '#131316', card: '#1C1C21', inset: '#25252C',
  line: 'rgba(255,255,255,0.09)',
  ink: '#F2F2F4', subtle: '#9B9BA6', faint: '#6C6C78',
  accent: '#E4643F', green: '#4BAE8C', amber: '#D9A441', red: '#E5544B',
};
const FONT = "'IBM Plex Sans Arabic', system-ui, sans-serif";

const AR_D = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_D[+d]);
const money = (n: number) => Number(n || 0).toLocaleString('en-US');
const agoAr = (ms: number) => {
  const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return `منذ ${arNum(m)} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `منذ ${arNum(h)} ساعة`;
  return `منذ ${arNum(Math.round(h / 24))} يوم`;
};

type OrderItem = {
  id: number; brand: string; model: string; storage?: string | null;
  color?: string | null; qty: number; unit_price: number; line_total: number;
};
type Order = {
  id: number; code: string; status: string; total: number; shipping_fee: number;
  customer_name: string; customer_phone: string; governorate: string;
  address: string; note?: string | null; created_at: number; items: OrderItem[];
};
type Me = {
  id: number; name: string; active_listings: number;
  order_counts: Record<string, number>;
  today?: {
    delivered_total: number; delivered_count: number;
    recorded_total: number; recorded_count: number;
    cancelled_count: number; inflight_count: number;
  };
  pending_calls?: {
    count: number; oldest_order_id?: number; oldest_code?: string;
    oldest_phone?: string; oldest_governorate?: string; oldest_created_at?: number;
  };
  out_of_stock?: { count: number; models: string[] };
  unanswered_chats?: { count: number; oldest_minutes: number | null };
};

const STATUS_AR: Record<string, string> = {
  pending: 'جديد', confirmed: 'مؤكد', shipped: 'بالطريق',
  delivered: 'مُسلَّم', cancelled: 'ملغي',
};
const NEXT_ACTIONS: Record<string, { to: string; label: string; danger?: boolean }[]> = {
  pending: [{ to: 'confirmed', label: 'تأكيد الطلب' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  confirmed: [{ to: 'shipped', label: 'تم الشحن' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  shipped: [{ to: 'delivered', label: 'تم التسليم' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  delivered: [], cancelled: [],
};

const GOV_AR: Record<string, string> = {
  Baghdad: 'بغداد', Basra: 'البصرة', Nineveh: 'نينوى', Erbil: 'أربيل',
  Sulaymaniyah: 'السليمانية', Duhok: 'دهوك', Kirkuk: 'كركوك', Anbar: 'الأنبار',
  Babil: 'بابل', Karbala: 'كربلاء', Najaf: 'النجف', Wasit: 'واسط',
  Maysan: 'ميسان', 'Dhi Qar': 'ذي قار', Muthanna: 'المثنى', Qadisiyyah: 'القادسية',
  Diyala: 'ديالى', Saladin: 'صلاح الدين',
};
const govAr = (g?: string | null) => (g && GOV_AR[g]) || g || '';

const todayAr = () =>
  new Date().toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' });

export function ShopPanelPage({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<'tasks' | 'orders'>('tasks');
  const [status, setStatus] = useState<string>('pending');
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([
        shopApi<Me>('/shop-admin/me'),
        shopApi<Order[]>(`/shop-admin/orders${status ? `?status=${status}` : ''}`),
      ]);
      setMe(m); setOrders(o); setErr('');
    } catch (e: any) {
      if (e.status === 401) { setShopToken(null); onExit(); return; }
      setErr(e.message);
    }
  }, [status, onExit]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  async function move(o: Order, to: string) {
    if (to === 'cancelled' && !confirm(`إلغاء الطلب ${o.code}؟`)) return;
    setBusy(true);
    try { await shopApi(`/shop-admin/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: to }) }); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const counts = me?.order_counts || {};
  const today = me?.today;
  const pc = me?.pending_calls;
  const oos = me?.out_of_stock;
  const chats = me?.unanswered_chats;
  const decisions = (pc?.count || 0) + (oos?.count ? 1 : 0) + (chats?.count ? 1 : 0);

  // Mix bar: today's delivered vs in-flight vs today's cancellations.
  const mixTotal = (today?.delivered_count || 0) + (today?.inflight_count || 0) + (today?.cancelled_count || 0);
  // Zero stays zero; non-zero segments get a 4% floor so they stay visible.
  const pct = (n: number) => (!mixTotal || !n ? 0 : Math.max(4, Math.round((n / mixTotal) * 100)));

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: T.bg, fontFamily: FONT, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, maxWidth: 560, width: '100%', margin: '0 auto', paddingBottom: 76 }}>

        {/* ── Header ─────────────────────────────────────────────── */}
        <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ font: `700 19px ${FONT}`, color: T.ink }}>{me?.name || '…'}</div>
            <div style={{ font: `400 12px ${FONT}`, color: T.subtle, marginTop: 3 }}>{todayAr()}</div>
          </div>
          <button
            onClick={() => { setShopToken(null); onExit(); }}
            title="خروج"
            style={{
              width: 36, height: 36, borderRadius: 999, background: T.card,
              border: `1px solid ${T.line}`, display: 'grid', placeItems: 'center',
              font: `700 12px ${FONT}`, color: T.subtle, cursor: 'pointer',
            }}
          >iQ</button>
        </div>

        {err ? (
          <div style={{ margin: '4px 16px 0', background: T.card, border: `1px solid ${T.red}`, borderRadius: 18, padding: 12, color: T.red, fontSize: 13 }}>
            خطأ: {err}
          </div>
        ) : null}

        {view === 'tasks' ? (
          <>
            {/* ── Money strip ────────────────────────────────────── */}
            <div style={{ margin: '4px 16px 0', background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ font: `400 12px ${FONT}`, color: T.subtle }}>مُسلّم اليوم — نقد بالجيب</div>
                  <div style={{ font: `700 30px/1.1 ${FONT}`, color: T.green, marginTop: 4, letterSpacing: '-0.5px' }}>
                    {money(today?.delivered_total || 0)}
                  </div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ font: `400 12px ${FONT}`, color: T.subtle }}>مُسجّل</div>
                  <div style={{ font: `600 17px ${FONT}`, color: T.ink, marginTop: 4 }}>
                    {money(today?.recorded_total || 0)}
                  </div>
                </div>
              </div>
              {mixTotal > 0 ? (
                <>
                  <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', marginTop: 14, background: T.inset }}>
                    <div style={{ width: `${pct(today!.delivered_count)}%`, background: T.green }} />
                    <div style={{ width: `${pct(today!.inflight_count)}%`, background: T.amber }} />
                    <div style={{ width: `${pct(today!.cancelled_count)}%`, background: T.red }} />
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 9, font: `400 11.5px ${FONT}`, color: T.subtle }}>
                    <Legend color={T.green} label={`${arNum(today!.delivered_count)} مُسلّم`} />
                    <Legend color={T.amber} label={`${arNum(today!.inflight_count)} بالطريق`} />
                    <Legend color={T.red} label={`${arNum(today!.cancelled_count)} ملغي اليوم`} />
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 12, font: `400 12px ${FONT}`, color: T.faint }}>
                  لا حركة طلبات اليوم بعد.
                </div>
              )}
            </div>

            {/* ── Decisions ──────────────────────────────────────── */}
            <div style={{ padding: '20px 16px 0' }}>
              <div style={{ font: `700 12.5px ${FONT}`, color: T.faint, marginBottom: 9 }}>
                قرارات الآن{decisions ? ` · ${arNum(decisions)}` : ''}
              </div>

              {pc?.count ? (
                <DecisionCard
                  count={pc.count}
                  countBg={T.accent}
                  border="rgba(228,100,63,0.42)"
                  title="طلبات بانتظار الاتصال"
                  sub={pc.oldest_created_at ? `أقدمها ${agoAr(pc.oldest_created_at)} — ${govAr(pc.oldest_governorate)}` : ''}
                  actions={[
                    { label: 'اتصل بالأول', primary: true, onClick: () => { if (pc.oldest_phone) window.location.href = `tel:${pc.oldest_phone}`; } },
                    { label: 'القائمة', onClick: () => { setStatus('pending'); setView('orders'); } },
                  ]}
                />
              ) : null}

              {oos?.count ? (
                <DecisionCard
                  count={oos.count}
                  countBg={T.red}
                  border="rgba(229,84,75,0.42)"
                  title="نفد المخزون والإعلان شغّال"
                  sub={oos.models.join(' · ')}
                />
              ) : null}

              {chats?.count ? (
                <DecisionCard
                  count={chats.count}
                  countBg={T.amber}
                  border={T.line}
                  title="محادثات بلا رد"
                  sub={chats.oldest_minutes != null
                    ? (chats.oldest_minutes >= 60 ? `أطولها ${arNum(Math.round(chats.oldest_minutes / 60))} ساعة` : `أطولها ${arNum(chats.oldest_minutes)} دقيقة`)
                    : ''}
                />
              ) : null}

              {!decisions ? (
                <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 22, textAlign: 'center' }}>
                  <div style={{ font: `600 15px ${FONT}`, color: T.ink }}>ما عليك شي هسه ✓</div>
                  <div style={{ font: `400 12.5px ${FONT}`, color: T.subtle, marginTop: 5 }}>
                    الطلبات الجديدة والمحادثات تظهر هنا أول ما توصل.
                  </div>
                </div>
              ) : null}

              <div style={{ font: `400 12px ${FONT}`, color: T.faint, margin: '14px 2px 6px' }}>
                {arNum(me?.active_listings ?? 0)} جهاز معروض حالياً.
              </div>
            </div>
          </>
        ) : (
          <>
            {/* ── Orders board ───────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 16px 2px' }}>
              {Object.keys(STATUS_AR).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatus(st)}
                  style={{
                    padding: '8px 13px', borderRadius: 999, cursor: 'pointer',
                    background: status === st ? T.accent : T.card,
                    border: `1px solid ${status === st ? T.accent : T.line}`,
                    font: `600 12.5px ${FONT}`,
                    color: status === st ? '#fff' : T.subtle,
                  }}
                >
                  {STATUS_AR[st]}{counts[st] ? ` ${arNum(counts[st])}` : ''}
                </button>
              ))}
            </div>

            <div style={{ padding: '10px 16px 0' }}>
              {orders.length === 0 ? (
                <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 20, color: T.subtle, fontSize: 13.5 }}>
                  لا توجد طلبات بحالة «{STATUS_AR[status]}».
                </div>
              ) : orders.map((o) => (
                <div key={o.id} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 14, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <strong style={{ font: `700 15px ${FONT}`, color: T.ink }}>{o.code}</strong>
                    <span style={{ font: `400 11.5px ${FONT}`, color: T.faint }}>{agoAr(o.created_at)}</span>
                  </div>
                  <div style={{ marginTop: 6, font: `400 13.5px ${FONT}`, color: T.ink }}>
                    {o.customer_name} · <a href={`tel:${o.customer_phone}`} style={{ color: T.accent, textDecoration: 'none' }}>{o.customer_phone}</a>
                  </div>
                  <div style={{ font: `400 12px ${FONT}`, color: T.subtle, marginTop: 2 }}>
                    {govAr(o.governorate)} — {o.address}{o.note ? ` · ${o.note}` : ''}
                  </div>
                  <div style={{ marginTop: 8, borderTop: `1px solid ${T.line}`, paddingTop: 8 }}>
                    {o.items.map((it) => (
                      <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', font: `400 12.5px ${FONT}`, color: T.ink, padding: '2px 0' }}>
                        <span>{it.brand} {it.model}{it.storage ? ` · ${it.storage}` : ''}{it.qty > 1 ? ` × ${arNum(it.qty)}` : ''}</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', color: T.subtle }}>{money(it.line_total)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', font: `700 13.5px ${FONT}`, color: T.ink, marginTop: 6 }}>
                      <span>المجموع (توصيل {money(o.shipping_fee)})</span>
                      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{money(o.total)} د.ع</span>
                    </div>
                  </div>
                  {NEXT_ACTIONS[o.status]?.length ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      {NEXT_ACTIONS[o.status].map((a) => (
                        <button
                          key={a.to}
                          disabled={busy}
                          onClick={() => move(o, a.to)}
                          style={{
                            flex: 1, padding: '11px 0', borderRadius: 12, cursor: 'pointer',
                            background: a.danger ? 'transparent' : T.accent,
                            border: a.danger ? `1.5px solid ${T.line}` : 'none',
                            font: `700 13px ${FONT}`,
                            color: a.danger ? T.subtle : '#fff',
                            opacity: busy ? 0.6 : 1,
                          }}
                        >{a.label}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Footer tabs ────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        display: 'flex', background: T.card, borderTop: `1px solid ${T.line}`,
        maxWidth: 560, margin: '0 auto',
      }}>
        <FooterTab label="المهام" on={view === 'tasks'} onClick={() => setView('tasks')} />
        <FooterTab label={`الطلبات${counts.pending ? ` (${arNum(counts.pending)})` : ''}`} on={view === 'orders'} onClick={() => setView('orders')} />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: color }} />{label}
    </span>
  );
}

function DecisionCard({ count, countBg, border, title, sub, actions }: {
  count: number; countBg: string; border: string; title: string; sub?: string;
  actions?: { label: string; primary?: boolean; onClick: () => void }[];
}) {
  return (
    <div style={{ background: T.card, border: `1px solid ${border}`, borderRadius: 18, padding: 16, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          minWidth: 44, height: 44, padding: '0 10px', borderRadius: 10, background: countBg,
          display: 'grid', placeItems: 'center', font: `700 17px ${FONT}`,
          color: countBg === T.amber ? '#1B1A18' : '#fff',
        }}>{arNum(count)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ font: `600 15px ${FONT}`, color: T.ink }}>{title}</div>
          {sub ? <div style={{ font: `400 12px ${FONT}`, color: T.subtle, marginTop: 3 }}>{sub}</div> : null}
        </div>
      </div>
      {actions?.length ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={a.onClick}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 12, cursor: 'pointer',
                background: a.primary ? T.accent : 'transparent',
                border: a.primary ? 'none' : `1.5px solid ${T.line}`,
                font: `700 13px ${FONT}`,
                color: a.primary ? '#fff' : T.subtle,
              }}
            >{a.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FooterTab({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '13px 0', textAlign: 'center', cursor: 'pointer',
        background: 'transparent', border: 'none',
        font: `600 13px ${FONT}`, color: on ? T.accent : T.faint,
      }}
    >{label}</button>
  );
}

// ── Login (dark, matching the panel) ────────────────────────────────
export function ShopLogin({ onAuth, onBack }: { onAuth: () => void; onBack: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await shopApi<{ token: string }>('/shop-admin/login', {
        method: 'POST', body: JSON.stringify({ username: username.trim(), password }),
      });
      setShopToken(r.token);
      onAuth();
    } catch (e2: any) {
      setErr(e2?.data?.error === 'bad_credentials' ? 'بيانات الدخول غير صحيحة.' : (e2.message || 'فشل الدخول'));
    } finally { setBusy(false); }
  }

  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', marginBottom: 8,
    background: T.inset, border: `1px solid ${T.line}`, borderRadius: 12,
    padding: '12px 14px', font: `400 14px ${FONT}`, color: T.ink, outline: 'none',
  };

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: T.bg, fontFamily: FONT, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380, background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: T.accent, display: 'grid', placeItems: 'center', font: '800 14px system-ui', color: '#fff' }}>iQ</div>
          <div style={{ font: `700 17px ${FONT}`, color: T.ink }}>دخول لوحة التاجر</div>
        </div>
        <form onSubmit={submit}>
          <input placeholder="اسم المستخدم" value={username} onChange={(e) => setUsername(e.target.value)} style={input} autoFocus />
          <input placeholder="كلمة المرور" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...input, marginBottom: 10 }} />
          {err ? <div style={{ color: T.red, fontSize: 13, marginBottom: 8 }}>{err}</div> : null}
          <button disabled={busy} style={{
            width: '100%', padding: '12px 0', borderRadius: 12, cursor: 'pointer',
            background: T.accent, border: 'none', font: `700 14px ${FONT}`, color: '#fff',
            opacity: busy ? 0.6 : 1,
          }}>دخول</button>
        </form>
        <button onClick={onBack} style={{
          marginTop: 12, background: 'transparent', border: 'none', cursor: 'pointer',
          font: `400 13px ${FONT}`, color: T.subtle,
        }}>→ لوحة الإدارة</button>
      </div>
    </div>
  );
}
