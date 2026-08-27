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
  verified?: boolean;
  featured_until?: number | null;
  verification?: { has_logo: boolean; gallery_count: number; has_location: boolean; request_status: string | null };
  feature_request_status?: { status: string; tier: string; created_at: number } | null;
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

// Desktop gets a different layout (design 1b "صباح المتجر"): the decisions
// column and the money/summary panel side by side, with the tabs as a top
// rail instead of a bottom bar. Phones keep 1a exactly.
function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return wide;
}

const todayAr = () =>
  new Date().toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' });

export function ShopPanelPage({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<'tasks' | 'orders' | 'devices' | 'chats'>('tasks');
  const [status, setStatus] = useState<string>('pending');
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const wide = useWide();

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
      <div style={{ flex: 1, maxWidth: wide ? 1240 : 560, width: '100%', margin: '0 auto', paddingBottom: wide ? 24 : 76, paddingTop: wide ? 56 : 0 }}>

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

        {view === 'devices' ? (
          <DevicesView />
        ) : view === 'chats' ? (
          <ChatsView shopId={me?.id} />
        ) : view === 'tasks' ? (
          <div style={wide ? { display: 'grid', gridTemplateColumns: '1fr 420px', gridTemplateAreas: '"money money" "growth decisions"', gap: 16, padding: '0 16px', alignItems: 'start', direction: 'rtl' } : undefined}>
            {/* ── Money strip ────────────────────────────────────── */}
            <div style={{ gridArea: wide ? 'money' : undefined, margin: wide ? 0 : '4px 16px 0', background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 16 }}>
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
            <div style={{ gridArea: wide ? 'decisions' : undefined, padding: wide ? 0 : '20px 16px 0' }}>
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
            <div style={{ gridArea: wide ? 'growth' : undefined }}>
              <GrowthPanel me={me} wide={wide} onReload={load} />
            </div>
          </div>
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
                  {(o.status === 'confirmed' || o.status === 'shipped') ? (
                    <button
                      onClick={async () => {
                        const courier = prompt('اسم المندوب / شركة التوصيل:', (o as any).courier || '');
                        if (courier == null) return;
                        try { await shopApi(`/shop-admin/orders/${o.id}/fulfilment`, { method: 'PATCH', body: JSON.stringify({ courier }) }); await load(); } catch {}
                      }}
                      style={{ marginTop: 10, background: 'transparent', border: `1px dashed ${T.line}`, borderRadius: 10, padding: '8px 12px', font: `400 12px ${FONT}`, color: T.subtle, cursor: 'pointer', width: '100%' }}
                    >
                      {(o as any).courier ? `المندوب: ${(o as any).courier} — تعديل` : '+ اسم المندوب / التوصيل'}
                    </button>
                  ) : null}
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
      <div style={wide ? {
        position: 'fixed', left: 0, right: 0, top: 0, zIndex: 5,
        display: 'flex', justifyContent: 'center', gap: 4,
        background: T.card, borderBottom: `1px solid ${T.line}`, padding: '0 16px',
      } : {
        position: 'fixed', left: 0, right: 0, bottom: 0,
        display: 'flex', background: T.card, borderTop: `1px solid ${T.line}`,
        maxWidth: 560, margin: '0 auto',
      }}>
        <FooterTab label="المهام" on={view === 'tasks'} onClick={() => setView('tasks')} />
        <FooterTab label={`الطلبات${counts.pending ? ` (${arNum(counts.pending)})` : ''}`} on={view === 'orders'} onClick={() => setView('orders')} />
        <FooterTab label="الأجهزة" on={view === 'devices'} onClick={() => setView('devices')} />
        <FooterTab label="المحادثات" on={view === 'chats'} onClick={() => setView('chats')} />
      </div>
    </div>
  );
}

// ─── Growth panel — top-10 demand, ميّز متجري, توثيق ─────────────────
// Sits beside the decisions column on desktop and below it on phones. All
// three answer "how do I get more customers", which is the question a
// merchant asks the moment today's orders are handled.
function GrowthPanel({ me, wide, onReload }: { me: Me | null; wide: boolean; onReload: () => void }) {
  const [top, setTop] = useState<{ brand: string; model: string; views: number; contacts: number }[]>([]);
  const [cfg, setCfg] = useState<any | null>(null);
  const [tier, setTier] = useState('week');
  const [carrier, setCarrier] = useState('asiacell');
  const [sender, setSender] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [featOpen, setFeatOpen] = useState(false);

  useEffect(() => {
    shopApi<any[]>('/shop-admin/top-devices').then(setTop).catch(() => {});
    shopApi<any>('/shop-admin/feature-config').then(setCfg).catch(() => {});
  }, []);

  const v = me?.verification;
  const ready = !!(v?.has_logo && (v?.gallery_count ?? 0) >= 3 && v?.has_location);
  const featPending = me?.feature_request_status?.status === 'pending';
  const featured = !!(me?.featured_until && me.featured_until > Date.now());

  async function uploadLogo(f: File) {
    const fd = new FormData(); fd.append('image', f);
    await fetch(`${API_BASE}/shop-admin/logo`, { method: 'POST', headers: { authorization: `Bearer ${getShopToken()}` }, body: fd });
    onReload();
  }
  async function pinLocation() {
    if (!navigator.geolocation) { setMsg('المتصفح ما يدعم تحديد الموقع'); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await shopApi('/shop-admin/location', { method: 'POST', body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }) });
        setMsg('تم حفظ موقع المتجر ✓'); onReload();
      } catch (e: any) { setMsg(`خطأ: ${e.message}`); }
    }, () => setMsg('تعذّر تحديد الموقع — فعّل الإذن بالمتصفح'));
  }
  async function requestVerification() {
    setBusy(true); setMsg('');
    try { await shopApi('/shop-admin/verification-request', { method: 'POST', body: '{}' }); setMsg('أُرسل طلب التوثيق ✓'); onReload(); }
    catch (e: any) {
      const mi = e?.data?.missing;
      setMsg(mi ? `ناقص: ${mi.map((x: string) => ({ logo: 'شعار', gallery: '٣ صور', location: 'الموقع' } as any)[x] || x).join(' · ')}` : `خطأ: ${e.message}`);
    }
    finally { setBusy(false); }
  }
  async function requestFeature() {
    setBusy(true); setMsg('');
    try {
      const body: any = { tier, carrier };
      if (carrier === 'qicard') body.sender_name = sender; else body.sender_phone = sender;
      await shopApi('/shop-admin/feature-request', { method: 'POST', body: JSON.stringify(body) });
      setMsg('أُرسل طلب التمييز — يُفعّل بعد تأكيد وصول المبلغ ✓');
      setFeatOpen(false); onReload();
    } catch (e: any) {
      const map: Record<string, string> = {
        request_pending: 'عندك طلب قيد المراجعة.',
        bad_sender_prefix: 'الرقم لا يطابق الشبكة المختارة.',
        bad_sender_name: 'اكتب اسم صاحب حساب Qi.',
        bad_sender_phone: 'أدخل الرقم الذي ستحوّل منه.',
      };
      setMsg(map[e?.data?.error] || `خطأ: ${e.message}`);
    }
    finally { setBusy(false); }
  }

  const card: React.CSSProperties = {
    background: T.card, border: `1px solid ${T.line}`, borderRadius: 18,
    padding: 16, margin: wide ? '0 0 12px' : '0 16px 12px',
  };
  const input: React.CSSProperties = {
    background: T.inset, border: `1px solid ${T.line}`, borderRadius: 10,
    padding: '9px 11px', font: `400 13px ${FONT}`, color: T.ink, outline: 'none', width: '100%', boxSizing: 'border-box',
  };
  const selectedTier = (cfg?.tiers || []).find((t2: any) => t2.key === tier);
  const ussd = cfg && carrier !== 'qicard' && selectedTier
    ? (cfg.ussd_templates?.[carrier] || '').replace('{amount}', String(selectedTier.amount)).replace('{number}', cfg.transfer_numbers?.[carrier] || '')
    : null;

  return (
    <div style={{ marginTop: wide ? 0 : 18 }}>
      {msg ? <div style={{ ...card, color: msg.startsWith('خطأ') || msg.startsWith('ناقص') ? T.red : T.green, fontSize: 13 }}>{msg}</div> : null}

      {/* Top-10 demand across the whole marketplace */}
      <div style={card}>
        <div style={{ font: `700 14px ${FONT}`, color: T.ink }}>الأكثر طلباً بالعراق</div>
        <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, margin: '4px 0 10px' }}>
          آخر ٣٠ يوم — من كل إعلانات التطبيق، الاتصال يُحتسب أقوى من المشاهدة.
        </div>
        {top.length ? top.map((d, i) => (
          <div key={`${d.brand}-${d.model}`} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
            borderTop: i ? `1px solid ${T.line}` : 'none',
          }}>
            <span style={{ font: `700 12px ${FONT}`, color: i < 3 ? T.accent : T.faint, minWidth: 18 }}>{arNum(i + 1)}</span>
            <span style={{ flex: 1, font: `600 13px ${FONT}`, color: T.ink, direction: 'ltr', textAlign: 'right' }}>{d.brand} {d.model}</span>
            <span style={{ font: `400 11.5px ${FONT}`, color: T.subtle }}>
              {arNum(d.contacts)} تواصل · {arNum(d.views)} مشاهدة
            </span>
          </div>
        )) : <div style={{ font: `400 12.5px ${FONT}`, color: T.faint }}>لا بيانات كافية بعد.</div>}
      </div>

      {/* ميّز متجري */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ font: `700 14px ${FONT}`, color: T.ink }}>ميّز متجري ✨</div>
          {featured ? (
            <span style={{ font: `600 11.5px ${FONT}`, color: T.green }}>
              مميّز حتى {new Date(me!.featured_until!).toLocaleDateString('ar-IQ')}
            </span>
          ) : featPending ? (
            <span style={{ font: `600 11.5px ${FONT}`, color: T.amber }}>قيد المراجعة</span>
          ) : null}
        </div>
        <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, margin: '5px 0 10px' }}>
          متجرك يطلع بأول دليل المتاجر مع شارة «مميّز» — يعني مشاهدات أكثر واتصالات أكثر.
        </div>
        {!featured && !featPending ? (
          !featOpen ? (
            <button onClick={() => setFeatOpen(true)} style={{ background: T.accent, border: 'none', borderRadius: 12, padding: '11px 18px', font: `700 13px ${FONT}`, color: '#fff', cursor: 'pointer' }}>
              اطلب التمييز
            </button>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(cfg?.tiers || []).map((t2: any) => (
                  <button key={t2.key} onClick={() => setTier(t2.key)} style={{
                    flex: 1, minWidth: 92, borderRadius: 12, padding: '10px 8px', cursor: 'pointer',
                    background: tier === t2.key ? T.accent : T.inset,
                    border: `1px solid ${tier === t2.key ? T.accent : T.line}`,
                    font: `700 12.5px ${FONT}`, color: tier === t2.key ? '#fff' : T.ink,
                  }}>
                    {t2.label_ar}<br />
                    <span style={{ font: `400 11px ${FONT}`, opacity: 0.85 }}>{money(t2.amount)} د.ع</span>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(cfg?.carriers || []).map((c: string) => (
                  <button key={c} onClick={() => { setCarrier(c); setSender(''); }} style={{
                    flex: 1, borderRadius: 10, padding: '9px 6px', cursor: 'pointer',
                    background: carrier === c ? T.inset : 'transparent',
                    border: `1px solid ${carrier === c ? T.accent : T.line}`,
                    font: `600 12px ${FONT}`, color: T.ink,
                  }}>{c === 'asiacell' ? 'آسياسيل' : c === 'korek' ? 'كورك' : 'كي كارد'}</button>
                ))}
              </div>
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder={carrier === 'qicard' ? 'اسم صاحب حساب Qi' : (carrier === 'korek' ? '0750XXXXXXX' : '0770XXXXXXX')}
                style={input}
              />
              {carrier === 'qicard' && cfg?.qi_card ? (
                <div style={{ background: T.inset, borderRadius: 10, padding: 10, font: `400 12px ${FONT}`, color: T.subtle }}>
                  حوّل {money(selectedTier?.amount || 0)} د.ع إلى حساب Qi:{' '}
                  <span style={{ fontFamily: 'ui-monospace, monospace', color: T.ink }}>{cfg.qi_card.account}</span> — {cfg.qi_card.name}
                </div>
              ) : ussd ? (
                <div style={{ background: T.inset, borderRadius: 10, padding: 10, font: `400 12px ${FONT}`, color: T.subtle }}>
                  حوّل الرصيد بالرمز: <span style={{ fontFamily: 'ui-monospace, monospace', color: T.ink, direction: 'ltr', display: 'inline-block' }}>{ussd}</span>
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy || !sender.trim()} onClick={requestFeature} style={{ flex: 1, background: T.accent, border: 'none', borderRadius: 12, padding: '11px 0', font: `700 13px ${FONT}`, color: '#fff', cursor: 'pointer', opacity: busy || !sender.trim() ? 0.6 : 1 }}>
                  حوّلت — أرسل الطلب
                </button>
                <button onClick={() => setFeatOpen(false)} style={{ background: 'transparent', border: `1px solid ${T.line}`, borderRadius: 12, padding: '11px 16px', font: `700 13px ${FONT}`, color: T.subtle, cursor: 'pointer' }}>إلغاء</button>
              </div>
            </div>
          )
        ) : null}
      </div>

      {/* توثيق المتجر */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ font: `700 14px ${FONT}`, color: T.ink }}>توثيق المتجر ✔️</div>
          {me?.verified ? <span style={{ font: `600 11.5px ${FONT}`, color: T.green }}>موثّق</span>
            : v?.request_status === 'pending' ? <span style={{ font: `600 11.5px ${FONT}`, color: T.amber }}>قيد المراجعة</span>
            : null}
        </div>
        {!me?.verified ? (
          <>
            <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, margin: '5px 0 10px' }}>
              الشارة تزيد ثقة الزبون. المطلوب: شعار المتجر، ٣ صور على الأقل، وموقعك على الخريطة.
            </div>
            <Req ok={!!v?.has_logo} label="شعار المتجر" action={
              <label style={{ font: `700 12px ${FONT}`, color: T.accent, cursor: 'pointer' }}>
                رفع
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
              </label>
            } />
            <Req ok={(v?.gallery_count ?? 0) >= 3} label={`صور المتجر (${arNum(v?.gallery_count ?? 0)}/٣)`} hint="من تبويب الأجهزة ← قائمة الأسعار" />
            <Req ok={!!v?.has_location} label="موقع المتجر" action={
              <button onClick={pinLocation} style={{ background: 'transparent', border: 'none', font: `700 12px ${FONT}`, color: T.accent, cursor: 'pointer' }}>
                حدّد موقعي
              </button>
            } />
            {v?.request_status !== 'pending' ? (
              <button disabled={busy || !ready} onClick={requestVerification} style={{
                marginTop: 10, width: '100%', borderRadius: 12, padding: '11px 0', cursor: ready ? 'pointer' : 'not-allowed',
                background: ready ? T.accent : T.inset, border: 'none',
                font: `700 13px ${FONT}`, color: ready ? '#fff' : T.faint,
              }}>اطلب التوثيق</button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Req({ ok, label, hint, action }: { ok: boolean; label: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0' }}>
      <span style={{
        width: 18, height: 18, borderRadius: 999, flexShrink: 0,
        background: ok ? T.green : 'transparent', border: ok ? 'none' : `1.5px solid ${T.line}`,
        display: 'grid', placeItems: 'center', font: '700 11px system-ui', color: '#fff',
      }}>{ok ? '✓' : ''}</span>
      <span style={{ flex: 1, font: `400 12.5px ${FONT}`, color: ok ? T.subtle : T.ink }}>
        {label}{hint && !ok ? <span style={{ color: T.faint }}> — {hint}</span> : null}
      </span>
      {!ok && action ? action : null}
    </div>
  );
}

// ─── الأجهزة — inventory, add device, Excel import, price-list images ──
type PanelListing = {
  id: number; brand: string; model: string; storage?: string | null;
  color?: string | null; asking_price: number; status: string;
  price_on_request?: number; stock_qty?: number | null; cover?: string | null;
};

function DevicesView() {
  const [rows, setRows] = useState<PanelListing[]>([]);
  const [gallery, setGallery] = useState<{ id: number; image_path: string }[]>([]);
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ brand: '', model: '', storage: '', color: '', asking_price: '', stock_qty: '', condition: 'new' });
  const [xlsFile, setXlsFile] = useState<File | null>(null);
  const [xlsPreview, setXlsPreview] = useState<any | null>(null);
  const [pricesOnly, setPricesOnly] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, g] = await Promise.all([
        shopApi<PanelListing[]>('/shop-admin/listings'),
        shopApi<{ id: number; image_path: string }[]>('/shop-admin/shop-images'),
      ]);
      setRows(l); setGallery(g);
    } catch (e: any) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = rows.filter((r) =>
    !q.trim() || `${r.brand} ${r.model}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function addDevice(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      await shopApi('/shop-admin/listings', { method: 'POST', body: JSON.stringify({
        ...form,
        asking_price: form.asking_price ? Number(form.asking_price) : undefined,
        stock_qty: form.stock_qty ? Number(form.stock_qty) : undefined,
      }) });
      setForm({ brand: '', model: '', storage: '', color: '', asking_price: '', stock_qty: '', condition: 'new' });
      setAddOpen(false); await load();
      setMsg('تمت إضافة الجهاز ✓');
    } catch (e2: any) { setMsg(`خطأ: ${e2?.data?.error || e2.message}`); }
    finally { setBusy(false); }
  }

  async function editPrice(r: PanelListing) {
    const v = prompt(`سعر ${r.brand} ${r.model} (603 تعني 603,000):`, r.price_on_request ? '' : String(r.asking_price));
    if (v == null || !v.trim()) return;
    try { await shopApi(`/shop-admin/listings/${r.id}`, { method: 'PATCH', body: JSON.stringify({ asking_price: Number(v) }) }); await load(); }
    catch (e: any) { alert(e?.data?.error === 'price_too_low' ? 'لا نقبل سعراً أقل من 100,000' : (e.message || 'فشل')); }
  }
  async function editStock(r: PanelListing) {
    const v = prompt(`كمية ${r.brand} ${r.model} بالمخزن:`, r.stock_qty == null ? '' : String(r.stock_qty));
    if (v == null || !v.trim()) return;
    try { await shopApi(`/shop-admin/listings/${r.id}`, { method: 'PATCH', body: JSON.stringify({ stock_qty: Number(v) }) }); await load(); } catch {}
  }
  async function removeListing(r: PanelListing) {
    if (!confirm(`إزالة ${r.brand} ${r.model} من المتجر؟`)) return;
    try { await shopApi(`/shop-admin/listings/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'removed' }) }); await load(); } catch {}
  }
  async function uploadListingImage(r: PanelListing, f: File) {
    const fd = new FormData();
    fd.append('image', f);
    const token = getShopToken();
    await fetch(`${API_BASE}/shop-admin/listings/${r.id}/images`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
    await load();
  }
  async function uploadGallery(f: File) {
    const fd = new FormData();
    fd.append('image', f);
    const token = getShopToken();
    await fetch(`${API_BASE}/shop-admin/shop-images`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
    await load();
  }
  async function sendSheet(dry: boolean) {
    if (!xlsFile) return;
    setBusy(true); setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', xlsFile);
      const token = getShopToken();
      const q2 = `?${dry ? 'dry=1&' : ''}${pricesOnly ? 'prices_only=1' : ''}`;
      const res = await fetch(`${API_BASE}/shop-admin/import-excel${q2}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'failed');
      if (dry) setXlsPreview(d);
      else {
        setXlsPreview(null); setXlsFile(null); await load();
        setMsg(`تم: ${d.updated} سعر محدّث · ${d.created} جهاز جديد (${d.preorders} بدون سعر)`);
      }
    } catch (e: any) { setMsg(`خطأ: ${e.message}`); }
    finally { setBusy(false); }
  }

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 14, margin: '0 16px 10px' };
  const input: React.CSSProperties = { background: T.inset, border: `1px solid ${T.line}`, borderRadius: 10, padding: '9px 11px', font: `400 13px ${FONT}`, color: T.ink, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const AR_ACTION: Record<string, string> = {
    update_price: 'تحديث سعر', create: 'جديد', create_preorder: 'جديد بدون سعر',
    unchanged: 'بدون تغيير', noop: 'بدون تغيير', skip_priceless: 'تجاهل', no_match: 'غير موجود',
  };

  return (
    <div style={{ paddingTop: 6 }}>
      {msg ? <div style={{ ...card, color: msg.startsWith('خطأ') ? T.red : T.green, fontSize: 13 }}>{msg}</div> : null}

      {/* Add device */}
      <div style={card}>
        <button onClick={() => setAddOpen(!addOpen)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: `700 14px ${FONT}`, color: T.accent, padding: 0 }}>
          {addOpen ? '− إغلاق' : '+ أضف جهازاً'}
        </button>
        {addOpen ? (
          <form onSubmit={addDevice} style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input placeholder="الماركة *" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} style={input} required />
            <input placeholder="الموديل *" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} style={input} required />
            <input placeholder="السعة (256GB)" value={form.storage} onChange={(e) => setForm({ ...form, storage: e.target.value })} style={input} />
            <input placeholder="اللون" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={input} />
            <input placeholder="السعر (فارغ = اتصل للسعر)" value={form.asking_price} onChange={(e) => setForm({ ...form, asking_price: e.target.value })} style={input} inputMode="numeric" />
            <input placeholder="الكمية بالمخزن" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} style={input} inputMode="numeric" />
            <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={{ ...input, gridColumn: '1 / -1' }}>
              <option value="new">جديد</option><option value="used">مستعمل</option><option value="refurbished">مجدد</option>
            </select>
            <button disabled={busy} style={{ gridColumn: '1 / -1', background: T.accent, border: 'none', borderRadius: 10, padding: '11px 0', font: `700 13px ${FONT}`, color: '#fff', cursor: 'pointer' }}>إضافة</button>
          </form>
        ) : null}
      </div>

      {/* Excel import */}
      <div style={card}>
        <div style={{ font: `700 14px ${FONT}`, color: T.ink, marginBottom: 6 }}>استيراد Excel</div>
        <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginBottom: 10 }}>
          الأعمدة: الماركة، الموديل، السعة، اللون، السعر. سطر بدون سعر = «اتصل للسعر». «603» تعني 603,000.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => { setXlsFile(e.target.files?.[0] || null); setXlsPreview(null); }} style={{ color: T.subtle, fontSize: 12 }} />
          <label style={{ display: 'flex', gap: 5, alignItems: 'center', font: `400 12px ${FONT}`, color: T.subtle }}>
            <input type="checkbox" checked={pricesOnly} onChange={(e) => { setPricesOnly(e.target.checked); setXlsPreview(null); }} />
            الأسعار فقط
          </label>
          <button disabled={!xlsFile || busy} onClick={() => sendSheet(true)} style={{ background: T.inset, border: `1px solid ${T.line}`, borderRadius: 10, padding: '8px 14px', font: `700 12.5px ${FONT}`, color: T.ink, cursor: 'pointer' }}>معاينة</button>
          {xlsPreview ? (
            <button disabled={busy} onClick={() => sendSheet(false)} style={{ background: T.accent, border: 'none', borderRadius: 10, padding: '8px 14px', font: `700 12.5px ${FONT}`, color: '#fff', cursor: 'pointer' }}>تنفيذ</button>
          ) : null}
        </div>
        {xlsPreview ? (
          <div style={{ marginTop: 10, maxHeight: 220, overflowY: 'auto', font: `400 12px ${FONT}`, color: T.subtle }}>
            {(xlsPreview.rows || []).map((r2: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${T.line}` }}>
                <span style={{ color: T.ink }}>{r2.brand} {r2.model}{r2.storage ? ` · ${r2.storage}` : ''}</span>
                <span>{AR_ACTION[r2.action] || r2.action}{r2.preorder ? '' : ` · ${money(r2.price)}`}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Price-list gallery */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ font: `700 14px ${FONT}`, color: T.ink }}>قائمة الأسعار (صور)</div>
          <label style={{ font: `700 12.5px ${FONT}`, color: T.accent, cursor: 'pointer' }}>
            + أضف صورة
            <input type="file" accept="image/*" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadGallery(f); e.target.value = ''; }} />
          </label>
        </div>
        {gallery.length ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {gallery.map((g) => (
              <div key={g.id} style={{ position: 'relative' }}>
                <img src={`${API_BASE}${g.image_path}`} alt="" style={{ width: 74, height: 92, objectFit: 'cover', borderRadius: 10, border: `1px solid ${T.line}` }} />
                <button onClick={async () => { if (confirm('حذف الصورة؟')) { await shopApi(`/shop-admin/shop-images/${g.id}`, { method: 'DELETE' }); load(); } }}
                  style={{ position: 'absolute', top: -6, left: -6, width: 20, height: 20, borderRadius: 999, background: T.red, border: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: '20px', padding: 0 }}>×</button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ font: `400 12px ${FONT}`, color: T.faint }}>الزبون يشوف صور قائمة أسعارك على صفحة متجرك بالتطبيق.</div>
        )}
      </div>

      {/* Inventory list */}
      <div style={{ margin: '0 16px 8px' }}>
        <input placeholder="ابحث في أجهزتك…" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
      </div>
      {visible.map((r) => (
        <div key={r.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 46, height: 46, borderRadius: 10, background: T.inset, overflow: 'hidden', flexShrink: 0 }}>
            {r.cover ? <img src={`${API_BASE}${r.cover}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `600 13.5px ${FONT}`, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', textAlign: 'right' }}>
              {r.brand} {r.model}{r.storage ? ` · ${r.storage}` : ''}
            </div>
            <div style={{ font: `400 12px ${FONT}`, marginTop: 3, color: r.price_on_request ? T.amber : T.green }}>
              {r.price_on_request ? 'اتصل للسعر' : `${money(r.asking_price)} د.ع`}
              {r.stock_qty != null ? (
                <span style={{ color: r.stock_qty === 0 ? T.red : T.subtle }}> · مخزن {arNum(r.stock_qty)}</span>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <MiniBtn label="سعر" onClick={() => editPrice(r)} />
            <MiniBtn label="كمية" onClick={() => editStock(r)} />
            <label style={{ font: `600 11.5px ${FONT}`, color: T.subtle, border: `1px solid ${T.line}`, borderRadius: 8, padding: '6px 9px', cursor: 'pointer' }}>
              صورة
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadListingImage(r, f); e.target.value = ''; }} />
            </label>
            <MiniBtn label="×" danger onClick={() => removeListing(r)} />
          </div>
        </div>
      ))}
      {!visible.length ? <div style={{ margin: '0 16px', font: `400 13px ${FONT}`, color: T.faint }}>لا أجهزة.</div> : null}
    </div>
  );
}

function MiniBtn({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      font: `600 11.5px ${FONT}`, color: danger ? T.red : T.subtle,
      background: 'transparent', border: `1px solid ${danger ? 'rgba(229,84,75,0.4)' : T.line}`,
      borderRadius: 8, padding: '6px 9px', cursor: 'pointer',
    }}>{label}</button>
  );
}

// ─── المحادثات — the app's chat pipeline, shop side ───────────────────
type PanelChat = {
  id: number; buyer_name: string; listing_label: string | null;
  last_message: string | null; last_message_at: number; unread: boolean;
};
type PanelMsg = { id: number; sender_id: number; body: string | null; image_path: string | null; created_at: number };

function ChatsView({ shopId }: { shopId?: number }) {
  const [chats, setChats] = useState<PanelChat[]>([]);
  const [open, setOpen] = useState<PanelChat | null>(null);
  const [msgs, setMsgs] = useState<PanelMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    try { setChats(await shopApi<PanelChat[]>('/shop-admin/chats')); } catch {}
  }, []);
  const loadThread = useCallback(async (id: number) => {
    try { setMsgs(await shopApi<PanelMsg[]>(`/shop-admin/chats/${id}/messages`)); } catch {}
  }, []);
  useEffect(() => { loadList(); const t = setInterval(loadList, 20000); return () => clearInterval(t); }, [loadList]);
  useEffect(() => {
    if (!open) return;
    loadThread(open.id);
    const t = setInterval(() => loadThread(open.id), 8000);
    return () => clearInterval(t);
  }, [open, loadThread]);

  async function send() {
    const body = draft.trim();
    if (!body || !open) return;
    setBusy(true);
    try { await shopApi(`/shop-admin/chats/${open.id}/messages`, { method: 'POST', body: JSON.stringify({ body }) }); setDraft(''); await loadThread(open.id); }
    catch {}
    setBusy(false);
  }

  if (open) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)' }}>
        <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => { setOpen(null); loadList(); }} style={{ background: 'transparent', border: 'none', color: T.accent, font: `700 14px ${FONT}`, cursor: 'pointer' }}>→ رجوع</button>
          <div style={{ font: `700 14px ${FONT}`, color: T.ink }}>{open.buyer_name}</div>
          {open.listing_label ? <div style={{ font: `400 12px ${FONT}`, color: T.faint }}>{open.listing_label}</div> : null}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {msgs.map((m) => {
            const mine = m.sender_id === shopId;
            return (
              <div key={m.id} style={{
                alignSelf: mine ? 'flex-start' : 'flex-end', maxWidth: '78%',
                background: mine ? T.accent : T.card, border: mine ? 'none' : `1px solid ${T.line}`,
                borderRadius: 14, padding: '9px 12px', font: `400 13.5px ${FONT}`, color: mine ? '#fff' : T.ink,
              }}>
                {m.body}
                {m.image_path ? <img src={`${API_BASE}${m.image_path}`} alt="" style={{ maxWidth: 180, borderRadius: 10, display: 'block', marginTop: m.body ? 6 : 0 }} /> : null}
                <div style={{ font: `400 10px ${FONT}`, color: mine ? 'rgba(255,255,255,0.7)' : T.faint, marginTop: 4 }}>{agoAr(m.created_at)}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="اكتب رداً…"
            style={{ flex: 1, background: T.inset, border: `1px solid ${T.line}`, borderRadius: 12, padding: '11px 13px', font: `400 13.5px ${FONT}`, color: T.ink, outline: 'none' }}
          />
          <button disabled={busy || !draft.trim()} onClick={send} style={{ background: T.accent, border: 'none', borderRadius: 12, padding: '0 18px', font: `700 13px ${FONT}`, color: '#fff', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>إرسال</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 6 }}>
      {chats.length === 0 ? (
        <div style={{ margin: '0 16px', background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, padding: 18, font: `400 13px ${FONT}`, color: T.subtle }}>
          محادثات الزبائن مع متجرك تظهر هنا — نفس المحادثات اللي بالتطبيق.
        </div>
      ) : chats.map((c) => (
        <button key={c.id} onClick={() => setOpen(c)} style={{
          display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 32px)',
          margin: '0 16px 8px', background: T.card, border: `1px solid ${c.unread ? 'rgba(228,100,63,0.5)' : T.line}`,
          borderRadius: 16, padding: 13, cursor: 'pointer', textAlign: 'right',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ font: `700 13.5px ${FONT}`, color: T.ink }}>{c.buyer_name}</span>
              {c.listing_label ? <span style={{ font: `400 11.5px ${FONT}`, color: T.faint }}>{c.listing_label}</span> : null}
            </div>
            <div style={{ font: `400 12.5px ${FONT}`, color: c.unread ? T.ink : T.subtle, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.last_message || '…'}
            </div>
          </div>
          <div style={{ textAlign: 'left', flexShrink: 0 }}>
            <div style={{ font: `400 10.5px ${FONT}`, color: T.faint }}>{agoAr(c.last_message_at)}</div>
            {c.unread ? <div style={{ width: 9, height: 9, borderRadius: 999, background: T.accent, marginTop: 6, marginInlineStart: 'auto' }} /> : null}
          </div>
        </button>
      ))}
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
