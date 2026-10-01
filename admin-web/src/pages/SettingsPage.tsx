import React, { useEffect, useState } from 'react';
import { api } from '../api';

// `enabled` is the EFFECTIVE state (switch on AND an API key present), which
// is what the checkbox reflects — it is disabled without a key anyway, so
// showing it unchecked matches what the server will actually do.
// `enabled_setting` is the stored switch position, kept for diagnosis.
type CatalogModel = { id: string; vendor: 'openai' | 'anthropic'; label: string; per_1000: number; note?: string };
type InspectionStatus = {
  configured: boolean; enabled: boolean; enabled_setting?: boolean;
  autoreject: boolean; hold: boolean; pending: number; held: number;
  // The model in effect, the env var it needs, what the dashboard stored
  // ('' = default), the default, the catalogue, and which keys exist.
  model?: string; key_env?: string;
  model_setting?: string; model_default?: string;
  models?: CatalogModel[];
  keys?: Record<string, boolean>;
};

const VENDOR_KEY: Record<string, string> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
const vendorOf = (id: string) => (/^claude-/i.test(id) ? 'anthropic' : 'openai');

export function SettingsPage() {
  const [ttl, setTtl] = useState<string>('30');
  const [reserveOnConfirm, setReserveOnConfirm] = useState<boolean>(true);
  const [msg, setMsg] = useState('');
  // AI inspection lives on its own switches — saved immediately on toggle
  // rather than behind the Save button, so there's no ambiguity about
  // whether a safety-relevant setting is actually in effect.
  const [insp, setInsp] = useState<InspectionStatus | null>(null);

  useEffect(() => {
    api<{ listing_ttl_days: number; reserve_on_confirm: boolean }>('/admin/settings').then((s) => {
      setTtl(String(s.listing_ttl_days));
      setReserveOnConfirm(s.reserve_on_confirm);
    });
    api<InspectionStatus>('/admin/inspection/status').then(setInsp).catch(() => {});
  }, []);

  // Free-text model id, for one the catalogue doesn't list yet.
  const [customModel, setCustomModel] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [modelErr, setModelErr] = useState('');

  async function setInspection(patch: Partial<Pick<InspectionStatus, 'enabled' | 'autoreject' | 'hold' | 'model_setting'>>) {
    const body: Record<string, boolean | string> = {};
    if (patch.enabled !== undefined) body.listing_inspection_enabled = patch.enabled;
    if (patch.autoreject !== undefined) body.listing_inspection_autoreject = patch.autoreject;
    if (patch.hold !== undefined) body.listing_inspection_hold = patch.hold;
    if (patch.model_setting !== undefined) body.listing_inspection_model = patch.model_setting;
    setModelErr('');
    setInsp((s) => (s ? { ...s, ...patch } : s)); // optimistic
    try {
      await api('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
      setInsp(await api<InspectionStatus>('/admin/inspection/status'));
      if (patch.model_setting !== undefined) setShowCustom(false);
    } catch {
      if (patch.model_setting !== undefined) setModelErr('اسم نموذج غير مقبول — يجب أن يبدأ بـ gpt- أو claude-');
      setInsp(await api<InspectionStatus>('/admin/inspection/status')); // roll back to truth
    }
  }

  // The selected row of the picker: a catalogue id, '' for the default, or
  // 'custom' when the stored id is not in the catalogue.
  const catalogue = insp?.models || [];
  const stored = insp?.model_setting || '';
  const pickerValue = showCustom ? 'custom' : !stored ? '' : catalogue.some((m) => m.id === stored) ? stored : 'custom';
  const keyFor = (id: string) => VENDOR_KEY[vendorOf(id)];
  const hasKey = (id: string) => !!insp?.keys?.[keyFor(id)];

  async function save() {
    await api('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ listing_ttl_days: Number(ttl), reserve_on_confirm: reserveOnConfirm }),
    });
    setMsg('Saved'); setTimeout(() => setMsg(''), 1500);
  }

  return (
    <div>
      <div className="card">
        <h2>Settings</h2>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', marginBottom: 6, color: '#9ca3af' }}>Listing expiry (days)</label>
          <input type="number" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={reserveOnConfirm} onChange={(e) => setReserveOnConfirm(e.target.checked)} />
            On seller confirm: mark listing as <strong>reserved</strong> (else <strong>sold</strong>)
          </label>
        </div>
        <button onClick={save}>Save</button>
        {msg ? <span style={{ marginRight: 12, color: '#10b981' }}>{msg}</span> : null}
      </div>

      <div className="card">
        <h2>فحص الإعلانات بالذكاء الاصطناعي</h2>
        <p style={{ color: '#9ca3af', fontSize: 13.5, marginTop: 0, maxWidth: 620 }}>
          يقرأ وصف الإعلان <strong>وصوره</strong> ويصنّف الجهاز: <strong>جيد</strong> (جديد، كالجديد، أو مستعمل بخدوش) يُنشر؛
          <strong> سيّئ</strong> (شاشة مكسورة، لمس لا يعمل، بقعة بالشاشة، ظهر مهشّم، أو وصف يقول معطّل/لا يعمل) يُحجب
          ويُبلَّغ البائع أن الفريق سيراجعه. يعمل بعد رفع الصور ولا يؤخّر النشر.
        </p>

        {!insp ? (
          <p style={{ color: '#9ca3af' }}>جارٍ التحميل…</p>
        ) : !insp.configured ? (
          <p style={{ color: '#facc15', fontSize: 13.5 }}>
            ⚠️ يتطلّب إضافة <code>{insp.key_env || 'OPENAI_API_KEY'}</code> في ملف <code>.env</code> على الخادم
            {insp.model ? <> (النموذج الحالي: <code>{insp.model}</code>)</> : null}.
            بدونها يبقى الفحص متوقفاً مهما كان وضع المفتاح.
          </p>
        ) : null}

        <div style={{ marginBottom: 12, opacity: insp?.configured ? 1 : 0.5 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              disabled={!insp?.configured}
              checked={!!insp?.enabled}
              onChange={(e) => setInspection({ enabled: e.target.checked })}
            />
            <span>تفعيل الفحص</span>
          </label>
        </div>

        {/* Which model judges. Saved on change like the switches. The API
            keys stay in .env — this only picks between the vendors whose
            key is there, and says plainly when the chosen one is missing. */}
        {insp ? (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', marginBottom: 6, color: '#9ca3af' }}>النموذج الذي يحكم على الإعلان</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={pickerValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'custom') { setCustomModel(stored); setShowCustom(true); return; }
                  setShowCustom(false);
                  setInspection({ model_setting: v });
                }}
              >
                <option value="">الافتراضي ({insp.model_default})</option>
                <optgroup label="OpenAI — يحتاج OPENAI_API_KEY">
                  {catalogue.filter((m) => m.vendor === 'openai').map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · ≈ ${m.per_1000} / 1000 إعلان{m.note ? ` · ${m.note}` : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Anthropic — يحتاج ANTHROPIC_API_KEY">
                  {catalogue.filter((m) => m.vendor === 'anthropic').map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · ≈ ${m.per_1000} / 1000 إعلان{m.note ? ` · ${m.note}` : ''}
                    </option>
                  ))}
                </optgroup>
                <option value="custom">اسم نموذج آخر…</option>
              </select>
              {pickerValue === 'custom' ? (
                <>
                  <input
                    placeholder="gpt-… أو claude-…"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    style={{ minWidth: 220, direction: 'ltr' }}
                  />
                  <button onClick={() => setInspection({ model_setting: customModel.trim() })}>حفظ</button>
                </>
              ) : null}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: insp.model && hasKey(insp.model) ? '#9ca3af' : '#facc15' }}>
              المستخدم الآن: <code>{insp.model}</code>
              {insp.model && hasKey(insp.model)
                ? <> — المفتاح <code>{keyFor(insp.model)}</code> موجود ✓</>
                : <> — ⚠️ المفتاح <code>{insp.model ? keyFor(insp.model) : ''}</code> غير موجود في <code>.env</code>؛ الفحص لن يعمل حتى يُضاف.</>}
            </p>
            {modelErr ? <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#f87171' }}>{modelErr}</p> : null}
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>
              التكلفة تقديرية لثلاث صور ووصف لكل إعلان — التفاصيل في <code>docs/listing-quality-ai-review.md</code>.
            </p>
          </div>
        ) : null}

        <div style={{ marginBottom: 12, opacity: insp?.configured && insp?.enabled ? 1 : 0.5 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              disabled={!insp?.configured || !insp?.enabled}
              checked={!!insp?.hold}
              onChange={(e) => setInspection({ hold: e.target.checked })}
              style={{ marginTop: 3 }}
            />
            <span>
              حجب الإعلان السيّئ عن النشر حتى يراجعه موظف (يُبلَّغ البائع)
              <span style={{ display: 'block', color: '#9ca3af', fontSize: 12.5, marginTop: 3 }}>
                بدونه يبقى الإعلان ظاهراً ويُضاف إلى قائمة المراجعة فقط.
              </span>
            </span>
          </label>
        </div>

        <div style={{ marginBottom: 12, opacity: insp?.configured && insp?.enabled ? 1 : 0.5 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              disabled={!insp?.configured || !insp?.enabled}
              checked={!!insp?.autoreject}
              onChange={(e) => setInspection({ autoreject: e.target.checked })}
              style={{ marginTop: 3 }}
            />
            <span>
              حذف الإعلان تلقائياً عند وجود عيب مؤكد بثقة عالية
              <span style={{ display: 'block', color: '#facc15', fontSize: 12.5, marginTop: 3 }}>
                لا تُفعّله إلا بعد مراجعة النتائج لفترة — الخطأ هنا يحذف إعلان بائع سليم.
              </span>
            </span>
          </label>
        </div>

        {insp?.enabled ? (
          <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
            {insp.pending} إعلان بانتظار المراجعة — راجعها من صفحة <strong>الفحص</strong>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
