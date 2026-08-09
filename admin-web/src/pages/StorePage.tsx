// Storefront inventory management.
//
// The general Listings page is a moderation tool for the whole marketplace —
// find a reported ad, fix a typo, remove it. This page is the opposite job:
// running one shop's stock. So it's scoped to a single storefront, the add
// form is always open (you come here to add products, not to hunt for one),
// and price / availability are one click each.
//
// Only shops with orders enabled appear in the picker: managing "stock" for a
// contact-only shop would imply an ordering flow the app doesn't offer there.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, API_BASE, getToken } from '../api';
import { compressImage, humanSize } from '../lib/imageCompress';

type Shop = {
  id: number; phone: string; display_name: string; shop_name: string | null;
  governorate: string; shop_hidden: number; shop_orders_enabled: number;
  shop_shipping_fee: number; listing_count: number;
};
type Listing = {
  id: number; brand: string; model: string; storage: string | null;
  color: string | null; condition: string; asking_price: number;
  status: string; description: string | null; created_at: number;
  cover_image: string | null; image_count: number;
};
type Brand = { id: number; name: string; display_ar: string | null };

const CONDITIONS = ['new', 'used', 'refurbished', 'repaired'] as const;
const COND_AR: Record<string, string> = {
  new: 'جديد', used: 'مستعمل', refurbished: 'مجدّد', repaired: 'مصلّح',
};
const STATUS_AR: Record<string, string> = {
  active: 'معروض', reserved: 'محجوز', sold: 'مباع', removed: 'محذوف', expired: 'منتهي',
};
const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');

const ERRORS: Record<string, string> = {
  bad_price: 'السعر غير صالح.',
  bad_brand: 'الماركة غير معروفة.',
  missing_fields: 'أكمل الحقول المطلوبة.',
  bad_condition: 'حالة الجهاز غير صالحة.',
  not_found: 'المنتج غير موجود.',
  bad_phone: 'رقم هاتف المتجر غير صالح.',
};
const friendly = (e: any) => ERRORS[e?.message] || e?.message || 'خطأ غير متوقع';

// FormData uploads bypass the shared api() helper, which forces a JSON
// content-type — same approach the Banners and Import pages use.
async function sendForm(path: string, method: string, fd: FormData) {
  const res = await fetch(API_BASE + path, {
    method, headers: { authorization: `Bearer ${getToken()}` }, body: fd,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.error || `http_${res.status}`);
  return data;
}

export function StorePage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | null>(null);
  const [items, setItems] = useState<Listing[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Add form
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const [color, setColor] = useState('');
  const [condition, setCondition] = useState<string>('new');
  const [price, setPrice] = useState('');
  const [desc, setDesc] = useState('');
  const [pics, setPics] = useState<Array<{ blob: Blob; name: string; from: number; to: number; url: string }>>([]);
  const picRef = useRef<HTMLInputElement>(null);

  // Inline price editing
  const [editId, setEditId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState('');

  const shop = useMemo(() => shops.find((s) => s.id === shopId) || null, [shops, shopId]);

  useEffect(() => {
    (async () => {
      try {
        const [all, br] = await Promise.all([api<Shop[]>('/admin/shops'), api<Brand[]>('/admin/brands')]);
        const storefronts = all.filter((s) => s.shop_orders_enabled);
        setShops(storefronts);
        setBrands(br);
        if (storefronts.length && shopId == null) setShopId(storefronts[0].id);
      } catch (e: any) { setErr(friendly(e)); } finally { setLoading(false); }
    })();
  }, []);

  async function loadItems(id: number) {
    setLoading(true);
    try {
      const rows = await api<Listing[]>(`/admin/listings?seller_id=${id}`);
      setItems(rows); setErr('');
    } catch (e: any) { setErr(friendly(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (shopId) loadItems(shopId); }, [shopId]);

  async function pickImages(files: FileList | null) {
    if (!files?.length) return;
    const out: typeof pics = [];
    for (const f of Array.from(files).slice(0, 10)) {
      try {
        const r = await compressImage(f, { maxDim: 1600, quality: 0.85 });
        out.push({ blob: r.blob, name: r.filename, from: f.size, to: r.blob.size, url: URL.createObjectURL(r.blob) });
      } catch {
        out.push({ blob: f, name: f.name, from: f.size, to: f.size, url: URL.createObjectURL(f) });
      }
    }
    setPics((p) => [...p, ...out].slice(0, 10));
  }

  function resetForm() {
    setBrand(''); setModel(''); setStorage(''); setColor('');
    setCondition('new'); setPrice(''); setDesc('');
    pics.forEach((p) => URL.revokeObjectURL(p.url));
    setPics([]);
    if (picRef.current) picRef.current.value = '';
  }

  async function addProduct() {
    if (!shop) return;
    if (!brand) { setErr('اختر الماركة.'); return; }
    if (!model.trim()) { setErr('اكتب اسم الموديل.'); return; }
    if (!(Number(price) > 0)) { setErr('اكتب سعراً صحيحاً.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      // Quick-add keys the seller off the shop's phone, so the product lands
      // on the storefront account rather than creating a new seller.
      const created = await api<{ listing_id: number }>('/admin/listings', {
        method: 'POST',
        body: JSON.stringify({
          phone: shop.phone,
          display_name: shop.shop_name || shop.display_name,
          brand, model: model.trim(),
          storage: storage.trim(), color: color.trim(),
          condition, asking_price: Number(price),
          governorate: shop.governorate,
          description: desc.trim(),
          // A storefront sells through the cart, not the phone — keep the
          // shop's contact suppression consistent on its listings.
          no_contact: true,
        }),
      });
      if (pics.length) {
        const fd = new FormData();
        pics.forEach((p) => fd.append('images', p.blob, p.name));
        await sendForm(`/admin/listings/${created.listing_id}/images`, 'POST', fd);
      }
      setMsg(`تمت إضافة "${brand} ${model.trim()}" للمتجر.`);
      resetForm();
      await loadItems(shop.id);
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  async function patch(l: Listing, body: any) {
    setBusy(true); setErr('');
    try {
      await api(`/admin/listings/${l.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await loadItems(shopId!);
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  async function savePrice(l: Listing) {
    const p = Number(editPrice);
    if (!(p > 0)) { setErr('السعر غير صالح.'); return; }
    setEditId(null);
    await patch(l, { asking_price: p });
  }

  async function remove(l: Listing) {
    if (!confirm(`حذف "${l.brand} ${l.model}" من المتجر؟\n\nالطلبات السابقة لن تتأثر — هي تحفظ اسم الجهاز وسعره وقت الطلب.`)) return;
    setBusy(true);
    try {
      await api(`/admin/listings/${l.id}/remove`, { method: 'PATCH' });
      await loadItems(shopId!);
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  const inStock = items.filter((l) => l.status === 'active');
  const stockValue = inStock.reduce((s, l) => s + l.asking_price, 0);

  if (!loading && !shops.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <div className="chart-title">لا يوجد متجر بيع مباشر</div>
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          فعّل خيار «Orders» لأي متجر من صفحة المتاجر ليظهر هنا.
        </div>
      </div>
    );
  }

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}
      {msg ? <div className="card" style={{ color: '#7bd88f', marginBottom: 12 }}>{msg}</div> : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chart-title" style={{ marginLeft: 'auto' }}>إدارة المتجر</div>
          <select value={shopId ?? ''} onChange={(e) => setShopId(Number(e.target.value))} style={{ minWidth: 180 }}>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.shop_name || s.display_name}</option>)}
          </select>
        </div>
        {shop ? (
          <div className="muted" style={{ marginTop: 8, fontSize: 12.5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span>معروض: <strong>{inStock.length}</strong></span>
            <span>قيمة البضاعة: <strong>{iqd(stockValue)} د.ع</strong></span>
            <span>التوصيل: <strong>{iqd(shop.shop_shipping_fee)} د.ع</strong></span>
            <span>{shop.shop_hidden ? 'مخفي من دليل المتاجر' : 'ظاهر في الدليل'}</span>
          </div>
        ) : null}
      </div>

      {/* Add product */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-title">إضافة منتج</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 10 }}>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">— الماركة —</option>
            {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="الموديل — iPhone 16 Pro" />
          <input value={storage} onChange={(e) => setStorage(e.target.value)} placeholder="الذاكرة — 256GB" />
          <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="اللون — أسود" />
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{COND_AR[c]}</option>)}
          </select>
          <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min={1} placeholder="السعر (د.ع)" />
        </div>
        <textarea
          value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="وصف المنتج (اختياري)"
          style={{ width: '100%', marginTop: 8, minHeight: 60 }}
        />

        <div style={{ marginTop: 8 }}>
          <input ref={picRef} type="file" accept="image/png,image/jpeg,image/webp" multiple
                 onChange={(e) => { void pickImages(e.target.files); }} />
          {pics.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {pics.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={p.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                  <button
                    onClick={() => setPics((arr) => arr.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: 2, left: 2, padding: '0 6px' }}
                  >✕</button>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                {humanSize(pics.reduce((s, p) => s + p.from, 0))} → {humanSize(pics.reduce((s, p) => s + p.to, 0))}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy} onClick={addProduct}>إضافة للمتجر</button>
        </div>
      </div>

      {/* Inventory */}
      <div className="card">
        <div className="chart-title">البضاعة ({items.length})</div>
        {loading ? <div className="muted" style={{ marginTop: 10 }}>Loading…</div> : (
          <table className="data-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>صورة</th><th>المنتج</th><th>الحالة</th><th>السعر</th><th>الوضع</th><th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} style={{ opacity: l.status === 'active' ? 1 : 0.55 }}>
                  <td>
                    {l.cover_image
                      ? <img src={API_BASE + l.cover_image} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
                      : <div style={{ width: 48, height: 48, borderRadius: 6, background: '#2a2a2a' }} />}
                  </td>
                  <td>
                    <div>{l.brand} {l.model}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {[l.storage, l.color].filter(Boolean).join(' · ')} · {l.image_count} صور
                    </div>
                  </td>
                  <td>{COND_AR[l.condition] || l.condition}</td>
                  <td>
                    {editId === l.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} type="number"
                               style={{ width: 110 }} autoFocus
                               onKeyDown={(e) => { if (e.key === 'Enter') void savePrice(l); }} />
                        <button className="primary" disabled={busy} onClick={() => savePrice(l)}>حفظ</button>
                      </div>
                    ) : (
                      <button className="secondary" disabled={busy}
                              onClick={() => { setEditId(l.id); setEditPrice(String(l.asking_price)); }}>
                        {iqd(l.asking_price)} د.ع
                      </button>
                    )}
                  </td>
                  <td>{STATUS_AR[l.status] || l.status}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {l.status === 'active' ? (
                      <button className="secondary" disabled={busy} onClick={() => patch(l, { status: 'sold' })}>
                        نفد
                      </button>
                    ) : (
                      <button className="secondary" disabled={busy} onClick={() => patch(l, { status: 'active' })}>
                        إرجاع للعرض
                      </button>
                    )}{' '}
                    <button className="secondary" disabled={busy} style={{ color: 'salmon' }} onClick={() => remove(l)}>
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  لا توجد منتجات في هذا المتجر بعد.
                </td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
