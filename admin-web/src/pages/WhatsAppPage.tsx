// Linking the WhatsApp number the nudges are sent from, and watching it stay
// linked.
//
// The QR arrives already drawn, as SVG, from our own server — the pairing
// string is a credential (whoever scans it links a device to the account),
// so it is never handed to an image service to be rendered.
//
// Polls every 4 seconds while unlinked because a WhatsApp QR expires in
// roughly twenty, and every 30 once linked, which is only a liveness check.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Due = {
  chat_id: number; listing_id: number; user_id: number; phone: string;
  name: string; device: string; waiting: number; waiting_since: number;
  has_push_token: boolean;
  role: 'buyer' | 'seller';
};

type Preview = {
  transport: { provider: string; configured: boolean; bot?: any };
  enabled: boolean;
  dry_run: boolean;
  within_sending_hours: boolean;
  due: Due[];
  sent_so_far: number;
  by_outcome: { outcome: string; n: number }[];
};

type OutcomeItem = {
  chat_id: number; listing_id: number; user_id: number; role: 'buyer' | 'seller';
  name: string; device: string; sent_at: number; asked_at: number | null;
  opened_at: number | null; opened_24h: boolean;
  replied_at: number | null; replied_24h: boolean;
  reply_hours: number | null; reply_after_hours: number | null;
};
type Outcomes = {
  since: number; sent: number; opened_24h: number; opened_any: number;
  replied: number; replied_24h: number;
  median_reply_hours: number | null; median_reply_after_hours: number | null;
  baseline: { from: number; to: number; questions: number; replied: number; replied_24h: number; median_reply_hours: number | null };
  items: OutcomeItem[];
};

type Settings = {
  chat_nudge_enabled: boolean;
  chat_nudge_dry_run: boolean;
  chat_nudge_per_run: number;
  chat_nudge_daily_cap: number;
  chat_nudge_only_no_push: boolean;
};

type Status = {
  connection: string;
  linked: boolean;
  qr_available: boolean;
  qr_svg: string | null;
  auth_dir_exists: boolean;
  last_error: string | null;
};

const CONNECTION_AR: Record<string, string> = {
  idle: 'غير متصل',
  connecting: 'يتصل…',
  open: 'مربوط',
  close: 'انقطع — يعيد المحاولة',
  logged_out: 'أُلغي الربط من الهاتف',
  unavailable: 'المكتبة غير متوفرة على الخادم',
};

export function WhatsAppPage() {
  const [st, setSt] = useState<Status | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [oc, setOc] = useState<Outcomes | null>(null);
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const [s1, s2, s3, s4] = await Promise.all([
        api<Status>('/admin/whatsapp/status'),
        api<Preview>('/admin/chat-nudge/preview'),
        api<Settings>('/admin/settings'),
        api<Outcomes>('/admin/chat-nudge/outcomes'),
      ]);
      setSt(s1); setPv(s2); setCfg(s3); setOc(s4);
      setErr('');
    } catch (e: any) { setErr(e.message); }
  }, []);

  async function save(patch: Partial<Settings>) {
    setBusy(true);
    try { await api('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  useEffect(() => {
    load();
    const schedule = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => { await load(); schedule(); }, st?.linked ? 30000 : 4000);
    };
    schedule();
    return () => clearTimeout(timer.current);
  }, [load, st?.linked]);

  async function connect() {
    setBusy(true);
    try { await api('/admin/whatsapp/connect', { method: 'POST' }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function unlink() {
    if (!confirm('إلغاء الربط؟ راح تحتاج تمسح كود جديد حتى ترجع ترسل.')) return;
    setBusy(true);
    try { await api('/admin/whatsapp/unlink', { method: 'POST' }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}

      <div className="card">
        <div className="chart-title">ربط رقم واتساب</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.8 }}>
          الرسائل تنرسل من هذا الرقم نفسه، مثل «الأجهزة المرتبطة» بواتساب. الجلسة
          تنحفظ على الخادم وتبقى بعد كل نشر — تمسح الكود مرة وحدة بس.
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 15 }}>الحالة:</strong>
          <span style={{ color: st?.linked ? '#7bd88f' : '#f59e0b', fontWeight: 700 }}>
            {st ? (CONNECTION_AR[st.connection] || st.connection) : '…'}
          </span>
          {st?.last_error ? <span className="muted" style={{ fontSize: 12 }}>({st.last_error})</span> : null}
          <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
            {!st?.linked ? (
              <button className="primary" disabled={busy} onClick={connect}>ابدأ الربط</button>
            ) : null}
            {st?.auth_dir_exists ? (
              <button className="danger" disabled={busy} onClick={unlink}>إلغاء الربط</button>
            ) : null}
          </span>
        </div>
      </div>

      {st?.linked ? (
        <>
          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ fontSize: 14, lineHeight: 1.9 }}>
              الرقم مربوط ويقدر يرسل. تشوفه بالهاتف: واتساب ← الإعدادات ← الأجهزة
              المرتبطة ← «iQ Mobile». إلغاؤه من هناك يوقف الإرسال فوراً.
            </div>
          </div>

          {/* The two switches, and why they are two. Turning the sweep on
              only starts it PICKING rows; the dry run is what stands between
              that and a stranger's phone. */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="chart-title">تذكير المحادثات غير المقروءة</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.9 }}>
              رسالة واحدة لكل إعلان، للي وصلته رسالة من ساعتين لأسبوع وما فتحها —
              مرة وحدة للأبد. تنلغي لحالها إذا فتح التطبيق قبل ما تطلع. إذا عنده ٣ محادثات
              تنتظر توصله رسالة وحدة تقول ٣، مو ثلاث رسائل. رسالة وحدة كل ١٥ دقيقة كحد أقصى،
              بين ٨ صباحاً و١١ مساءً — اللي يستحق بالليل يطلع الصبح.
              البائع يستلم «مشتري راسلك»، والمشتري يستلم «البائع ردّ عليك».
              ما ترسل لمن ما ثبّت التطبيق أصلاً (حسابات انعملت من إعلانات مستوردة).
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox" disabled={busy}
                  checked={!!cfg?.chat_nudge_enabled}
                  onChange={(e) => save({ chat_nudge_enabled: e.target.checked })}
                />
                <span>التذكير التلقائي شغال</span>
              </label>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox" disabled={busy}
                  checked={!!cfg?.chat_nudge_dry_run}
                  onChange={(e) => save({ chat_nudge_dry_run: e.target.checked })}
                />
                <span>وضع التجربة <span className="muted">(يحدد المستلمين بدون ما يرسل)</span></span>
              </label>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox" disabled={busy}
                  checked={!!cfg?.chat_nudge_only_no_push}
                  onChange={(e) => save({ chat_nudge_only_no_push: e.target.checked })}
                />
                <span>فقط اللي ما يوصلهم بوش <span className="muted">(بدون توكن إشعارات)</span></span>
              </label>
              <span className="muted" style={{ fontSize: 12.5, marginInlineStart: 'auto' }}>
                {pv?.within_sending_hours ? 'داخل وقت الإرسال' : 'خارج وقت الإرسال — ما ترسل الآن'}
                {' · '}انرسل سابقاً: {pv?.sent_so_far ?? 0}
              </span>
            </div>
            {cfg?.chat_nudge_enabled && !cfg?.chat_nudge_dry_run ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(217,88,58,0.14)', fontSize: 13 }}>
                ⚠️ الإرسال الحقيقي شغال — الرسائل تطلع من رقمك فعلاً.
              </div>
            ) : null}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="chart-title">منو راح يستلم بالجولة الجاية ({pv?.due.length ?? 0})</div>
            {!pv?.due.length ? (
              <div className="muted" style={{ marginTop: 8 }}>ما في أحد مستحق حالياً.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
                <thead><tr>
                  {['المستلم', 'صفته', 'الهاتف', 'الجهاز', 'محادثات تنتظر', 'عنده إشعارات؟'].map((h) => (
                    <th key={h} style={{ textAlign: 'right', fontSize: 12.5, color: '#888', padding: '0 8px 8px' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {pv.due.map((d) => (
                    <tr key={d.chat_id}>
                      <td style={{ padding: '10px 8px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>
                        {d.name || `#${d.user_id}`}
                      </td>
                      {/* Decides the wording: a seller is told a buyer is
                          waiting, a buyer that the seller answered. */}
                      <td style={{ padding: '10px 8px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>
                        {d.role === 'buyer' ? 'مشتري' : 'بائع'}
                      </td>
                      <td style={{ padding: '10px 8px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>{d.phone}</td>
                      <td style={{ padding: '10px 8px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>{d.device}</td>
                      <td style={{ padding: '10px 8px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>{d.waiting}</td>
                      {/* The whole reason this feature exists: a "لا" here is
                          someone no push could ever have reached. */}
                      <td style={{ padding: '10px 8px', borderTop: '1px solid rgba(128,128,128,0.2)', color: d.has_push_token ? undefined : '#f59e0b' }}>
                        {d.has_push_token ? 'نعم' : 'لا — ما يوصله بوش'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pv?.by_outcome?.length ? (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
                السجل: {pv.by_outcome.map((o) => `${o.outcome}: ${o.n}`).join(' · ')}
              </div>
            ) : null}
          </div>

          {/* Did it work? Per reminder actually sent: opened the thread
              within a day, answered, and how long the answer took — against
              the same kind of question (unanswered for two hours) before any
              reminder existed. */}
          <OutcomesCard oc={oc} />
        </>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <ol style={{ fontSize: 14, lineHeight: 2, paddingInlineStart: 20, margin: '0 0 12px' }}>
            <li>افتح واتساب على الهاتف صاحب الرقم <strong>07502062804</strong></li>
            <li>الإعدادات ← <strong>الأجهزة المرتبطة</strong> ← ربط جهاز</li>
            <li>امسح الكود تحت — ينتهي خلال ثوانٍ، والصفحة تجيب واحد جديد لحالها</li>
          </ol>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 300, background: '#fff', borderRadius: 12, padding: 16,
          }}>
            {st?.qr_svg
              ? <div style={{ width: 280, height: 280 }} dangerouslySetInnerHTML={{ __html: st.qr_svg }} />
              : <span className="muted" style={{ color: '#666' }}>
                  {st?.connection === 'connecting' ? 'يجهّز الكود…' : 'اضغط «ابدأ الربط»'}
                </span>}
          </div>
        </div>
      )}
    </div>
  );
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}٪` : '—');
const hrs = (h: number | null) => (h == null ? '—' : h >= 48 ? `${Math.round(h / 24)} يوم` : `${h} س`);
const when = (t: number | null) => (t ? new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Baghdad', hour12: false }).slice(0, 17) : '—');

function OutcomesCard({ oc }: { oc: Outcomes | null }) {
  if (!oc) return null;
  const b = oc.baseline;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="chart-title">شنو صار بعد التذكير (آخر ٣٠ يوم)</div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: 13.5 }}>
        <span>تذكيرات انرسلت: <b>{oc.sent}</b></span>
        <span>فتح المحادثة خلال ٢٤ ساعة: <b>{oc.opened_24h}</b> <span className="muted">({pct(oc.opened_24h, oc.sent)})</span></span>
        <span>ردّ: <b>{oc.replied}</b> <span className="muted">({pct(oc.replied, oc.sent)} · خلال ٢٤ ساعة {oc.replied_24h})</span></span>
        <span>وسيط وقت الرد بعد التذكير: <b>{hrs(oc.median_reply_after_hours)}</b></span>
      </div>
      {/* The comparison: same population (a question nobody answered within
          two hours), measured from the question — because that is the only
          clock both groups share. */}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.9 }}>
        للمقارنة — قبل ما يصير تذكير (أسئلة ما انردّ عليها خلال ساعتين، {when(b.from)} ← {when(b.to)}):
        {' '}{b.questions} سؤال، انردّ على <b>{b.replied}</b> ({pct(b.replied, b.questions)})،
        وسيط وقت الرد من السؤال <b>{hrs(b.median_reply_hours)}</b>.
        {' '}مع التذكير: وسيط وقت الرد من السؤال <b>{hrs(oc.median_reply_hours)}</b>.
      </div>
      {oc.items.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead><tr>
            {['المستلم', 'الجهاز', 'انرسل', 'فتح المحادثة', 'ردّ', 'وقت الرد'].map((h) => (
              <th key={h} style={{ textAlign: 'right', fontSize: 12.5, color: '#888', padding: '0 8px 8px' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {oc.items.map((i) => (
              <tr key={i.chat_id}>
                <td style={{ padding: '8px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>
                  {i.name || `#${i.user_id}`} <span className="muted">({i.role === 'buyer' ? 'مشتري' : 'بائع'})</span>
                </td>
                <td style={{ padding: '8px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>{i.device}</td>
                <td style={{ padding: '8px', borderTop: '1px solid rgba(128,128,128,0.2)' }} dir="ltr">{when(i.sent_at)}</td>
                <td style={{ padding: '8px', borderTop: '1px solid rgba(128,128,128,0.2)', color: i.opened_24h ? '#4ade80' : i.opened_at ? '#facc15' : '#f87171' }}>
                  {i.opened_24h ? 'خلال ٢٤ ساعة' : i.opened_at ? 'بعدين' : 'لا'}
                </td>
                <td style={{ padding: '8px', borderTop: '1px solid rgba(128,128,128,0.2)', color: i.replied_at ? '#4ade80' : '#f87171' }}>
                  {i.replied_at ? (i.replied_24h ? 'نعم، خلال ٢٤ ساعة' : 'نعم، بعدين') : 'لا'}
                </td>
                <td style={{ padding: '8px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>
                  {i.replied_at ? <>{hrs(i.reply_after_hours)} بعد التذكير <span className="muted">· {hrs(i.reply_hours)} من السؤال</span></> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="muted" style={{ marginTop: 8 }}>ما انرسل أي تذكير حقيقي بعد.</div>}
    </div>
  );
}
