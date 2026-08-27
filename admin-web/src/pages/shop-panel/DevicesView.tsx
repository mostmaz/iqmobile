// الأجهزة — inventory management (spec §4, §5, §6, §7).
//
// Desktop renders a TABLE with a checkbox column and inline editing, because
// a shop with 90 devices cannot work through cards; phones keep the card
// list. Both drive the same bulk endpoint. Every bulk action confirms with
// the affected count first and leaves a 30-second undo behind it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../../api';
import {
  T, FONT, shopApi, shopUpload, arNum, money, Card, SectionTitle, Btn, Chip,
  inputStyle, Skeleton, EmptyState, ErrorState, DeviceDiagnostic, UndoToast, useWide,
} from './kit';

type Listing = {
  id: number; brand: string; model: string; storage?: string | null; color?: string | null;
  asking_price: number; status: string; price_on_request?: number; stock_qty?: number | null;
  is_draft?: number; cover?: string | null; created_at: number;
};
type Diag = {
  listing_id: number; views_30d: number; contacts_30d: number; last_contact_at: number | null;
  photo_count: number; price_delta_pct: number | null; reason_code: string | null;
};

const EMPTY_ROW = { brand: '', model: '', storage: '', color: '', asking_price: '', stock_qty: '' };

export function DevicesView({ advanced, sellsNew }: { advanced: boolean; sellsNew: boolean }) {
  const wide = useWide();
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [diag, setDiag] = useState<Record<number, Diag>>({});
  const [gallery, setGallery] = useState<{ id: number; image_path: string }[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'draft' | 'catalog'>('all');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [undo, setUndo] = useState<{ id: number; affected: number; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [entryRows, setEntryRows] = useState([{ ...EMPTY_ROW }]);
  const [entryOpen, setEntryOpen] = useState(false);
  const [xls, setXls] = useState<File | null>(null);
  const [xlsPreview, setXlsPreview] = useState<any | null>(null);
  const [pricesOnly, setPricesOnly] = useState(false);
  const [catalog, setCatalog] = useState<any[] | null>(null);
  const dropRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, g] = await Promise.all([
        shopApi<Listing[]>('/shop-admin/listings'),
        shopApi<{ id: number; image_path: string }[]>('/shop-admin/shop-images'),
      ]);
      setRows(l); setGallery(g); setErr('');
      if (advanced) {
        try {
          const d = await shopApi<Diag[]>('/shop-admin/diagnostics');
          setDiag(Object.fromEntries(d.map((x) => [x.listing_id, x])));
        } catch { /* diagnostics are additive — never block the list */ }
      }
    } catch (e: any) { setErr(e.message); }
  }, [advanced]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab === 'catalog' && catalog === null) {
      shopApi<any[]>('/shop-admin/catalog').then(setCatalog).catch(() => setCatalog([]));
    }
  }, [tab, catalog]);

  const visible = useMemo(() => {
    let list = rows || [];
    list = tab === 'draft' ? list.filter((r) => r.is_draft) : list.filter((r) => !r.is_draft);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((r) => `${r.brand} ${r.model}`.toLowerCase().includes(needle));
    return list;
  }, [rows, tab, q]);

  const draftCount = (rows || []).filter((r) => r.is_draft).length;
  const allSelected = visible.length > 0 && visible.every((r) => sel.has(r.id));
  const toggle = (id: number) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  async function runBulk(action: string, params: any, label: string, confirmText: string) {
    if (!sel.size) return;
    if (!window.confirm(`${confirmText}\n\nالعدد: ${sel.size} جهاز`)) return;
    setBusy(true); setMsg('');
    try {
      const r = await shopApi<any>('/shop-admin/bulk', {
        method: 'POST',
        body: JSON.stringify({ action, listing_ids: [...sel], ...params }),
      });
      setUndo({ id: r.undo_id, affected: r.affected, label });
      setSel(new Set());
      await load();
    } catch (e: any) {
      const m: Record<string, string> = {
        price_too_low: 'السعر الناتج أقل من ١٠٠,٠٠٠ — عدّل النسبة.',
        bad_percent: 'نسبة غير صحيحة.',
        bad_amount: 'مبلغ غير صحيح.',
      };
      setMsg(m[e?.data?.error] || `خطأ: ${e.message}`);
    } finally { setBusy(false); }
  }

  async function doUndo() {
    if (!undo) return;
    try { await shopApi(`/shop-admin/bulk/${undo.id}/undo`, { method: 'POST' }); await load(); setMsg('تم التراجع ✓'); }
    catch { setMsg('انتهت مهلة التراجع.'); }
    setUndo(null);
  }

  async function commitEntry(publish: boolean) {
    const filled = entryRows.filter((r) => r.brand.trim() && r.model.trim());
    if (!filled.length) return;
    setBusy(true);
    try {
      const r = await shopApi<any>('/shop-admin/listings/bulk-add', {
        method: 'POST',
        body: JSON.stringify({ draft: !publish, rows: filled }),
      });
      setMsg(`أُضيف ${arNum(r.created)} جهاز${r.errors?.length ? ` · ${arNum(r.errors.length)} سطر فيه خطأ` : ''}`);
      setEntryRows([{ ...EMPTY_ROW }]);
      setEntryOpen(false);
      await load();
    } catch (e: any) { setMsg(`خطأ: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function uploadImages(listingId: number, files: FileList | File[]) {
    const arr = Array.from(files).slice(0, 10);
    setBusy(true);
    try {
      // Parallel, but capped — ten 5MB uploads at once on a shop's phone
      // connection is slower than four at a time.
      for (let i = 0; i < arr.length; i += 4) {
        await Promise.all(arr.slice(i, i + 4).map((f) => {
          const fd = new FormData(); fd.append('image', f);
          return shopUpload(`/shop-admin/listings/${listingId}/images`, fd);
        }));
      }
      await load();
      setMsg(`رُفعت ${arNum(arr.length)} صورة`);
    } catch { setMsg('تعذّر رفع الصور'); }
    finally { setBusy(false); }
  }

  async function sendSheet(dry: boolean) {
    if (!xls) return;
    setBusy(true); setMsg('');
    try {
      const fd = new FormData(); fd.append('file', xls);
      const res = await fetch(
        `${API_BASE}/shop-admin/import-excel?${dry ? 'dry=1&' : ''}${pricesOnly ? 'prices_only=1' : ''}`,
        { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('iq_shop_token')}` }, body: fd },
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'failed');
      if (dry) setXlsPreview(d);
      else {
        setXlsPreview(null); setXls(null); await load();
        setMsg(`تم: ${arNum(d.updated)} سعر · ${arNum(d.created)} جهاز جديد`);
      }
    } catch (e: any) { setMsg(`خطأ: ${e.message}`); }
    finally { setBusy(false); }
  }

  if (err) return <div style={{ padding: 16 }}><ErrorState error={err} onRetry={load} /></div>;
  if (rows === null) return <div style={{ padding: 16 }}><Skeleton rows={4} /></div>;

  const pad = wide ? 0 : 16;

  return (
    <div style={{ padding: wide ? '0 16px' : 0 }}>
      {msg ? (
        <div style={{ margin: `0 ${pad}px 10px`, font: `600 12.5px ${FONT}`, color: msg.startsWith('خطأ') ? T.red : T.green }}>
          {msg}
        </div>
      ) : null}

      {/* ── entry + import ─────────────────────────────────────────── */}
      <div style={{ margin: `0 ${pad}px` }}>
        <Card>
          <SectionTitle action={
            <Btn kind={entryOpen ? 'ghost' : 'primary'} onClick={() => setEntryOpen(!entryOpen)}>
              {entryOpen ? 'إغلاق' : '+ أضف أجهزة'}
            </Btn>
          }>إضافة أجهزة</SectionTitle>
          {entryOpen ? (
            <>
              {/* Keyboard bulk entry (spec §5): Tab across, Enter adds a row. */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead>
                    <tr style={{ font: `600 11.5px ${FONT}`, color: T.subtle, textAlign: 'right' }}>
                      <th style={{ padding: 6 }}>الماركة</th><th style={{ padding: 6 }}>الموديل</th>
                      <th style={{ padding: 6 }}>السعة</th><th style={{ padding: 6 }}>اللون</th>
                      <th style={{ padding: 6 }}>السعر</th><th style={{ padding: 6 }}>الكمية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entryRows.map((row, i) => (
                      <tr key={i}>
                        {(['brand', 'model', 'storage', 'color', 'asking_price', 'stock_qty'] as const).map((f) => (
                          <td key={f} style={{ padding: 3 }}>
                            <input
                              value={(row as any)[f]}
                              onChange={(e) => setEntryRows((rs) => rs.map((r2, j) => j === i ? { ...r2, [f]: e.target.value } : r2))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (i === entryRows.length - 1) setEntryRows((rs) => [...rs, { ...EMPTY_ROW }]);
                                  const next = (e.currentTarget.closest('tr')?.nextElementSibling
                                    ?.querySelector('input') as HTMLInputElement | null);
                                  setTimeout(() => next?.focus(), 30);
                                }
                              }}
                              style={{ ...inputStyle, padding: '8px 9px', fontSize: 12.5 }}
                              placeholder={f === 'asking_price' ? 'فارغ = اتصل للسعر' : ''}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Btn onClick={() => commitEntry(true)} disabled={busy}>نشر الكل</Btn>
                <Btn kind="ghost" onClick={() => commitEntry(false)} disabled={busy}>حفظ كمسودة</Btn>
                <Btn kind="ghost" onClick={() => setEntryRows((rs) => [...rs, { ...EMPTY_ROW }])}>+ سطر</Btn>
                <span style={{ font: `400 11.5px ${FONT}`, color: T.subtle, alignSelf: 'center' }}>
                  Enter يضيف سطر جديد · المسودة تنشرها بعد ما تضيف الصور
                </span>
              </div>
            </>
          ) : null}
        </Card>

        <Card>
          <SectionTitle>استيراد Excel</SectionTitle>
          <div style={{ font: `400 11.5px ${FONT}`, color: T.subtle, marginBottom: 10 }}>
            الأعمدة: الماركة، الموديل، السعة، اللون، السعر. سطر بدون سعر = «اتصل للسعر». «٦٠٣» تعني ٦٠٣,٠٠٠.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="file" accept=".xlsx,.xls" style={{ font: `400 12px ${FONT}` }}
              onChange={(e) => { setXls(e.target.files?.[0] || null); setXlsPreview(null); }} />
            <label style={{ display: 'flex', gap: 5, alignItems: 'center', font: `400 12px ${FONT}`, color: T.subtle }}>
              <input type="checkbox" checked={pricesOnly} onChange={(e) => { setPricesOnly(e.target.checked); setXlsPreview(null); }} />
              الأسعار فقط
            </label>
            <Btn kind="ghost" disabled={!xls || busy} onClick={() => sendSheet(true)}>معاينة</Btn>
            {xlsPreview ? <Btn disabled={busy} onClick={() => sendSheet(false)}>تنفيذ</Btn> : null}
          </div>
          {xlsPreview ? (
            <div style={{ marginTop: 10, maxHeight: 200, overflowY: 'auto', font: `400 12px ${FONT}`, color: T.subtle }}>
              {(xlsPreview.rows || []).slice(0, 40).map((r2: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${T.line}` }}>
                  <span style={{ color: T.ink, direction: 'ltr' }}>{r2.brand} {r2.model}{r2.storage ? ` · ${r2.storage}` : ''}</span>
                  <span>{r2.action}{r2.preorder ? '' : ` · ${money(r2.price)}`}</span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <SectionTitle action={
            <label style={{ font: `700 12.5px ${FONT}`, color: T.accent, cursor: 'pointer' }}>
              + صور
              <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={async (e) => {
                  const fs = e.target.files; if (!fs?.length) return;
                  setBusy(true);
                  for (const f of Array.from(fs)) {
                    const fd = new FormData(); fd.append('image', f);
                    await shopUpload('/shop-admin/shop-images', fd).catch(() => {});
                  }
                  e.target.value = ''; setBusy(false); load();
                }} />
            </label>
          }>قائمة الأسعار (صور)</SectionTitle>
          {gallery.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {gallery.map((g) => (
                <div key={g.id} style={{ position: 'relative' }}>
                  <img src={`${API_BASE}${g.image_path}`} alt="" style={{ width: 74, height: 92, objectFit: 'cover', borderRadius: 10, border: `1px solid ${T.line}` }} />
                  <button onClick={async () => { if (confirm('حذف الصورة؟')) { await shopApi(`/shop-admin/shop-images/${g.id}`, { method: 'DELETE' }); load(); } }}
                    style={{ position: 'absolute', top: -6, left: -6, width: 20, height: 20, borderRadius: 999, background: T.red, border: 'none', color: '#fff', fontSize: 11, cursor: 'pointer', padding: 0 }}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ font: `400 12px ${FONT}`, color: T.subtle }}>
              الزبون يشوف صور قائمة أسعارك على صفحة متجرك بالتطبيق.
            </div>
          )}
        </Card>
      </div>

      {/* ── filters ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: `0 ${pad}px 10px` }}>
        <Chip label="المعروضة" on={tab === 'all'} onClick={() => { setTab('all'); setSel(new Set()); }} />
        <Chip label="المسودات" count={draftCount} on={tab === 'draft'} onClick={() => { setTab('draft'); setSel(new Set()); }} />
        {sellsNew && advanced ? (
          <Chip label="الأجهزة الجديدة" on={tab === 'catalog'} onClick={() => setTab('catalog')} />
        ) : null}
        <input placeholder="ابحث…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ ...inputStyle, width: 200, marginInlineStart: 'auto' }} />
      </div>

      {/* ── bulk bar ───────────────────────────────────────────────── */}
      {advanced && sel.size > 0 ? (
        <div style={{
          position: 'sticky', top: 0, zIndex: 20, margin: `0 ${pad}px 10px`,
          background: T.ink, borderRadius: 14, padding: '10px 14px',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ font: `700 13px ${FONT}`, color: T.surface }}>
            {arNum(sel.size)} محدد
          </span>
          <Btn kind="ghost" style={{ borderColor: 'rgba(245,240,230,0.3)', color: T.surface }}
            onClick={() => {
              const v = prompt('نسبة التغيير ٪ (مثلاً -10 أو 5):', '-10');
              if (v == null) return;
              runBulk('price_percent', { percent: Number(v) }, `تغيير ${v}٪`, `تغيير السعر ${v}٪ للأجهزة المحددة؟`);
            }}>تغيير ٪</Btn>
          <Btn kind="ghost" style={{ borderColor: 'rgba(245,240,230,0.3)', color: T.surface }}
            onClick={() => {
              const v = prompt('السعر الجديد لكل المحدد:', '');
              if (!v) return;
              runBulk('price_fixed', { amount: Number(v) }, 'سعر موحّد', `تحديد السعر ${v} للأجهزة المحددة؟`);
            }}>سعر موحّد</Btn>
          <Btn kind="ghost" style={{ borderColor: 'rgba(245,240,230,0.3)', color: T.surface }}
            onClick={() => {
              const v = prompt('الكمية بالمخزن:', '0');
              if (v == null) return;
              runBulk('stock_set', { stock_qty: Number(v) }, 'تحديث الكمية', `تحديد الكمية ${v}؟`);
            }}>كمية</Btn>
          <Btn kind="ghost" style={{ borderColor: 'rgba(245,240,230,0.3)', color: T.surface }}
            onClick={() => runBulk('activate', {}, 'تفعيل', 'تفعيل الأجهزة المحددة؟')}>تفعيل</Btn>
          <Btn kind="ghost" style={{ borderColor: 'rgba(245,240,230,0.3)', color: T.surface }}
            onClick={() => runBulk('deactivate', {}, 'إيقاف', 'إيقاف عرض الأجهزة المحددة؟')}>إيقاف</Btn>
          <Btn kind="danger" style={{ color: '#FF9C8F', borderColor: 'rgba(255,156,143,0.35)' }}
            onClick={() => runBulk('delete', {}, 'حذف', 'حذف الأجهزة المحددة من المتجر؟')}>حذف</Btn>
          <Btn kind="ghost" style={{ borderColor: 'rgba(245,240,230,0.3)', color: T.surface }}
            onClick={() => setSel(new Set())}>إلغاء التحديد</Btn>
        </div>
      ) : null}

      {/* ── catalog (new devices) ──────────────────────────────────── */}
      {tab === 'catalog' ? (
        catalog === null ? <Skeleton rows={3} />
          : !catalog.length ? <EmptyState title="ما عندك أجهزة جديدة" body="أضف جهازاً بنفس الموديل بسعات أو ألوان مختلفة وينعرض هنا كمنتج واحد بخيارات." />
            : catalog.map((p: any) => (
              <Card key={`${p.brand}-${p.model}`}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 46, height: 46, borderRadius: 10, background: T.chip, overflow: 'hidden', flexShrink: 0 }}>
                    {p.cover ? <img src={`${API_BASE}${p.cover}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </div>
                  <div style={{ flex: 1, font: `700 14px ${FONT}`, color: T.ink, direction: 'ltr', textAlign: 'right' }}>
                    {p.brand} {p.model}
                  </div>
                  <span style={{ font: `400 12px ${FONT}`, color: T.subtle }}>{arNum(p.variants.length)} خيار</span>
                </div>
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {p.variants.map((v: any) => (
                    <div key={v.id} style={{
                      border: `1px solid ${v.in_stock ? T.line2 : T.redSoft}`, borderRadius: 12,
                      padding: '8px 12px', background: v.in_stock ? '#fff' : T.redSoft,
                      opacity: v.in_stock ? 1 : 0.75,
                    }}>
                      <div style={{ font: `600 12.5px ${FONT}`, color: T.ink }}>
                        {[v.storage, v.color].filter(Boolean).join(' · ') || 'أساسي'}
                      </div>
                      <div style={{ font: `400 11.5px ${FONT}`, color: v.in_stock ? T.green : T.red, marginTop: 3 }}>
                        {v.price_on_request ? 'اتصل للسعر' : `${money(v.asking_price)} د.ع`}
                        {v.stock_qty != null ? ` · ${v.in_stock ? `مخزن ${arNum(v.stock_qty)}` : 'نفد'}` : ''}
                      </div>
                      <button onClick={async () => {
                        const q2 = prompt('الكمية بالمخزن (٠ = نفد):', String(v.stock_qty ?? 0));
                        if (q2 == null) return;
                        await shopApi(`/shop-admin/listings/${v.id}`, { method: 'PATCH', body: JSON.stringify({ stock_qty: Number(q2) }) });
                        setCatalog(null);
                      }} style={{ marginTop: 6, background: 'transparent', border: 'none', cursor: 'pointer', font: `600 11.5px ${FONT}`, color: T.accent, padding: 0 }}>
                        تعديل الكمية
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            ))
      ) : !visible.length ? (
        <div style={{ margin: `0 ${pad}px` }}>
          <EmptyState
            title={tab === 'draft' ? 'ما عندك مسودات' : 'ما عندك أجهزة معروضة'}
            body={tab === 'draft' ? 'المسودة تخليك تضيف الجهاز الآن وتنشره بعد ما تصوّره.' : 'أضف أجهزتك من الأعلى — سطر لكل جهاز، أو استورد ملف Excel.'}
          />
        </div>
      ) : wide ? (
        /* ── DESKTOP TABLE (spec §5) ──────────────────────────────── */
        <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 18, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', font: `400 13px ${FONT}` }}>
            <thead>
              <tr style={{ background: T.chip, color: T.ink, textAlign: 'right' }}>
                {advanced ? (
                  <th style={{ padding: '10px 12px', width: 36 }}>
                    <input type="checkbox" checked={allSelected}
                      onChange={() => setSel(allSelected ? new Set() : new Set(visible.map((r) => r.id)))} />
                  </th>
                ) : null}
                <th style={{ padding: '10px 12px' }}>الجهاز</th>
                <th style={{ padding: '10px 12px' }}>السعر</th>
                <th style={{ padding: '10px 12px' }}>المخزن</th>
                {advanced ? <th style={{ padding: '10px 12px' }}>الأداء</th> : null}
                <th style={{ padding: '10px 12px' }}>صور</th>
                <th style={{ padding: '10px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const d = diag[r.id];
                return (
                  <tr key={r.id}
                    onDragOver={(e) => { e.preventDefault(); dropRef.current = r.id; }}
                    onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) uploadImages(r.id, e.dataTransfer.files); }}
                    style={{ borderTop: `1px solid ${T.line}`, background: sel.has(r.id) ? 'rgba(217,88,58,0.06)' : 'transparent' }}>
                    {advanced ? (
                      <td style={{ padding: '10px 12px' }}>
                        <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                    ) : null}
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div style={{ width: 38, height: 38, borderRadius: 8, background: T.chip, overflow: 'hidden', flexShrink: 0 }}>
                          {r.cover ? <img src={`${API_BASE}${r.cover}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                        </div>
                        <div>
                          <div style={{ font: `600 13px ${FONT}`, color: T.ink, direction: 'ltr', textAlign: 'right' }}>
                            {r.brand} {r.model}{r.storage ? ` · ${r.storage}` : ''}
                          </div>
                          {r.is_draft ? <span style={{ font: `600 10.5px ${FONT}`, color: T.deep }}>مسودة</span> : null}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={async () => {
                        const v = prompt(`سعر ${r.brand} ${r.model}:`, r.price_on_request ? '' : String(r.asking_price));
                        if (!v) return;
                        try { await shopApi(`/shop-admin/listings/${r.id}`, { method: 'PATCH', body: JSON.stringify({ asking_price: Number(v) }) }); load(); }
                        catch (e: any) { setMsg(e?.data?.error === 'price_too_low' ? 'أقل من ١٠٠,٠٠٠' : 'فشل'); }
                      }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: `600 13px ${FONT}`, color: r.price_on_request ? T.deep : T.green, padding: 0 }}>
                        {r.price_on_request ? 'اتصل للسعر' : money(r.asking_price)}
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={async () => {
                        const v = prompt('الكمية:', String(r.stock_qty ?? ''));
                        if (v == null) return;
                        await shopApi(`/shop-admin/listings/${r.id}`, { method: 'PATCH', body: JSON.stringify({ stock_qty: Number(v) }) });
                        load();
                      }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: `400 13px ${FONT}`, color: r.stock_qty === 0 ? T.red : T.subtle, padding: 0 }}>
                        {r.stock_qty == null ? '—' : arNum(r.stock_qty)}
                      </button>
                    </td>
                    {advanced ? (
                      <td style={{ padding: '10px 12px' }}>
                        <DeviceDiagnostic reason={d?.reason_code ?? null} deltaPct={d?.price_delta_pct}
                          photos={d?.photo_count} lastContactAt={d?.last_contact_at} views={d?.views_30d} />
                      </td>
                    ) : null}
                    <td style={{ padding: '10px 12px' }}>
                      <label style={{ font: `600 12px ${FONT}`, color: T.accent, cursor: 'pointer' }}>
                        {d?.photo_count != null ? arNum(d.photo_count) : '+'}
                        <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                          onChange={(e) => { if (e.target.files?.length) uploadImages(r.id, e.target.files); e.target.value = ''; }} />
                      </label>
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {r.is_draft ? (
                        <button onClick={async () => {
                          try { await shopApi(`/shop-admin/listings/${r.id}/publish`, { method: 'POST' }); setMsg('نُشر ✓'); load(); }
                          catch (e: any) { setMsg(e?.data?.error === 'needs_photo' ? 'أضف صورة قبل النشر' : 'تعذّر النشر'); }
                        }} style={{ background: T.accent, border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', font: `700 12px ${FONT}`, cursor: 'pointer' }}>نشر</button>
                      ) : advanced ? (
                        <button onClick={async () => {
                          const st = prompt('السعة للنسخة الجديدة:', r.storage || '');
                          if (st == null) return;
                          await shopApi(`/shop-admin/listings/${r.id}/duplicate`, { method: 'POST', body: JSON.stringify({ storage: st }) });
                          load();
                        }} style={{ background: 'transparent', border: `1px solid ${T.line2}`, borderRadius: 8, padding: '6px 10px', font: `600 12px ${FONT}`, color: T.subtle, cursor: 'pointer' }}>نسخة</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '8px 12px', font: `400 11.5px ${FONT}`, color: T.subtle, borderTop: `1px solid ${T.line}` }}>
            اسحب الصور وأفلتها على سطر الجهاز لرفعها.
          </div>
        </div>
      ) : (
        /* ── PHONE CARDS ──────────────────────────────────────────── */
        visible.map((r) => {
          const d = diag[r.id];
          return (
            <div key={r.id} style={{ margin: '0 16px 10px' }}>
              <Card pad={13} style={{ marginBottom: 0, borderColor: sel.has(r.id) ? T.accent : T.line }}>
                <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
                  {advanced ? (
                    <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                  ) : null}
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: T.chip, overflow: 'hidden', flexShrink: 0 }}>
                    {r.cover ? <img src={`${API_BASE}${r.cover}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: `600 13.5px ${FONT}`, color: T.ink, direction: 'ltr', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.brand} {r.model}{r.storage ? ` · ${r.storage}` : ''}
                    </div>
                    <div style={{ font: `400 12px ${FONT}`, marginTop: 3, color: r.price_on_request ? T.deep : T.green }}>
                      {r.is_draft ? 'مسودة · ' : ''}
                      {r.price_on_request ? 'اتصل للسعر' : `${money(r.asking_price)} د.ع`}
                      {r.stock_qty != null ? ` · مخزن ${arNum(r.stock_qty)}` : ''}
                    </div>
                  </div>
                </div>
                {advanced && d ? (
                  <div style={{ marginTop: 8 }}>
                    <DeviceDiagnostic reason={d.reason_code} deltaPct={d.price_delta_pct}
                      photos={d.photo_count} lastContactAt={d.last_contact_at} views={d.views_30d} />
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  <Btn kind="ghost" style={{ padding: '7px 11px', fontSize: 12 }} onClick={async () => {
                    const v = prompt('السعر:', r.price_on_request ? '' : String(r.asking_price));
                    if (!v) return;
                    try { await shopApi(`/shop-admin/listings/${r.id}`, { method: 'PATCH', body: JSON.stringify({ asking_price: Number(v) }) }); load(); }
                    catch { setMsg('تعذّر التعديل'); }
                  }}>سعر</Btn>
                  <Btn kind="ghost" style={{ padding: '7px 11px', fontSize: 12 }} onClick={async () => {
                    const v = prompt('الكمية:', String(r.stock_qty ?? ''));
                    if (v == null) return;
                    await shopApi(`/shop-admin/listings/${r.id}`, { method: 'PATCH', body: JSON.stringify({ stock_qty: Number(v) }) });
                    load();
                  }}>كمية</Btn>
                  <label style={{ font: `600 12px ${FONT}`, color: T.ink, border: `1px solid ${T.line2}`, borderRadius: 12, padding: '7px 11px', cursor: 'pointer' }}>
                    صور
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={(e) => { if (e.target.files?.length) uploadImages(r.id, e.target.files); e.target.value = ''; }} />
                  </label>
                  {r.is_draft ? (
                    <Btn style={{ padding: '7px 11px', fontSize: 12 }} onClick={async () => {
                      try { await shopApi(`/shop-admin/listings/${r.id}/publish`, { method: 'POST' }); setMsg('نُشر ✓'); load(); }
                      catch (e: any) { setMsg(e?.data?.error === 'needs_photo' ? 'أضف صورة قبل النشر' : 'تعذّر النشر'); }
                    }}>نشر</Btn>
                  ) : null}
                </div>
              </Card>
            </div>
          );
        })
      )}

      <UndoToast undo={undo} onUndo={doUndo} onExpire={() => setUndo(null)} />
    </div>
  );
}
