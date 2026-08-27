// النمو — what a shop does once today's work is handled (spec §7 summary,
// §8 demand, §9 private reply stats, plus featuring and verification).
//
// Every number here is either actionable or paired with the action that
// changes it. Demand alerts are the sharpest: they say what people in this
// governorate searched for and did not find in this shop.
import React, { useCallback, useEffect, useState } from 'react';
import {
  T, FONT, shopApi, shopUpload, arNum, money, Card, SectionTitle, Btn,
  inputStyle, Skeleton, EmptyState,
} from './kit';

type Demand = { query: string; searches: number; has_it: boolean };
type Top = { brand: string; model: string; views: number; contacts: number };

export function InsightsView({ me, advanced, onReload }: { me: any; advanced: boolean; onReload: () => void }) {
  const [demand, setDemand] = useState<Demand[] | null>(null);
  const [top, setTop] = useState<Top[] | null>(null);
  const [cfg, setCfg] = useState<any | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [featOpen, setFeatOpen] = useState(false);
  const [tier, setTier] = useState('week');
  const [carrier, setCarrier] = useState('asiacell');
  const [sender, setSender] = useState('');

  useEffect(() => {
    shopApi<Top[]>('/shop-admin/top-devices').then(setTop).catch(() => setTop([]));
    shopApi<any>('/shop-admin/feature-config').then(setCfg).catch(() => {});
    if (advanced) shopApi<Demand[]>('/shop-admin/demand').then(setDemand).catch(() => setDemand([]));
  }, [advanced]);

  const v = me?.verification;
  const ready = !!(v?.has_logo && (v?.gallery_count ?? 0) >= 3 && v?.has_location);
  const featured = !!(me?.featured_until && me.featured_until > Date.now());
  const featPending = me?.feature_request_status?.status === 'pending';
  const reply = me?.reply;

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
    } finally { setBusy(false); }
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
    } finally { setBusy(false); }
  }

  const selectedTier = (cfg?.tiers || []).find((t2: any) => t2.key === tier);
  const ussd = cfg && carrier !== 'qicard' && selectedTier
    ? (cfg.ussd_templates?.[carrier] || '').replace('{amount}', String(selectedTier.amount)).replace('{number}', cfg.transfer_numbers?.[carrier] || '')
    : null;

  return (
    <div style={{ padding: '0 16px' }}>
      {msg ? (
        <div style={{ font: `600 12.5px ${FONT}`, color: msg.startsWith('خطأ') || msg.startsWith('ناقص') ? T.red : T.green, marginBottom: 10 }}>
          {msg}
        </div>
      ) : null}

      {/* ── unmet demand (advanced) ────────────────────────────────── */}
      {advanced ? (
        <Card>
          <SectionTitle>ناس تدور وما لكت</SectionTitle>
          <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginBottom: 10 }}>
            بحث بمحافظتك آخر ٧ أيام ورجع بلا نتائج — هاي بضاعة تنباع اليوم لو توفرها.
          </div>
          {demand === null ? <Skeleton rows={2} height={40} />
            : !demand.length ? (
              <div style={{ font: `400 12.5px ${FONT}`, color: T.subtle }}>
                ما في بحث بلا نتائج بمحافظتك هذا الأسبوع — تغطيتك زينة.
              </div>
            ) : demand.map((d) => (
              <div key={d.query} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                borderTop: `1px solid ${T.line}`,
              }}>
                <span style={{ flex: 1, font: `600 13px ${FONT}`, color: T.ink }}>{d.query}</span>
                <span style={{ font: `400 12px ${FONT}`, color: T.subtle }}>{arNum(d.searches)} بحث</span>
                <span style={{
                  font: `600 11.5px ${FONT}`,
                  color: d.has_it ? T.green : T.deep,
                  background: d.has_it ? T.greenSoft : 'transparent',
                  border: d.has_it ? 'none' : `1px solid ${T.line2}`,
                  borderRadius: 999, padding: '3px 9px',
                }}>{d.has_it ? '✓ عندك' : 'ما عندك'}</span>
              </div>
            ))}
        </Card>
      ) : null}

      {/* ── reply performance, private (spec §9) ───────────────────── */}
      {reply ? (
        <Card>
          <SectionTitle>سرعة ردّك</SectionTitle>
          {reply.median_minutes == null ? (
            <div style={{ font: `400 12.5px ${FONT}`, color: T.subtle }}>
              محتاج {arNum(reply.needed ?? 5)} محادثات إضافية حتى نحسب معدل ردك.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ font: `700 26px ${FONT}`, color: T.ink }}>
                  {reply.median_minutes < 60 ? arNum(reply.median_minutes) : arNum(Math.round(reply.median_minutes / 60))}
                </span>
                <span style={{ font: `500 13px ${FONT}`, color: T.subtle }}>
                  {reply.median_minutes < 60 ? 'دقيقة' : 'ساعة'} — معدل ردك
                </span>
                {reply.badge ? (
                  <span style={{
                    marginInlineStart: 'auto', font: `700 12px ${FONT}`, color: T.green,
                    background: T.greenSoft, borderRadius: 999, padding: '4px 10px',
                  }}>{reply.badge === 'fast' ? '⚡ يرد بسرعة' : '✓ يرد بنفس اليوم'}</span>
                ) : null}
              </div>
              {reply.next_badge ? (
                <div style={{ font: `400 12.5px ${FONT}`, color: T.subtle, marginTop: 8, lineHeight: 1.7 }}>
                  {reply.next_badge === 'fast'
                    ? 'رد خلال ساعة وتحصل على شارة «يرد بسرعة» ⚡'
                    : 'رد خلال ٤ ساعات وتحصل على شارة «يرد بنفس اليوم» ✓'}
                </div>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {/* ── national demand ────────────────────────────────────────── */}
      <Card>
        <SectionTitle>الأكثر طلباً بالعراق</SectionTitle>
        <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginBottom: 8 }}>
          آخر ٣٠ يوم — من كل إعلانات التطبيق.
        </div>
        {top === null ? <Skeleton rows={3} height={34} />
          : !top.length ? <div style={{ font: `400 12.5px ${FONT}`, color: T.subtle }}>لا بيانات كافية بعد.</div>
            : top.map((d, i) => (
              <div key={`${d.brand}-${d.model}`} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                borderTop: i ? `1px solid ${T.line}` : 'none',
              }}>
                <span style={{ font: `700 12px ${FONT}`, color: i < 3 ? T.accent : T.subtle, minWidth: 18 }}>{arNum(i + 1)}</span>
                <span style={{ flex: 1, font: `600 13px ${FONT}`, color: T.ink, direction: 'ltr', textAlign: 'right' }}>
                  {d.brand} {d.model}
                </span>
                <span style={{ font: `400 11.5px ${FONT}`, color: T.subtle }}>
                  {arNum(d.contacts)} تواصل · {arNum(d.views)} مشاهدة
                </span>
              </div>
            ))}
      </Card>

      {/* ── featuring ──────────────────────────────────────────────── */}
      <Card>
        <SectionTitle action={
          featured ? <span style={{ font: `600 11.5px ${FONT}`, color: T.green }}>
            مميّز حتى {new Date(me.featured_until).toLocaleDateString('ar-IQ')}
          </span> : featPending ? <span style={{ font: `600 11.5px ${FONT}`, color: T.deep }}>قيد المراجعة</span> : null
        }>ميّز متجري ✨</SectionTitle>
        <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginBottom: 10 }}>
          متجرك يطلع بأول دليل المتاجر مع شارة «مميّز» — مشاهدات أكثر واتصالات أكثر.
        </div>
        {!featured && !featPending ? (
          !featOpen ? <Btn onClick={() => setFeatOpen(true)}>اطلب التمييز</Btn> : (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(cfg?.tiers || []).map((t2: any) => (
                  <button key={t2.key} onClick={() => setTier(t2.key)} style={{
                    flex: 1, minWidth: 96, borderRadius: 12, padding: '10px 8px', cursor: 'pointer',
                    background: tier === t2.key ? T.accent : '#fff',
                    border: `1px solid ${tier === t2.key ? T.accent : T.line2}`,
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
                    background: carrier === c ? T.chip : '#fff',
                    border: `1px solid ${carrier === c ? T.accent : T.line2}`,
                    font: `600 12px ${FONT}`, color: T.ink,
                  }}>{c === 'asiacell' ? 'آسياسيل' : c === 'korek' ? 'كورك' : 'كي كارد'}</button>
                ))}
              </div>
              <input value={sender} onChange={(e) => setSender(e.target.value)} style={inputStyle}
                placeholder={carrier === 'qicard' ? 'اسم صاحب حساب Qi' : (carrier === 'korek' ? '0750XXXXXXX' : '0770XXXXXXX')} />
              {carrier === 'qicard' && cfg?.qi_card ? (
                <div style={{ background: T.chip, borderRadius: 10, padding: 10, font: `400 12px ${FONT}`, color: '#3A352D' }}>
                  حوّل {money(selectedTier?.amount || 0)} د.ع إلى حساب Qi:{' '}
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{cfg.qi_card.account}</span> — {cfg.qi_card.name}
                </div>
              ) : ussd ? (
                <div style={{ background: T.chip, borderRadius: 10, padding: 10, font: `400 12px ${FONT}`, color: '#3A352D' }}>
                  حوّل الرصيد بالرمز:{' '}
                  <span style={{ fontFamily: 'ui-monospace, monospace', direction: 'ltr', display: 'inline-block' }}>{ussd}</span>
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn disabled={busy || !sender.trim()} onClick={requestFeature} style={{ flex: 1 }}>حوّلت — أرسل الطلب</Btn>
                <Btn kind="ghost" onClick={() => setFeatOpen(false)}>إلغاء</Btn>
              </div>
            </div>
          )
        ) : null}
      </Card>

      {/* ── verification ───────────────────────────────────────────── */}
      <Card>
        <SectionTitle action={
          me?.verified ? <span style={{ font: `600 11.5px ${FONT}`, color: T.green }}>موثّق</span>
            : v?.request_status === 'pending' ? <span style={{ font: `600 11.5px ${FONT}`, color: T.deep }}>قيد المراجعة</span>
              : null
        }>توثيق المتجر ✔️</SectionTitle>
        {!me?.verified ? (
          <>
            <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginBottom: 8 }}>
              الشارة تزيد ثقة الزبون. المطلوب: شعار المتجر، ٣ صور على الأقل، وموقعك على الخريطة.
            </div>
            <Req ok={!!v?.has_logo} label="شعار المتجر" action={
              <label style={{ font: `700 12px ${FONT}`, color: T.accent, cursor: 'pointer' }}>
                رفع
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const fd = new FormData(); fd.append('image', f);
                    await shopUpload('/shop-admin/logo', fd); e.target.value = ''; onReload();
                  }} />
              </label>
            } />
            <Req ok={(v?.gallery_count ?? 0) >= 3} label={`صور المتجر (${arNum(v?.gallery_count ?? 0)}/٣)`} hint="من تبويب الأجهزة ← قائمة الأسعار" />
            <Req ok={!!v?.has_location} label="موقع المتجر" action={
              <button onClick={pinLocation} style={{ background: 'transparent', border: 'none', font: `700 12px ${FONT}`, color: T.accent, cursor: 'pointer' }}>
                حدّد موقعي
              </button>
            } />
            {v?.request_status !== 'pending' ? (
              <Btn disabled={busy || !ready} onClick={requestVerification} style={{ marginTop: 10, width: '100%' }}
                kind={ready ? 'primary' : 'ghost'}>اطلب التوثيق</Btn>
            ) : null}
          </>
        ) : null}
      </Card>
    </div>
  );
}

function Req({ ok, label, hint, action }: { ok: boolean; label: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0' }}>
      <span style={{
        width: 18, height: 18, borderRadius: 999, flexShrink: 0,
        background: ok ? T.green : 'transparent', border: ok ? 'none' : `1.5px solid ${T.line2}`,
        display: 'grid', placeItems: 'center', font: '700 11px system-ui', color: '#fff',
      }}>{ok ? '✓' : ''}</span>
      <span style={{ flex: 1, font: `400 12.5px ${FONT}`, color: ok ? T.subtle : T.ink }}>
        {label}{hint && !ok ? <span style={{ color: T.subtle }}> — {hint}</span> : null}
      </span>
      {!ok && action ? action : null}
    </div>
  );
}
