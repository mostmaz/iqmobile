// لوحة المتجر — the store dashboard shell.
//
// Structure follows the approved design: what the money actually did today,
// then only decisions, then the work (devices, orders, chat, growth).
// Palette and font are the marketplace's own (spec §14) so a shop owner
// recognises it from the app rather than learning an admin skin.
//
// Two tiers share this shell (spec §12): simple sees devices/orders/chat,
// advanced additionally sees bulk tooling, the desktop table, diagnostics,
// demand alerts and inbox filters. Nothing is taken away on upgrade.
import React, { useCallback, useEffect, useState } from 'react';
import {
  T, FONT, shopApi, setShopToken, arNum, money, agoAr, govAr,
  Card, SectionTitle, Btn, Chip, inputStyle, Skeleton, EmptyState, ErrorState, useWide,
} from './kit';
import { DevicesView } from './DevicesView';
import { ChatsView } from './ChatsView';
import { InsightsView } from './InsightsView';

type OrderItem = {
  id: number; brand: string; model: string; storage?: string | null;
  qty: number; line_total: number;
};
type Order = {
  id: number; code: string; status: string; total: number; shipping_fee: number;
  customer_name: string; customer_phone: string; governorate: string;
  address: string; note?: string | null; created_at: number; courier?: string | null;
  items: OrderItem[];
};

const STATUS_AR: Record<string, string> = {
  pending: 'جديد', confirmed: 'مؤكد', shipped: 'بالطريق', delivered: 'مُسلَّم', cancelled: 'ملغي',
};
const NEXT: Record<string, { to: string; label: string; danger?: boolean }[]> = {
  pending: [{ to: 'confirmed', label: 'تأكيد الطلب' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  confirmed: [{ to: 'shipped', label: 'تم الشحن' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  shipped: [{ to: 'delivered', label: 'تم التسليم' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  delivered: [], cancelled: [],
};
const todayAr = () => new Date().toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' });

type View = 'tasks' | 'devices' | 'orders' | 'chats' | 'insights';

export function ShopPanelPage({ onExit }: { onExit: () => void }) {
  const wide = useWide();
  const [me, setMe] = useState<any | null>(null);
  const [view, setView] = useState<View>('tasks');
  const [status, setStatus] = useState('pending');
  const [orders, setOrders] = useState<Order[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [nudgeOff, setNudgeOff] = useState(false);
  const [offerOff, setOfferOff] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [soldPrompt, setSoldPrompt] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([
        shopApi<any>('/shop-admin/me'),
        shopApi<Order[]>(`/shop-admin/orders?status=${status}`),
      ]);
      setMe(m); setOrders(o); setErr('');
    } catch (e: any) {
      if (e.status === 401) { setShopToken(null); onExit(); return; }
      setErr(e.message);
    }
  }, [status, onExit]);
  useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [load]);

  // The sold prompt (spec §10) is periodic and never blocking — loaded once
  // per session, dismissible per device.
  useEffect(() => {
    if (view === 'tasks' && soldPrompt === null) {
      shopApi<any[]>('/shop-admin/sold-prompt').then(setSoldPrompt).catch(() => setSoldPrompt([]));
    }
  }, [view, soldPrompt]);

  // The server decides whether an offer is due; the panel only records that
  // it was shown, so the 7-day cadence survives a refresh.
  useEffect(() => {
    if (me?.upgrade_offer?.state === 'available' && !offerOff) {
      shopApi('/shop-admin/offer-seen', { method: 'POST', body: '{}' }).catch(() => {});
    }
  }, [me?.upgrade_offer?.state, offerOff]);

  async function move(o: Order, to: string) {
    if (to === 'cancelled' && !window.confirm(`إلغاء الطلب ${o.code}؟`)) return;
    setBusy(true);
    try { await shopApi(`/shop-admin/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: to }) }); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const advanced = me?.tier === 'advanced';
  const counts = me?.order_counts || {};
  const today = me?.today;
  const pc = me?.pending_calls;
  const oos = me?.out_of_stock;
  const chats = me?.unanswered_chats;
  const decisions = (pc?.count || 0) + (oos?.count ? 1 : 0) + (chats?.count ? 1 : 0);
  const mixTotal = (today?.delivered_count || 0) + (today?.inflight_count || 0) + (today?.cancelled_count || 0);
  const pct = (n: number) => (!mixTotal || !n ? 0 : Math.max(4, Math.round((n / mixTotal) * 100)));

  const TABS: { key: View; label: string; badge?: number }[] = [
    { key: 'tasks', label: 'المهام' },
    { key: 'devices', label: 'الأجهزة' },
    { key: 'orders', label: 'الطلبات', badge: counts.pending },
    { key: 'chats', label: 'المحادثات', badge: me?.unread_threads },
    { key: 'insights', label: 'النمو' },
  ];

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: T.bg, fontFamily: FONT, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        flex: 1, width: '100%', maxWidth: wide ? 1240 : 640, margin: '0 auto',
        paddingBottom: wide ? 24 : 78, paddingTop: wide ? 54 : 0,
      }}>
        {/* ── header ─────────────────────────────────────────────── */}
        <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: `700 19px ${FONT}`, color: T.ink }}>{me?.name || '…'}</span>
              {me?.verified ? <span title="موثّق" style={{ fontSize: 12 }}>✔️</span> : null}
              {advanced ? (
                <span style={{ font: `700 10.5px ${FONT}`, color: T.deep, background: T.chip, borderRadius: 999, padding: '3px 9px' }}>
                  أدير متجري
                </span>
              ) : null}
            </div>
            <div style={{ font: `400 12px ${FONT}`, color: T.subtle, marginTop: 3 }}>{todayAr()}</div>
          </div>
          <Btn kind="ghost" style={{ padding: '8px 12px', fontSize: 12 }}
            onClick={() => { setShopToken(null); onExit(); }}>خروج</Btn>
        </div>

        {err ? <div style={{ padding: '0 16px' }}><ErrorState error={err} onRetry={load} /></div> : null}

        {/* Unread nudge (spec §9) — banner only, never a penalty. */}
        {!nudgeOff && (me?.unread_threads ?? 0) > 0 && view !== 'chats' ? (
          <div style={{ margin: '0 16px 10px', background: T.chip, borderRadius: 14, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, font: `600 12.5px ${FONT}`, color: '#3A352D' }}>
              عندك رسائل ما قريتها — الرد السريع يرفع ترتيب متجرك
            </span>
            <Btn kind="ghost" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setView('chats')}>افتح</Btn>
            <button onClick={() => setNudgeOff(true)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.subtle, fontSize: 16 }}>×</button>
          </div>
        ) : null}

        {/* Upgrade offer (spec §2) — in-context, dismissible, capability framing. */}
        {!offerOff && me?.upgrade_offer?.state === 'available' ? (
          <div style={{ margin: '0 16px 12px' }}>
            <Card style={{ borderColor: T.accent, marginBottom: 0 }}>
              <div style={{ font: `700 15px ${FONT}`, color: T.ink }}>قم بإدارة متجرك بصورة أفضل مجاناً</div>
              <div style={{ font: `400 12.5px ${FONT}`, color: T.subtle, marginTop: 6, lineHeight: 1.7 }}>
                {me.upgrade_offer.reason === 'listings'
                  ? 'عندك أجهزة كثيرة — تعديل الأسعار بالجملة، جدول على الكمبيوتر، وتنبيهات شنو يدور عليه الناس.'
                  : 'حركة متجرك زينة — افتح أدوات الإدارة: تعديل الأسعار بنقرة، وتنبيهات الطلب.'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Btn onClick={() => setReqOpen(true)}>اطلب الترقية</Btn>
                <Btn kind="ghost" onClick={async () => {
                  setOfferOff(true);
                  await shopApi('/shop-admin/offer-dismiss', { method: 'POST', body: '{}' }).catch(() => {});
                }}>بعدين</Btn>
              </div>
            </Card>
          </div>
        ) : null}
        {me?.upgrade_offer?.state === 'pending' ? (
          <div style={{ margin: '0 16px 12px', font: `600 12.5px ${FONT}`, color: T.deep }}>
            طلب الترقية قيد المراجعة — نراجع طلبك خلال ٢٤ ساعة.
          </div>
        ) : null}

        {reqOpen ? <UpgradeForm me={me} onClose={() => setReqOpen(false)} onDone={() => { setReqOpen(false); load(); }} /> : null}

        {/* ── views ──────────────────────────────────────────────── */}
        {!me ? <div style={{ padding: 16 }}><Skeleton rows={3} height={90} /></div>
          : view === 'devices' ? <DevicesView advanced={advanced} sellsNew={!!me.sells_new} />
            : view === 'chats' ? <ChatsView shopId={me.id} advanced={advanced} />
              : view === 'insights' ? <InsightsView me={me} advanced={advanced} onReload={load} />
                : view === 'orders' ? (
                  <div style={{ padding: '0 16px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      {Object.keys(STATUS_AR).map((st) => (
                        <Chip key={st} label={STATUS_AR[st]} count={counts[st]} on={status === st} onClick={() => setStatus(st)} />
                      ))}
                    </div>
                    {!orders.length ? (
                      <EmptyState title={`لا طلبات بحالة «${STATUS_AR[status]}»`} />
                    ) : orders.map((o) => (
                      <Card key={o.id} pad={14}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                          <strong style={{ font: `700 15px ${FONT}`, color: T.ink }}>{o.code}</strong>
                          <span style={{ font: `400 11.5px ${FONT}`, color: T.subtle }}>{agoAr(o.created_at)}</span>
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
                              <span style={{ direction: 'ltr' }}>{it.brand} {it.model}{it.storage ? ` · ${it.storage}` : ''}{it.qty > 1 ? ` × ${arNum(it.qty)}` : ''}</span>
                              <span style={{ fontFamily: 'ui-monospace, monospace', color: T.subtle }}>{money(it.line_total)}</span>
                            </div>
                          ))}
                          <div style={{ display: 'flex', justifyContent: 'space-between', font: `700 13.5px ${FONT}`, color: T.ink, marginTop: 6 }}>
                            <span>المجموع (توصيل {money(o.shipping_fee)})</span>
                            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{money(o.total)} د.ع</span>
                          </div>
                        </div>
                        {(o.status === 'confirmed' || o.status === 'shipped') ? (
                          <Btn kind="ghost" style={{ marginTop: 10, width: '100%', fontSize: 12 }}
                            onClick={async () => {
                              const c = prompt('اسم المندوب / شركة التوصيل:', o.courier || '');
                              if (c == null) return;
                              await shopApi(`/shop-admin/orders/${o.id}/fulfilment`, { method: 'PATCH', body: JSON.stringify({ courier: c }) });
                              load();
                            }}>{o.courier ? `المندوب: ${o.courier} — تعديل` : '+ اسم المندوب'}</Btn>
                        ) : null}
                        {NEXT[o.status]?.length ? (
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            {NEXT[o.status].map((a) => (
                              <Btn key={a.to} kind={a.danger ? 'ghost' : 'primary'} disabled={busy}
                                style={{ flex: 1 }} onClick={() => move(o, a.to)}>{a.label}</Btn>
                            ))}
                          </div>
                        ) : null}
                      </Card>
                    ))}
                  </div>
                ) : (
                  /* ── TASKS ──────────────────────────────────────── */
                  <div style={wide ? {
                    display: 'grid', gridTemplateColumns: '1fr 400px',
                    gridTemplateAreas: '"money money" "work decisions"',
                    gap: 16, padding: '0 16px', alignItems: 'start',
                  } : undefined}>
                    <div style={{ gridArea: wide ? 'money' : undefined, margin: wide ? 0 : '0 16px' }}>
                      <Card>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ font: `400 12px ${FONT}`, color: T.subtle }}>مُسلّم اليوم — نقد بالجيب</div>
                            <div style={{ font: `700 30px ${FONT}`, color: T.green, marginTop: 4 }}>
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
                            <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', marginTop: 14, background: T.chip }}>
                              <div style={{ width: `${pct(today.delivered_count)}%`, background: T.green }} />
                              <div style={{ width: `${pct(today.inflight_count)}%`, background: '#D9A441' }} />
                              <div style={{ width: `${pct(today.cancelled_count)}%`, background: T.red }} />
                            </div>
                            <div style={{ display: 'flex', gap: 14, marginTop: 9, font: `400 11.5px ${FONT}`, color: T.subtle }}>
                              <Legend c={T.green} l={`${arNum(today.delivered_count)} مُسلّم`} />
                              <Legend c="#D9A441" l={`${arNum(today.inflight_count)} بالطريق`} />
                              <Legend c={T.red} l={`${arNum(today.cancelled_count)} ملغي`} />
                            </div>
                          </>
                        ) : (
                          <div style={{ marginTop: 12, font: `400 12px ${FONT}`, color: T.subtle }}>لا حركة طلبات اليوم بعد.</div>
                        )}
                      </Card>
                    </div>

                    <div style={{ gridArea: wide ? 'decisions' : undefined, margin: wide ? 0 : '0 16px' }}>
                      <div style={{ font: `700 12.5px ${FONT}`, color: T.subtle, marginBottom: 9 }}>
                        قرارات الآن{decisions ? ` · ${arNum(decisions)}` : ''}
                      </div>
                      {pc?.count ? (
                        <Decision n={pc.count} tone={T.accent} title="طلبات بانتظار الاتصال"
                          sub={pc.oldest_created_at ? `أقدمها ${agoAr(pc.oldest_created_at)} — ${govAr(pc.oldest_governorate)}` : ''}
                          actions={[
                            { label: 'اتصل بالأول', primary: true, onClick: () => { if (pc.oldest_phone) window.location.href = `tel:${pc.oldest_phone}`; } },
                            { label: 'القائمة', onClick: () => { setStatus('pending'); setView('orders'); } },
                          ]} />
                      ) : null}
                      {oos?.count ? (
                        <Decision n={oos.count} tone={T.red} title="نفد المخزون والإعلان شغّال"
                          sub={oos.models.join(' · ')}
                          actions={[{ label: 'روح للأجهزة', onClick: () => setView('devices') }]} />
                      ) : null}
                      {chats?.count ? (
                        <Decision n={chats.count} tone="#D9A441" title="محادثات بلا رد"
                          sub={chats.oldest_minutes != null
                            ? (chats.oldest_minutes >= 60 ? `أطولها ${arNum(Math.round(chats.oldest_minutes / 60))} ساعة` : `أطولها ${arNum(chats.oldest_minutes)} دقيقة`)
                            : ''}
                          actions={[{ label: 'افتح المحادثات', primary: true, onClick: () => setView('chats') }]} />
                      ) : null}
                      {!decisions ? <EmptyState title="ما عليك شي هسه ✓" body="الطلبات والمحادثات الجديدة تظهر هنا أول ما توصل." /> : null}
                    </div>

                    <div style={{ gridArea: wide ? 'work' : undefined, margin: wide ? 0 : '12px 16px 0' }}>
                      {soldPrompt && soldPrompt.length ? (
                        <Card>
                          <SectionTitle>بعت شي من هذي؟</SectionTitle>
                          <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginBottom: 8 }}>
                            تعليم المباع يخلي متجرك صادق، ويساعدنا نعرف الأسعار الحقيقية بالسوق.
                          </div>
                          {soldPrompt.slice(0, 5).map((d: any) => (
                            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${T.line}` }}>
                              <span style={{ flex: 1, font: `600 12.5px ${FONT}`, color: T.ink, direction: 'ltr', textAlign: 'right' }}>
                                {d.brand} {d.model}{d.storage ? ` · ${d.storage}` : ''}{d.color ? ` · ${d.color}` : ''}
                              </span>
                              <Btn kind="ghost" style={{ padding: '6px 10px', fontSize: 11.5 }} onClick={async () => {
                                const p = prompt('بكم انباع؟ (اختياري)', String(d.asking_price || ''));
                                if (p === null) return;
                                await shopApi(`/shop-admin/listings/${d.id}/sold`, { method: 'POST', body: JSON.stringify({ sale_price: p ? Number(p) : null }) });
                                setSoldPrompt((s) => (s || []).filter((x: any) => x.id !== d.id));
                                load();
                              }}>بعته</Btn>
                              <Btn kind="ghost" style={{ padding: '6px 10px', fontSize: 11.5 }} onClick={async () => {
                                await shopApi(`/shop-admin/listings/${d.id}/still-available`, { method: 'POST', body: '{}' });
                                setSoldPrompt((s) => (s || []).filter((x: any) => x.id !== d.id));
                              }}>بعده موجود</Btn>
                            </div>
                          ))}
                        </Card>
                      ) : null}
                      <ChannelSettings me={me} onReload={load} />
                    </div>
                  </div>
                )}
      </div>

      {/* ── tabs: bottom bar on phones, top rail on desktop ───────── */}
      <div style={wide ? {
        position: 'fixed', insetInline: 0, top: 0, zIndex: 30, display: 'flex',
        justifyContent: 'center', gap: 4, background: T.surface,
        borderBottom: `1px solid ${T.line}`, padding: '0 16px',
      } : {
        position: 'fixed', insetInline: 0, bottom: 0, zIndex: 30, display: 'flex',
        background: T.surface, borderTop: `1px solid ${T.line}`, maxWidth: 640, margin: '0 auto',
      }}>
        {TABS.map((t2) => (
          <button key={t2.key} onClick={() => setView(t2.key)} style={{
            flex: wide ? undefined : 1, padding: wide ? '15px 22px' : '13px 0',
            background: 'transparent', border: 'none', cursor: 'pointer',
            borderBottom: wide && view === t2.key ? `2px solid ${T.accent}` : '2px solid transparent',
            font: `600 12.5px ${FONT}`, color: view === t2.key ? T.accent : T.subtle,
          }}>
            {t2.label}{t2.badge ? ` (${arNum(t2.badge)})` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

function Legend({ c, l }: { c: string; l: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: c }} />{l}
    </span>
  );
}

function Decision({ n, tone, title, sub, actions }: {
  n: number; tone: string; title: string; sub?: string;
  actions?: { label: string; primary?: boolean; onClick: () => void }[];
}) {
  return (
    <Card pad={15} style={{ borderColor: tone === T.accent ? 'rgba(217,88,58,0.42)' : tone === T.red ? 'rgba(180,58,46,0.35)' : T.line }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{
          minWidth: 42, height: 42, padding: '0 10px', borderRadius: 12, background: tone,
          display: 'grid', placeItems: 'center', font: `700 17px ${FONT}`, color: '#fff',
        }}>{arNum(n)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ font: `600 15px ${FONT}`, color: T.ink }}>{title}</div>
          {sub ? <div style={{ font: `400 12px ${FONT}`, color: T.subtle, marginTop: 3 }}>{sub}</div> : null}
        </div>
      </div>
      {actions?.length ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {actions.map((a) => (
            <Btn key={a.label} kind={a.primary ? 'primary' : 'ghost'} style={{ flex: 1 }} onClick={a.onClick}>{a.label}</Btn>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** Contact channels (spec §11) — at least one must stay on; the server agrees. */
function ChannelSettings({ me, onReload }: { me: any; onReload: () => void }) {
  const [msg, setMsg] = useState('');
  const ch = me?.channels || { call: true, whatsapp: true, chat: true };
  async function toggle(key: 'call' | 'whatsapp' | 'chat') {
    try {
      await shopApi('/shop-admin/channels', { method: 'PATCH', body: JSON.stringify({ [key]: !ch[key] }) });
      setMsg(''); onReload();
    } catch (e: any) {
      setMsg(e?.data?.error === 'need_one_channel' ? 'لازم تبقى وسيلة تواصل وحدة على الأقل.' : 'تعذّر الحفظ');
    }
  }
  const LABEL: Record<string, string> = { call: 'اتصال', whatsapp: 'واتساب', chat: 'محادثة داخل التطبيق' };
  return (
    <Card>
      <SectionTitle>وسائل التواصل</SectionTitle>
      <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginBottom: 8 }}>
        شنو يشوف الزبون على صفحة متجرك.
      </div>
      {(['call', 'whatsapp', 'chat'] as const).map((k) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!ch[k]} onChange={() => toggle(k)} />
          <span style={{ font: `400 13px ${FONT}`, color: T.ink }}>{LABEL[k]}</span>
        </label>
      ))}
      {msg ? <div style={{ font: `600 12px ${FONT}`, color: T.red, marginTop: 6 }}>{msg}</div> : null}
    </Card>
  );
}

/** Upgrade request form (spec §3). */
function UpgradeForm({ me, onClose, onDone }: { me: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    store_name: me?.name || '', governorate: '', device_count_approx: '',
    sells_new: !!me?.sells_new, phone: '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      await shopApi('/shop-admin/tier-request', {
        method: 'POST',
        body: JSON.stringify({ ...f, device_count_approx: Number(f.device_count_approx) || null }),
      });
      alert('نراجع طلبك خلال ٢٤ ساعة');
      onDone();
    } catch (e2: any) {
      const m: Record<string, string> = {
        request_pending: 'عندك طلب قيد المراجعة.',
        too_soon: 'تكدر تعيد الطلب بعد ٣٠ يوم من آخر رد.',
        already_advanced: 'لوحتك مترقّية أصلاً.',
      };
      setMsg(m[e2?.data?.error] || `خطأ: ${e2.message}`);
    } finally { setBusy(false); }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: T.scrim, zIndex: 50, display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={submit} style={{ background: T.bg, borderRadius: 20, padding: 20, width: '100%', maxWidth: 420 }}>
        <div style={{ font: `700 17px ${FONT}`, color: T.ink, marginBottom: 4 }}>اطلب ترقية اللوحة</div>
        <div style={{ font: `400 12.5px ${FONT}`, color: T.subtle, marginBottom: 14 }}>
          نراجع طلبك خلال ٢٤ ساعة ونخبرك بالتطبيق.
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <input placeholder="اسم المتجر" value={f.store_name} onChange={(e) => setF({ ...f, store_name: e.target.value })} style={inputStyle} required />
          <input placeholder="المحافظة" value={f.governorate} onChange={(e) => setF({ ...f, governorate: e.target.value })} style={inputStyle} />
          <input placeholder="كم جهاز عندك تقريباً؟" inputMode="numeric" value={f.device_count_approx}
            onChange={(e) => setF({ ...f, device_count_approx: e.target.value })} style={inputStyle} />
          <input placeholder="رقم الهاتف / واتساب" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} style={inputStyle} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: `400 13px ${FONT}`, color: T.ink }}>
            <input type="checkbox" checked={f.sells_new} onChange={(e) => setF({ ...f, sells_new: e.target.checked })} />
            أبيع أجهزة جديدة
          </label>
        </div>
        {msg ? <div style={{ font: `600 12.5px ${FONT}`, color: T.red, marginTop: 10 }}>{msg}</div> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Btn type="submit" disabled={busy} style={{ flex: 1 }}>أرسل الطلب</Btn>
          <Btn kind="ghost" onClick={onClose}>إلغاء</Btn>
        </div>
      </form>
    </div>
  );
}

// ─── login ───────────────────────────────────────────────────────────
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

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: T.bg, fontFamily: FONT, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 20, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: T.accent, display: 'grid', placeItems: 'center', font: '800 14px system-ui', color: '#fff' }}>iQ</div>
          <div style={{ font: `700 17px ${FONT}`, color: T.ink }}>لوحة المتجر</div>
        </div>
        <form onSubmit={submit}>
          <input placeholder="اسم المستخدم" value={username} onChange={(e) => setUsername(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} autoFocus />
          <input placeholder="كلمة المرور" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
          {err ? <div style={{ color: T.red, font: `600 12.5px ${FONT}`, marginBottom: 8 }}>{err}</div> : null}
          <Btn type="submit" disabled={busy} style={{ width: '100%' }}>دخول</Btn>
        </form>
        <button onClick={onBack} style={{ marginTop: 12, background: 'transparent', border: 'none', cursor: 'pointer', font: `400 13px ${FONT}`, color: T.subtle }}>
          → لوحة الإدارة
        </button>
      </div>
    </div>
  );
}
