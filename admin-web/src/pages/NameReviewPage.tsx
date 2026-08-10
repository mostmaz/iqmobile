// Listing names the automatic cleanup wouldn't touch.
//
// The daily pass transliterates Arabic model names and matches them against
// the device catalogue, applying only exact hits. What lands here is the
// residue: ads where the seller typed the whole description into the model
// box, devices the catalogue doesn't know yet, and a few things that aren't
// phones at all.
//
// The transliteration is shown for every row, because the useful question
// isn't "what is this device" — the operator can read the Arabic — it's
// "why didn't the matcher get it", and the token list answers that at a
// glance. A stray untranslated word is a dictionary gap; a clean token run
// with no match is a missing catalogue entry.

import React, { useEffect, useState } from 'react';

import { api } from '../api';

type Row = {
  id: number; brand: string; model: string; status: string;
  asking_price: number; created_at: number; seller_name: string;
  tokens: string; suggestion: string | null; suggested_brand: string | null;
  confidence: string;
};

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');

export function NameReviewPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ total: number; listings: Row[] }>('/admin/listings/name-review');
      setRows(r.listings);
      setErr('');
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function apply(r: Row, model: string, brand?: string | null) {
    const m = model.trim();
    if (!m) { setErr('الاسم فارغ.'); return; }
    setBusy(r.id);
    try {
      const body: any = { model: m };
      if (brand) body.brand = brand;
      await api(`/admin/listings/${r.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setDone((p) => new Set(p).add(r.id));
      setErr('');
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(null); }
  }

  const pending = rows.filter((r) => !done.has(r.id));

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="chart-title" style={{ marginLeft: 'auto' }}>
          أسماء تحتاج مراجعة ({pending.length})
        </div>
        <button className="secondary" onClick={() => { setDone(new Set()); void load(); }}>تحديث</button>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          هذه إعلانات كتب فيها البائع اسم الجهاز بالعربي أو كتب الوصف كامل في خانة الموديل،
          ولم يجد المطابق التلقائي جهازاً مؤكداً في الكتالوج. السطر «التحويل» يبيّن ما فهمه
          النظام — كلمة عربية باقية فيه تعني نقصاً في القاموس، وتحويل نظيف بلا مطابقة يعني
          أن الجهاز غير موجود في كتالوج الأجهزة أصلاً.
        </p>
      </div>

      {loading ? <div className="card">…</div> : !pending.length ? (
        <div className="card"><p className="muted">لا شيء بانتظار المراجعة.</p></div>
      ) : pending.map((r) => (
        <div className="card" key={r.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong>{r.brand}</strong>
            <span style={{ fontSize: 15 }}>{r.model}</span>
            <span className="muted" style={{ fontSize: 12, marginRight: 'auto' }}>
              #{r.id} · {r.seller_name} · {iqd(r.asking_price)} د.ع
            </span>
          </div>

          <div className="muted" style={{ fontSize: 12, marginTop: 6, direction: 'ltr', textAlign: 'right' }}>
            التحويل: {r.tokens || '—'}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {r.suggestion ? (
              <button
                className="primary"
                disabled={busy === r.id}
                onClick={() => apply(r, r.suggestion as string, r.suggested_brand)}
              >
                اعتمد: {r.suggested_brand ? `${r.suggested_brand} ` : ''}{r.suggestion}
              </button>
            ) : null}
            <input
              value={edit[r.id] ?? ''}
              placeholder="أو اكتب الاسم الصحيح…"
              style={{ minWidth: 220 }}
              onChange={(e) => setEdit((p) => ({ ...p, [r.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter' && edit[r.id]) void apply(r, edit[r.id]); }}
            />
            <button
              className="secondary"
              disabled={busy === r.id || !edit[r.id]?.trim()}
              onClick={() => apply(r, edit[r.id])}
            >
              حفظ
            </button>
            <button
              className="secondary"
              disabled={busy === r.id}
              onClick={() => setDone((p) => new Set(p).add(r.id))}
            >
              تخطّي
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
