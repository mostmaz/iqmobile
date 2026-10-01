import React, { useCallback, useEffect, useState } from 'react';
import {api, API_BASE, listingUrl, listingLinkStyle} from '../api';

// Review queue for the AI listing inspection (server/src/listingInspect.js).
// The model flags; a human decides. Every row shows the photos and the exact
// evidence so the operator can judge in a couple of seconds rather than
// trusting a verdict blindly.

type Defect = { kind: string; source: 'description' | 'image'; evidence: string };
type Row = {
  judged_by?: 'model' | 'words' | null;
  id: number;
  listing_id: number;
  verdict: 'clean' | 'suspect' | 'defective';
  confidence: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'removed' | 'error';
  action: 'logged' | 'published' | 'held' | 'rejected' | 'deleted' | null;
  error: string | null;
  created_at: number;
  brand: string; model: string; asking_price: number; governorate: string;
  condition: string | null;
  description: string | null; listing_status: string; seller_name: string;
  // 1 = the listing is HELD: unpublished until the operator decides here.
  review_hold: number;
  defects: Defect[];
  images: string[];
};
type Last7 = { checked: number; errors: number; clean: number; suspect: number; defective: number; held: number; rejected: number };
type Status = {
  configured: boolean; enabled: boolean; enabled_setting?: boolean; decide: boolean;
  pending: number; held: number; errors: number; errors_total?: number; last7?: Last7;
  model?: string; key_env?: string;
};

// What the check DID with its verdict (listing_inspections.action).
const ACTION_AR: Record<string, { fg: string; label: string }> = {
  logged: { fg: '#9ca3af', label: 'سُجّل فقط — الإعلان ظاهر' },
  published: { fg: '#34d399', label: 'نُشر' },
  held: { fg: '#fb923c', label: 'محجوب للمراجعة' },
  rejected: { fg: '#f87171', label: 'لم يُنشر — أُبلغ البائع' },
  deleted: { fg: '#6b7280', label: 'حذفه البائع' },
};
const CONF_AR: Record<string, string> = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية' };

const DEFECT_AR: Record<string, string> = {
  cracked_screen: 'شاشة مكسورة',
  cracked_back: 'ظهر مكسور',
  dent_or_bend: 'انبعاج',
  deep_scratches: 'خدوش عميقة',
  screen_defect: 'عيب بالشاشة',
  touch_fault: 'مشكلة باللمس',
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
  // 'all' first: every result the check produced, good ones included, is the
  // record the operator reads to judge the model. 'pending' is the to-do.
  const [filter, setFilter] = useState<'pending' | 'approved' | 'removed' | 'error' | 'all'>('all');
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

  async function decide(id: number, action: 'approve' | 'remove', held: boolean) {
    // The seller of a held listing was promised an answer, and "لم يُنشر"
    // with no reason is not one. The model's evidence is the default; the
    // operator can say it in their own words.
    let reason: string | null = null;
    if (action === 'remove' && held) {
      const typed = window.prompt('سبب عدم النشر (يُرسل للبائع — اتركه فارغاً لاستخدام ملاحظة الفحص):', '');
      if (typed === null) return; // cancelled
      reason = typed.trim() || null;
    }
    setBusy(id);
    try {
      await api(`/admin/inspection/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      });
      await load();
    } finally { setBusy(null); }
  }

  return (
    <div>
      <div className="card">
        <h2>فحص الإعلانات بالذكاء الاصطناعي</h2>
        {!status ? <p style={{ color: '#9ca3af' }}>جارٍ التحميل…</p> : !status.configured ? (
          <p style={{ color: '#facc15' }}>
            غير مُفعّل — يجب إضافة <code>{status.key_env || 'OPENAI_API_KEY'}</code> في ملف <code>.env</code> على الخادم أولاً
            {status.model ? <> (النموذج: <code>{status.model}</code>)</> : null}.
          </p>
        ) : !status.enabled ? (
          <p style={{ color: '#9ca3af' }}>الفحص متوقف. فعّله من صفحة الإعدادات.</p>
        ) : (
          <p style={{ color: '#9ca3af' }}>
            الفحص يعمل{status.model ? <> (<code>{status.model}</code>)</> : null}
            {' · '}
            {status.decide
              ? <strong style={{ color: '#e5e7eb' }}>الذكاء الاصطناعي يقرر</strong>
              : <>يسجّل النتائج فقط — <span style={{ color: '#facc15' }}>كل الإعلانات تبقى ظاهرة</span></>}
            {' · '}<strong style={{ color: '#e5e7eb' }}>{status.pending}</strong> بانتظار المراجعة
            {status.held > 0 ? <> · <strong style={{ color: '#fb923c' }}>{status.held}</strong> محجوب عن النشر — البائع ينتظر</> : null}
            {/* Recent failures only. The all-time number was 373 rows from an
                August key with no credit, and it read as "the check is broken". */}
            {status.errors > 0 ? <> · <span style={{ color: '#f87171' }}>{status.errors} فشل بآخر ٧ أيام</span></> : null}
          </p>
        )}
        {status?.last7 ? (
          <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 6, marginBottom: 0 }}>
            آخر ٧ أيام: {status.last7.checked} فحص ·{' '}
            <span style={{ color: '#34d399' }}>{status.last7.clean} سليم</span> ·{' '}
            <span style={{ color: '#facc15' }}>{status.last7.suspect} مشكوك</span> ·{' '}
            <span style={{ color: '#f87171' }}>{status.last7.defective} عيب</span>
            {status.last7.held ? <> · {status.last7.held} حُجب</> : null}
            {status.last7.rejected ? <> · {status.last7.rejected} لم يُنشر</> : null}
            {status.last7.errors ? <> · <span style={{ color: '#f87171' }}>{status.last7.errors} فشل</span></> : null}
          </p>
        ) : null}
        <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 8, marginBottom: 0, maxWidth: 640 }}>
          كل فحص يظهر هنا بنتيجته وما فعله به. مع خيار «دع الذكاء الاصطناعي يقرر» (الإعدادات):
          <strong style={{ color: '#f87171' }}> لم يُنشر</strong> = عيب بثقة عالية والبائع أُبلغ — «انشر» يعكس القرار؛
          <strong style={{ color: '#fb923c' }}> محجوب</strong> = غير واضح أو ثقة منخفضة، ينتظر قرارك والبائع أُبلغ.
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {(['pending', 'approved', 'removed', 'error', 'all'] as const).map((f) => (
            <button key={f} className={filter === f ? '' : 'secondary'} onClick={() => setFilter(f)}>
              {{ pending: 'بانتظار المراجعة', approved: 'مقبولة', removed: 'غير منشورة / محذوفة', error: 'فشل', all: 'كل النتائج' }[f]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card"><p style={{ color: '#9ca3af', margin: 0 }}>لا توجد إعلانات في هذه القائمة.</p></div>
      ) : rows.map((r) => {
        const v = VERDICT_STYLE[r.verdict] || VERDICT_STYLE.clean;
        const held = !!r.review_hold;
        // Rejected by the check and still down: 'approve' republishes it.
        const rejectedByAi = r.action === 'rejected' && r.status === 'removed' && r.listing_status === 'removed';
        const act = r.action ? ACTION_AR[r.action] : null;
        return (
          <div className="card" key={r.id} style={held ? { borderColor: '#fb923c' } : undefined}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <a href={listingUrl(r.listing_id)} target="_blank" rel="noreferrer" style={listingLinkStyle}><strong style={{ fontSize: 15 }}>{r.brand} {r.model}</strong></a>
                <span style={{ color: '#9ca3af', marginInlineStart: 10, fontSize: 13 }}>
                  #{r.listing_id} · {Number(r.asking_price).toLocaleString('en-US')} د.ع · {r.seller_name}
                  {r.condition ? ` · الحالة المعلنة: ${r.condition}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {held ? (
                  <span style={{ background: 'rgba(251,146,60,0.18)', color: '#fb923c', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                    محجوب عن النشر
                  </span>
                ) : null}
                <span style={{ background: v.bg, color: v.fg, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {v.label}
                </span>
                {/* Who said so. The keyword gate fires on «ضد الكسر» as readily
                    as on «الشاشة مكسورة»; the operator should know which
                    rows had a model look at the photos. */}
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 11,
                  background: r.judged_by === 'words' ? 'rgba(148,163,184,0.18)' : 'rgba(96,165,250,0.18)',
                  color: r.judged_by === 'words' ? '#cbd5e1' : '#93c5fd',
                }}>
                  {r.judged_by === 'words' ? 'فلتر الكلمات' : 'الذكاء الاصطناعي'}
                </span>
                <span style={{ color: '#9ca3af', fontSize: 12 }}>ثقة: {CONF_AR[r.confidence] || r.confidence}</span>
                {act && r.status !== 'error' ? (
                  <span style={{ color: act.fg, fontSize: 12 }}>→ {act.label}</span>
                ) : null}
                <span style={{ color: '#6b7280', fontSize: 12 }}>
                  {new Date(r.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
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
                  <button disabled={busy === r.id} onClick={() => decide(r.id, 'approve', held)}>
                    {held ? 'الجهاز مقبول — انشر الإعلان' : 'الإعلان سليم — أبقِه'}
                  </button>
                  <button className="danger" disabled={busy === r.id} onClick={() => decide(r.id, 'remove', held)}>
                    {held ? 'لا تنشر — أبلغ البائع' : 'احذف الإعلان'}
                  </button>
                </>
              ) : rejectedByAi ? (
                <>
                  <button disabled={busy === r.id} onClick={() => decide(r.id, 'approve', true)}>
                    القرار خاطئ — انشر الإعلان
                  </button>
                  <span style={{ color: '#9ca3af', fontSize: 13 }}>لم يُنشر بقرار الذكاء الاصطناعي · البائع أُبلغ</span>
                </>
              ) : (
                <span style={{ color: '#9ca3af', fontSize: 13 }}>
                  {{ approved: '✓ تمت الموافقة', removed: r.action === 'deleted' ? 'حذفه البائع' : '✕ غير منشور', error: 'فشل الفحص' }[r.status]}
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
