import React, { useEffect, useState } from 'react';
import { api } from '../api';

// Two things the app reads from GET /app-config on launch, both editable here
// so copy, links and thresholds change without shipping a release.
//
//   Update floor — below min_supported_version the app shows a wall the user
//   cannot dismiss. That locks people out, so it is worded and confirmed
//   accordingly. nag_below_version is the polite version.
//
//   Home overlay — an interstitial over the listing feed for a sponsor,
//   promo or notice.

type Settings = {
  min_supported_version: string;
  nag_below_version: string;
  overlay_enabled: boolean;
  overlay_title: string;
  overlay_body: string;
  overlay_image: string;
  overlay_cta_label: string;
  overlay_cta_url: string;
  overlay_version: string;
  overlay_frequency: string;
};

const EMPTY: Settings = {
  min_supported_version: '0', nag_below_version: '0',
  overlay_enabled: false, overlay_title: '', overlay_body: '', overlay_image: '',
  overlay_cta_label: '', overlay_cta_url: '', overlay_version: '1', overlay_frequency: 'once',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', marginBottom: 5, fontWeight: 600, color: 'var(--text)' }}>{label}</label>
      {children}
      {hint ? <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export function AppControlPage() {
  const [s, setS] = useState<Settings>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Settings>('/admin/settings')
      .then((r) => { setS({ ...EMPTY, ...r }); setLoaded(true); })
      .catch((e) => setErr(e.message));
  }, []);

  const set = (patch: Partial<Settings>) => setS((p) => ({ ...p, ...patch }));

  async function save(patch: Partial<Settings>, note = 'تم الحفظ') {
    setErr('');
    try {
      await api('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) });
      setMsg(note);
      setTimeout(() => setMsg(''), 2000);
    } catch (e: any) { setErr(e.message); }
  }

  if (!loaded) return <div className="card"><p className="muted">جارٍ التحميل…</p></div>;

  return (
    <div dir="rtl">
      <div className="card">
        <h2>الحد الأدنى لنسخة التطبيق</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5, maxWidth: 640 }}>
          التطبيق يقرأ هذه القيم عند كل تشغيل. اتركها <code>0</code> لتعطيل أي إجبار.
          المقارنة رقمية، أي أنّ <code>0.1.10</code> أحدث من <code>0.1.9</code>.
        </p>

        <Field
          label="إلزامي — أقل نسخة مسموح بها"
          hint="أقل من هذه النسخة يظهر حاجز لا يمكن تجاوزه. استخدمه فقط عند تغيير يكسر التوافق — هذا يمنع المستخدم من الاستخدام نهائياً."
        >
          <input
            value={s.min_supported_version}
            onChange={(e) => set({ min_supported_version: e.target.value })}
            placeholder="0"
            style={{ width: 160, fontFamily: 'monospace' }}
          />
        </Field>

        <Field
          label="تنبيه فقط — أقل نسخة بدون إزعاج"
          hint="أقل من هذه النسخة يظهر تنبيه يمكن تجاهله. آمن للاستخدام العام."
        >
          <input
            value={s.nag_below_version}
            onChange={(e) => set({ nag_below_version: e.target.value })}
            placeholder="0"
            style={{ width: 160, fontFamily: 'monospace' }}
          />
        </Field>

        {s.min_supported_version !== '0' && s.min_supported_version.trim() ? (
          <div style={{
            borderInlineStart: '3px solid var(--danger)', background: 'rgba(239,68,68,.08)',
            padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13,
          }}>
            <strong style={{ color: 'var(--danger)' }}>تنبيه:</strong>{' '}
            كل من يستخدم نسخة أقل من <code>{s.min_supported_version}</code> لن يستطيع فتح التطبيق
            حتى يحدّثه — بما فيهم من لا يستطيع التحديث الآن.
          </div>
        ) : null}

        <button onClick={() => save({
          min_supported_version: s.min_supported_version.trim() || '0',
          nag_below_version: s.nag_below_version.trim() || '0',
        }, 'تم حفظ حدود النسخة')}>
          حفظ حدود النسخة
        </button>
      </div>

      <div className="card">
        <h2>الإعلان المنبثق على الصفحة الرئيسية</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13.5, maxWidth: 640 }}>
          يظهر فوق قائمة الإعلانات عند فتح التطبيق — راعٍ أو عرض أو تنبيه.
        </p>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={s.overlay_enabled}
            onChange={(e) => { set({ overlay_enabled: e.target.checked }); save({ overlay_enabled: e.target.checked }); }}
          />
          <span style={{ fontWeight: 600 }}>تفعيل الإعلان المنبثق</span>
        </label>

        <div style={{ opacity: s.overlay_enabled ? 1 : 0.55 }}>
          <Field label="العنوان">
            <input value={s.overlay_title} onChange={(e) => set({ overlay_title: e.target.value })}
                   style={{ width: '100%', maxWidth: 460 }} placeholder="مثلاً: عرض خاص" />
          </Field>
          <Field label="النص">
            <textarea value={s.overlay_body} onChange={(e) => set({ overlay_body: e.target.value })}
                      rows={3} style={{ width: '100%', maxWidth: 460 }} />
          </Field>
          <Field label="رابط الصورة" hint="مسار /uploads/… أو رابط كامل. النسبة المثالية 5:2.">
            <input value={s.overlay_image} onChange={(e) => set({ overlay_image: e.target.value })}
                   style={{ width: '100%', maxWidth: 460, fontFamily: 'monospace', fontSize: 12.5 }}
                   placeholder="/uploads/banner.png" />
          </Field>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="نص الزر">
              <input value={s.overlay_cta_label} onChange={(e) => set({ overlay_cta_label: e.target.value })}
                     style={{ width: 200 }} placeholder="تصفّح العرض" />
            </Field>
            <Field label="رابط الزر">
              <input value={s.overlay_cta_url} onChange={(e) => set({ overlay_cta_url: e.target.value })}
                     style={{ width: 280, fontFamily: 'monospace', fontSize: 12.5 }}
                     placeholder="https://iqmobile.org/shop/2548" />
            </Field>
          </div>

          <Field
            label="التكرار"
            hint="«مرة واحدة» يظهر حتى يغلقه المستخدم. «كل مرة» يظهر عند كل فتح — للطوارئ فقط، مزعج كإعداد دائم."
          >
            <select value={s.overlay_frequency} onChange={(e) => set({ overlay_frequency: e.target.value })}>
              <option value="once">مرة واحدة</option>
              <option value="always">كل مرة</option>
            </select>
          </Field>

          <Field
            label="رقم النسخة"
            hint="ارفع الرقم لإعادة إظهار الإعلان لمن أغلقه سابقاً. بدون ذلك لن يرى النص الجديد إلا من لم يرَ القديم."
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={s.overlay_version} onChange={(e) => set({ overlay_version: e.target.value })}
                     style={{ width: 90, fontFamily: 'monospace' }} />
              <button className="secondary" onClick={() => {
                const next = String((parseInt(s.overlay_version, 10) || 1) + 1);
                set({ overlay_version: next });
              }}>+1 وإعادة الإظهار للجميع</button>
            </div>
          </Field>

          <button onClick={() => save({
            overlay_title: s.overlay_title, overlay_body: s.overlay_body,
            overlay_image: s.overlay_image, overlay_cta_label: s.overlay_cta_label,
            overlay_cta_url: s.overlay_cta_url, overlay_version: s.overlay_version,
            overlay_frequency: s.overlay_frequency,
          }, 'تم حفظ الإعلان')}>
            حفظ الإعلان
          </button>
        </div>
      </div>

      {msg ? <div className="card" style={{ borderInlineStart: '3px solid var(--ok)' }}>
        <span style={{ color: 'var(--ok)', fontWeight: 650 }}>{msg}</span>
      </div> : null}
      {err ? <div className="card" style={{ borderInlineStart: '3px solid var(--danger)' }}>
        <span style={{ color: 'var(--danger)' }}>{err}</span>
      </div> : null}
    </div>
  );
}
