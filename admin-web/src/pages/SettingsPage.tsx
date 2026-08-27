import React, { useEffect, useState } from 'react';
import { api } from '../api';

// `enabled` is the EFFECTIVE state (switch on AND an API key present), which
// is what the checkbox reflects — it is disabled without a key anyway, so
// showing it unchecked matches what the server will actually do.
// `enabled_setting` is the stored switch position, kept for diagnosis.
type InspectionStatus = {
  configured: boolean; enabled: boolean; enabled_setting?: boolean;
  autoreject: boolean; pending: number;
};

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

  async function setInspection(patch: Partial<Pick<InspectionStatus, 'enabled' | 'autoreject'>>) {
    const body: Record<string, boolean> = {};
    if (patch.enabled !== undefined) body.listing_inspection_enabled = patch.enabled;
    if (patch.autoreject !== undefined) body.listing_inspection_autoreject = patch.autoreject;
    setInsp((s) => (s ? { ...s, ...patch } : s)); // optimistic
    try {
      await api('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
      setInsp(await api<InspectionStatus>('/admin/inspection/status'));
    } catch {
      setInsp(await api<InspectionStatus>('/admin/inspection/status')); // roll back to truth
    }
  }

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
          يقرأ وصف الإعلان <strong>وصوره</strong> للكشف عن الأجهزة المكسورة أو المعطّلة أو المُصلَّحة —
          شاشة مشقّقة، انبعاج، أثر ماء — حتى لو لم يذكرها البائع. يعمل بعد رفع الصور ولا يؤخّر نشر الإعلان.
        </p>

        {!insp ? (
          <p style={{ color: '#9ca3af' }}>جارٍ التحميل…</p>
        ) : !insp.configured ? (
          <p style={{ color: '#facc15', fontSize: 13.5 }}>
            ⚠️ يتطلّب إضافة <code>ANTHROPIC_API_KEY</code> في ملف <code>.env</code> على الخادم.
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
            <span>تفعيل الفحص — <strong>يُعلّم الإعلانات للمراجعة فقط</strong></span>
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
