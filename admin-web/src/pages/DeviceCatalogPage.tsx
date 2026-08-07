// Device catalog management — the list that drives the post-listing
// dropdown (~4000 rows seeded from a GSMArena snapshot).
//
// Before this page the only way a device entered the catalog was approving a
// seller's suggestion, so correcting a typo in a seeded name meant editing
// SQLite by hand. Here brand / model / type are all editable, and a device
// can be added outright.
//
// Deactivate is offered before Delete on purpose. Both are safe — nothing has
// a foreign key to device_catalog and listings store their model as free text
// — but deactivating is reversible and hides the device from the picker just
// as effectively, so it's the better default for "this shouldn't be here".

import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Device = {
  id: number;
  brand: string;
  device_type: 'phone' | 'tablet' | 'watch';
  model: string;
  source: string;
  is_active: number;
  created_at: number;
};
type Brand = { id: number; name: string; display_ar: string | null; count: number };

const TYPES: Array<Device['device_type']> = ['phone', 'tablet', 'watch'];
const TYPE_AR: Record<string, string> = { phone: 'هاتف', tablet: 'تابلت', watch: 'ساعة' };
const ALL = '__all__';

const ERRORS: Record<string, string> = {
  duplicate: 'هذا الجهاز موجود مسبقاً بنفس الماركة والنوع.',
  unknown_brand: 'الماركة غير معروفة — أضفها من صفحة الماركات أولاً.',
  brand_required: 'اختر الماركة.',
  model_required: 'اكتب اسم الموديل.',
  bad_device_type: 'نوع الجهاز غير صالح.',
  not_found: 'الجهاز غير موجود (ربما حُذف من نافذة أخرى).',
  no_fields: 'لا يوجد تغيير.',
};
const friendly = (e: any) => ERRORS[e?.message] || e?.message || 'خطأ غير متوقع';

export function DeviceCatalogPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(200);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Filters
  const [q, setQ] = useState('');
  const [fBrand, setFBrand] = useState(ALL);
  const [fType, setFType] = useState<string>('phone');
  const [fActive, setFActive] = useState<'1' | '0' | 'all'>('1');

  // Add form
  const [nBrand, setNBrand] = useState('');
  const [nModel, setNModel] = useState('');
  const [nType, setNType] = useState<Device['device_type']>('phone');

  // Inline edit
  const [editId, setEditId] = useState<number | null>(null);
  const [eBrand, setEBrand] = useState('');
  const [eModel, setEModel] = useState('');
  const [eType, setEType] = useState<Device['device_type']>('phone');

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (fBrand !== ALL) p.set('brand', fBrand);
      if (fType !== ALL) p.set('type', fType);
      p.set('active', fActive);
      p.set('limit', '200');
      const r = await api<{ total: number; limit: number; devices: Device[] }>(
        `/admin/device-catalog?${p.toString()}`);
      setDevices(r.devices);
      setTotal(r.total);
      setLimit(r.limit);
      setErr('');
    } catch (e: any) {
      setErr(friendly(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { api<Brand[]>('/admin/brands').then(setBrands).catch(() => {}); }, []);
  // Debounced so typing in the search box doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [q, fBrand, fType, fActive]);

  async function add() {
    if (busy) return;
    if (!nBrand) { setErr(ERRORS.brand_required); return; }
    if (!nModel.trim()) { setErr(ERRORS.model_required); return; }
    setBusy(true);
    try {
      await api('/admin/device-catalog', {
        method: 'POST',
        body: JSON.stringify({ brand: nBrand, model: nModel.trim(), device_type: nType }),
      });
      setNModel('');
      setErr('');
      await load();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  function startEdit(d: Device) {
    setEditId(d.id);
    setEBrand(d.brand);
    setEModel(d.model);
    setEType(d.device_type);
    setErr('');
  }

  async function saveEdit(d: Device) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/admin/device-catalog/${d.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ brand: eBrand, model: eModel.trim(), device_type: eType }),
      });
      setEditId(null);
      setErr('');
      await load();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  async function toggleActive(d: Device) {
    setBusy(true);
    try {
      await api(`/admin/device-catalog/${d.id}`, {
        method: 'PATCH', body: JSON.stringify({ is_active: d.is_active ? 0 : 1 }),
      });
      await load();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  async function remove(d: Device) {
    if (!confirm(
      `حذف "${d.brand} ${d.model}" نهائياً من قائمة الأجهزة؟\n\n` +
      'الإعلانات المنشورة لن تتأثر — هي تحفظ اسم الموديل كنص. ' +
      'الجهاز فقط لن يظهر في قائمة الاختيار.\n\n' +
      'إذا كنت تريد إخفاءه مؤقتاً فقط، استخدم "تعطيل" بدلاً من الحذف.'
    )) return;
    setBusy(true);
    try {
      await api(`/admin/device-catalog/${d.id}`, { method: 'DELETE' });
      if (editId === d.id) setEditId(null);
      await load();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  const brandOptions = useMemo(
    () => [...brands].sort((a, b) => a.name.localeCompare(b.name)), [brands]);

  const truncated = total > devices.length;

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      {/* Add */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-title">إضافة جهاز</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <select value={nBrand} onChange={(e) => setNBrand(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">— الماركة —</option>
            {brandOptions.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <input
            value={nModel}
            onChange={(e) => setNModel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            placeholder="اسم الموديل — مثال: Galaxy S25 Ultra"
            style={{ minWidth: 260, flex: 1 }}
          />
          <select value={nType} onChange={(e) => setNType(e.target.value as any)}>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_AR[t]}</option>)}
          </select>
          <button className="primary" onClick={add} disabled={busy}>إضافة</button>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          يظهر الجهاز فوراً في قائمة اختيار الأجهزة داخل التطبيق. الماركة يجب أن
          تكون موجودة في صفحة الماركات أولاً.
        </div>
      </div>

      {/* Filters + list */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chart-title" style={{ marginLeft: 'auto' }}>
            الأجهزة ({total.toLocaleString('en-US')})
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالموديل أو الماركة…"
            style={{ minWidth: 220 }}
          />
          <select value={fBrand} onChange={(e) => setFBrand(e.target.value)}>
            <option value={ALL}>كل الماركات</option>
            {brandOptions.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <select value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value={ALL}>كل الأنواع</option>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_AR[t]}</option>)}
          </select>
          <select value={fActive} onChange={(e) => setFActive(e.target.value as any)}>
            <option value="1">المفعّلة</option>
            <option value="0">المعطّلة</option>
            <option value="all">الكل</option>
          </select>
        </div>

        {truncated ? (
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            يعرض {devices.length} من {total.toLocaleString('en-US')} — ضيّق البحث للوصول إلى البقية.
          </div>
        ) : null}

        {loading ? <div className="muted" style={{ marginTop: 12 }}>Loading…</div> : (
          <table className="data-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>الماركة</th>
                <th>الموديل</th>
                <th>النوع</th>
                <th>المصدر</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const editing = editId === d.id;
                return (
                  <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.5 }}>
                    <td>
                      {editing ? (
                        <select value={eBrand} onChange={(e) => setEBrand(e.target.value)}>
                          {brandOptions.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                        </select>
                      ) : d.brand}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          value={eModel}
                          onChange={(e) => setEModel(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(d); }}
                          style={{ minWidth: 220 }}
                          autoFocus
                        />
                      ) : d.model}
                    </td>
                    <td>
                      {editing ? (
                        <select value={eType} onChange={(e) => setEType(e.target.value as any)}>
                          {TYPES.map((t) => <option key={t} value={t}>{TYPE_AR[t]}</option>)}
                        </select>
                      ) : TYPE_AR[d.device_type]}
                    </td>
                    <td><span className="muted">{d.source}</span></td>
                    <td>{d.is_active ? 'مفعّل' : 'معطّل'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {editing ? (
                          <>
                            <button className="primary" onClick={() => saveEdit(d)} disabled={busy}>حفظ</button>
                            <button className="secondary" onClick={() => setEditId(null)} disabled={busy}>إلغاء</button>
                          </>
                        ) : (
                          <>
                            <button className="secondary" onClick={() => startEdit(d)} disabled={busy}>تعديل</button>
                            <button className="secondary" onClick={() => toggleActive(d)} disabled={busy}>
                              {d.is_active ? 'تعطيل' : 'تفعيل'}
                            </button>
                            <button className="secondary" onClick={() => remove(d)} disabled={busy} style={{ color: 'salmon' }}>
                              حذف
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!devices.length ? (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  لا توجد أجهزة مطابقة.
                </td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
