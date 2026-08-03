import React, { useCallback, useEffect, useState } from 'react';
import { api, API_BASE } from '../api';

// Review queue for the AI listing inspection (server/src/listingInspect.js).
// The model flags; a human decides. Every row shows the photos and the exact
// evidence so the operator can judge in a couple of seconds rather than
// trusting a verdict blindly.

type Defect = { kind: string; source: 'description' | 'image'; evidence: string };
type Row = {
  id: number;
  listing_id: number;
  verdict: 'clean' | 'suspect' | 'defective';
  confidence: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'removed' | 'error';
  error: string | null;
  created_at: number;
  brand: string; model: string; asking_price: number; governorate: string;
  description: string | null; listing_status: string; seller_name: string;
  defects: Defect[];
  images: string[];
};
type Status = { configured: boolean; enabled: boolean; autoreject: boolean; pending: number; errors: number };

const DEFECT_AR: Record<string, string> = {
  cracked_screen: 'شاشة مكسورة',
  cracked_back: 'ظهر مكسور',
  dent_or_bend: 'انبعاج',
  deep_scratches: 'خدوش عميقة',
  screen_defect: 'عيب بالشاشة',
  water_damage: 'أثر ماء',
  missing_part: 'قطعة ناقصة',
  not_powering_on: 'لا يشتغل',
  battery_fault: 'عطل بطارية',
  locked_account: 'حساب مقفول',
  repaired_before: 'مُصلَّح سابقاً',
};

const VERDICT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  defective: { bg: 'rgba(239,68,68,0.15)', fg: '#f87171', label: 'عيب مؤكد' },
  suspect: { bg: 'rgba(234,179,8,0.15)', fg: '#facc15', label: 'مشكوك' },
  clean: { bg: 'rgba(16,185,129,0.15)', fg: '#34d399', label: 'سليم' },
};

export function InspectionPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'removed' | 'error' | 'all'>('pending');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [s, q] = await Promise.all([
      api<Status>('/admin/inspection/status'),
      api<Row[]>(`/admin/inspection/queue?status=${filter}`),
    ]);
    setStatus(s);
    setRows(q);
  }, [filter]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  async function decide(id: number, action: 'approve' | 'remove') {
    setBusy(id);
    try {
      await api(`/admin/inspection/${id}/${action}`, { method: 'POST' });
      await load();
    } finally { setBusy(null); }
  }

  return (
    <div>
      <div className="card">
        <h2>فحص الإعلانات بالذكاء الاصطناعي</h2>
        {!status ? <p style={{ color: '#9ca3af' }}>جارٍ التحميل…</p> : !status.configured ? (
          <p style={{ color: '#facc15' }}>
            غير مُفعّل — يجب إضافة <code>ANTHROPIC_API_KEY</code> في ملف <code>.env</code> على الخادم أولاً.
          </p>
        ) : !status.enabled ? (
          <p style={{ color: '#9ca3af' }}>الفحص متوقف. فعّله من صفحة الإعدادات.</p>
        ) : (
          <p style={{ color: '#9ca3af' }}>
            الفحص يعمل · <strong style={{ color: '#e5e7eb' }}>{status.pending}</strong> بانتظار المراجعة
            {status.errors > 0 ? <> · <span style={{ color: '#f87171' }}>{status.errors} فشل</span></> : null}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {(['pending', 'approved', 'removed', 'error', 'all'] as const).map((f) => (
            <button key={f} className={filter === f ? '' : 'secondary'} onClick={() => setFilter(f)}>
              {{ pending: 'بانتظار المراجعة', approved: 'مقبولة', removed: 'محذوفة', error: 'فشل', all: 'الكل' }[f]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card"><p style={{ color: '#9ca3af', margin: 0 }}>لا توجد إعلانات في هذه القائمة.</p></div>
      ) : rows.map((r) => {
        const v = VERDICT_STYLE[r.verdict] || VERDICT_STYLE.clean;
        return (
          <div className="card" key={r.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 15 }}>{r.brand} {r.model}</strong>
                <span style={{ color: '#9ca3af', marginInlineStart: 10, fontSize: 13 }}>
                  #{r.listing_id} · {Number(r.asking_price).toLocaleString('en-US')} د.ع · {r.seller_name}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ background: v.bg, color: v.fg, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {v.label}
                </span>
                <span style={{ color: '#9ca3af', fontSize: 12 }}>ثقة: {r.confidence}</span>
              </div>
            </div>

            {r.status === 'error' ? (
              <p style={{ color: '#f87171', fontSize: 13, marginTop: 10 }}>فشل الفحص: {r.error}</p>
            ) : (
              <ul style={{ margin: '10px 0 0', paddingInlineStart: 18, color: '#d1d5db', fontSize: 13.5 }}>
                {r.defects.map((d, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <strong>{DEFECT_AR[d.kind] || d.kind}</strong>
                    <span style={{ color: '#6b7280', fontSize: 12, marginInline: 6 }}>
                      ({d.source === 'image' ? 'من الصورة' : 'من الوصف'})
                    </span>
                    — {d.evidence}
                  </li>
                ))}
              </ul>
            )}

            {r.images.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto' }}>
                {r.images.map((src) => (
                  <a key={src} href={`${API_BASE}${src}`} target="_blank" rel="noreferrer">
                    <img src={`${API_BASE}${src}`} alt=""
                         style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid #374151' }} />
                  </a>
                ))}
              </div>
            ) : null}

            {r.description ? (
              <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 10, whiteSpace: 'pre-wrap' }}>{r.description}</p>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              {r.status === 'pending' ? (
                <>
                  <button disabled={busy === r.id} onClick={() => decide(r.id, 'approve')}>
                    الإعلان سليم — أبقِه
                  </button>
                  <button className="danger" disabled={busy === r.id} onClick={() => decide(r.id, 'remove')}>
                    احذف الإعلان
                  </button>
                </>
              ) : (
                <span style={{ color: '#9ca3af', fontSize: 13 }}>
                  {{ approved: '✓ تمت الموافقة', removed: '✕ حُذف الإعلان', error: 'فشل الفحص' }[r.status]}
                  {' · '}حالة الإعلان: {r.listing_status}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
