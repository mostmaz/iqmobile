// What the storefront card on the app's home screen shows.
//
// The card is the shop's only placement on the home feed, so this page is
// deliberately blunt about what each mode can actually deliver TODAY. "Best
// sellers" sounds great and currently has two products behind it; picking it
// blind would quietly give you one real best seller and two newest, with no
// hint that happened. So every option shows its live count, and the preview
// underneath is the real resolved card, top-ups included.

import React, { useEffect, useMemo, useState } from 'react';

import { api, API_BASE, apiForm } from '../api';

type Mode = 'newest' | 'best_selling' | 'most_viewed' | 'custom' | 'banner';
type Product = {
  id: number; brand: string; model: string;
  storage: string | null; asking_price: number; image_path: string | null;
};
type Candidate = { id: number; brand: string; model: string; asking_price: number };
type Payload = {
  config: { mode: Mode; ids: number[]; image: string | null; title: string | null };
  slots: number;
  counts: { newest: number; best_selling: number; most_viewed: number };
  preview: { mode: Mode; title: string | null; banner_image: string | null; products: Product[]; matched: number; topped_up: number };
  candidates: Candidate[];
};
type Shop = { id: number; shop_name: string | null; display_name: string; shop_orders_enabled: number };

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');

const MODES: Array<{ key: Mode; label: string; hint: string }> = [
  { key: 'newest', label: 'الأحدث', hint: 'آخر ما أضفته للمتجر' },
  { key: 'best_selling', label: 'الأكثر مبيعاً', hint: 'حسب الطلبات المسلَّمة (بدون الملغاة والمرتجعة)' },
  { key: 'most_viewed', label: 'الأكثر مشاهدة', hint: 'حسب مشاهدات آخر ٣٠ يوم' },
  { key: 'custom', label: 'اختيار يدوي', hint: 'تختار أنت الأجهزة الثلاثة' },
  { key: 'banner', label: 'صورة إعلانية', hint: 'صورة واحدة بدل الأجهزة الثلاثة' },
];

export function StoreCardPage() {
  const [shopId, setShopId] = useState<number | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Shop[]>('/admin/shops')
      .then((all) => setShopId(all.filter((s) => s.shop_orders_enabled)[0]?.id ?? null))
      .catch((e) => setErr(String(e?.message || e)));
  }, []);

  async function load(id = shopId) {
    if (!id) return;
    try { setData(await api<Payload>(`/admin/store/${id}/card`)); setErr(''); }
    catch (e: any) { setErr(String(e?.message || e)); }
  }
  useEffect(() => { void load(); }, [shopId]);

  async function save(body: any, note = 'تم الحفظ.') {
    if (!shopId) return;
    setBusy(true);
    try {
      await api(`/admin/store/${shopId}/card`, { method: 'PATCH', body: JSON.stringify(body) });
      await load();
      setMsg(note); setErr('');
      setTimeout(() => setMsg(''), 2500);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  async function uploadBanner(file: File) {
    if (!shopId) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('image', file, file.name);
      await apiForm(`/admin/store/${shopId}/card/image`, fd);
      await save({ mode: 'banner' }, 'تم رفع الصورة وتفعيلها.');
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false); }
  }

  const cfg = data?.config;
  const picked = cfg?.ids || [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = data?.candidates || [];
    return s ? list.filter((c) => `${c.brand} ${c.model}`.toLowerCase().includes(s)) : list.slice(0, 40);
  }, [data, q]);

  function togglePick(id: number) {
    const next = picked.includes(id)
      ? picked.filter((x) => x !== id)
      : [...picked, id].slice(0, data?.slots || 3);
    void save({ mode: 'custom', ids: next }, 'تم تحديث الاختيار.');
  }

  const countFor = (m: Mode) =>
    m === 'newest' || m === 'best_selling' || m === 'most_viewed' ? data?.counts?.[m] : undefined;

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}
      {msg ? <div className="card" style={{ color: '#34C77B', marginBottom: 12 }}>{msg}</div> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-title">بطاقة المتجر في الصفحة الرئيسية</div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          هذه البطاقة هي المكان الوحيد للمتجر في الصفحة الرئيسية للتطبيق. اختر ما تعرضه.
        </p>
      </div>

      {!data ? <div className="card">…</div> : (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
              {MODES.map((m) => {
                const n = countFor(m.key);
                const active = cfg?.mode === m.key;
                // A mode that can't fill the card is still selectable — it
                // just says so, rather than being disabled with no reason.
                const thin = n !== undefined && n < data.slots;
                return (
                  <button
                    key={m.key}
                    className={active ? 'primary' : 'secondary'}
                    disabled={busy}
                    onClick={() => save({ mode: m.key })}
                    style={{ textAlign: 'right', padding: '10px 12px', lineHeight: 1.5 }}
                  >
                    <div style={{ fontWeight: 700 }}>{m.label}</div>
                    <div style={{ fontSize: 11.5, opacity: 0.75 }}>{m.hint}</div>
                    {n !== undefined ? (
                      <div style={{ fontSize: 11.5, marginTop: 2, color: thin ? '#E0A33E' : undefined }}>
                        {n} جهاز متاح{thin ? ` — سيُكمَّل الباقي بالأحدث` : ''}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <label className="muted" style={{ fontSize: 12.5 }}>عنوان البطاقة (اختياري)</label>
              <input
                defaultValue={cfg?.title || ''}
                placeholder="مثال: عروض الأسبوع"
                style={{ minWidth: 220 }}
                disabled={busy}
                onBlur={(e) => { if (e.target.value.trim() !== (cfg?.title || '')) void save({ title: e.target.value }); }}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                يُترك فارغاً ليستخدم عنوان النمط تلقائياً.
              </span>
            </div>
          </div>

          {cfg?.mode === 'banner' ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="chart-title">الصورة الإعلانية</div>
              <p className="muted" style={{ fontSize: 12.5 }}>
                تحل محل الأجهزة الثلاثة. النسبة المفضّلة 16:9، والضغط عليها يفتح المتجر.
              </p>
              {cfg.image ? (
                <img
                  src={API_BASE + cfg.image}
                  alt=""
                  style={{ width: '100%', maxWidth: 460, borderRadius: 10, display: 'block', marginBottom: 10 }}
                />
              ) : (
                <p style={{ color: '#E0A33E', fontSize: 13 }}>
                  لا توجد صورة بعد — البطاقة ستعرض الأجهزة الأحدث حتى ترفع صورة.
                </p>
              )}
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadBanner(f); }}
              />
            </div>
          ) : null}

          {cfg?.mode === 'custom' ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="chart-title">اختر حتى {data.slots} أجهزة</div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث في المتجر…"
                style={{ minWidth: 260, marginBottom: 10 }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 6 }}>
                {filtered.map((c) => {
                  const on = picked.includes(c.id);
                  const order = picked.indexOf(c.id);
                  return (
                    <button
                      key={c.id}
                      className={on ? 'primary' : 'secondary'}
                      disabled={busy || (!on && picked.length >= data.slots)}
                      onClick={() => togglePick(c.id)}
                      style={{ textAlign: 'right' }}
                    >
                      {on ? `${order + 1}. ` : ''}{c.brand} {c.model}
                      <span style={{ opacity: 0.7 }}> · {iqd(c.asking_price)}</span>
                    </button>
                  );
                })}
              </div>
              {picked.length === 0 ? (
                <p style={{ color: '#E0A33E', fontSize: 12.5, marginBottom: 0 }}>
                  لم تختر شيئاً — البطاقة ستعرض الأجهزة الأحدث.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* The real resolved card, so what you see here is what ships. */}
          <div className="card">
            <div className="chart-title">المعاينة</div>
            {data.preview.topped_up > 0 ? (
              <p style={{ color: '#E0A33E', fontSize: 12.5 }}>
                {data.preview.matched} من {data.slots} جاءت من النمط المختار،
                والباقي ({data.preview.topped_up}) أُكمل بالأجهزة الأحدث حتى لا تظهر البطاقة ناقصة.
              </p>
            ) : null}
            {data.preview.banner_image ? (
              <img src={API_BASE + data.preview.banner_image} alt=""
                   style={{ width: '100%', maxWidth: 460, borderRadius: 10 }} />
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.preview.products.map((p) => (
                  <div key={p.id} style={{
                    width: 150, border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10, padding: 8,
                  }}>
                    <div style={{
                      height: 80, borderRadius: 6, background: '#2a2a2a',
                      backgroundImage: p.image_path ? `url(${API_BASE + p.image_path})` : undefined,
                      backgroundSize: 'cover', backgroundPosition: 'center', marginBottom: 6,
                    }} />
                    <div style={{ fontSize: 13 }}>{p.model}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{iqd(p.asking_price)} د.ع</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
