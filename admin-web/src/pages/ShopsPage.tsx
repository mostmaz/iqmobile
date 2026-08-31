// Shops directory management. A shop is a user with seller_type='shop'. Admin
// can flag an account as a shop (find-or-create by phone), edit the shop
// profile (details, logo, price-list gallery), grant a featured window, or
// revert to an individual account. Self-serve registration also exists in the
// app — those shops show up here too.

import React, { useEffect, useRef, useState } from 'react';
import { api, apiForm, API_BASE } from '../api';

type Shop = {
  id: number;
  phone: string | null;
  display_name: string;
  shop_name: string | null;
  governorate: string;
  city: string | null;
  shop_phone: string | null;
  shop_whatsapp: string | null;
  shop_bio: string | null;
  shop_address: string | null;
  shop_image_path: string | null;
  shop_featured_until: number | null;
  listing_count: number;
  is_featured: boolean;
  verified: boolean;
  // Hidden: kept out of the public Shops directory but still reachable by id
  // (a promo banner deep-link). No-contact: every phone/WhatsApp is stripped
  // from this shop's responses — page and listings alike.
  shop_hidden: number;
  shop_no_contact: number;
  shop_orders_enabled: number;
  shop_cod_enabled: number;
  shop_dash_username?: string | null;
  shop_shipping_fee: number;
};

type ShopDetail = Shop & {
  shop_phones: string[];
  shop_facebook: string | null;
  shop_instagram: string | null;
  shop_images: { id: number; image_path: string; position: number }[];
};

const GOVERNORATES = [
  'Baghdad', 'Basra', 'Erbil', 'Sulaymaniyah', 'Duhok', 'Kirkuk', 'Najaf',
  'Karbala', 'Mosul', 'Anbar', 'Babil', 'Diyala', 'Diwaniyah', 'Dhi Qar',
  'Maysan', 'Muthanna', 'Salahuddin', 'Wasit',
];

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();
const imgUrl = (p?: string | null) => (p ? (p.startsWith('http') ? p : API_BASE + p) : '');

export function ShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Create form
  const [phone, setPhone] = useState('');
  const [shopName, setShopName] = useState('');
  const [gov, setGov] = useState('Baghdad');
  const [shopPhone, setShopPhone] = useState('');
  const [shopWhatsapp, setShopWhatsapp] = useState('');
  const [shopBio, setShopBio] = useState('');
  const [shopAddress, setShopAddress] = useState('');

  // Editor
  const [editingId, setEditingId] = useState<number | null>(null);

  // Governorate sort. Three states on the column header: off → A-Z → Z-A →
  // off. Client-side because the whole directory arrives in one response
  // (~75 shops) — a round trip per click would be slower and would lose the
  // current search.
  const [govSort, setGovSort] = useState<'none' | 'asc' | 'desc'>('none');

  async function load() {
    setLoading(true);
    try {
      setShops(await api<Shop[]>(`/admin/shops${q ? `?q=${encodeURIComponent(q)}` : ''}`));
      setErr('');
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (busy) return;
    if (!phone.trim() || shopName.trim().length < 2) { setErr('Phone + shop name (min 2 chars) required.'); return; }
    setBusy(true); setErr('');
    try {
      await api('/admin/shops', {
        method: 'POST',
        body: JSON.stringify({
          phone: phone.trim(), shop_name: shopName.trim(), governorate: gov,
          shop_phone: shopPhone.trim() || undefined, shop_whatsapp: shopWhatsapp.trim() || undefined,
          shop_bio: shopBio.trim() || undefined, shop_address: shopAddress.trim() || undefined,
        }),
      });
      setPhone(''); setShopName(''); setShopPhone(''); setShopWhatsapp(''); setShopBio(''); setShopAddress('');
      await load();
    } catch (e: any) { setErr(e.data?.error || e.message); } finally { setBusy(false); }
  }

  async function feature(s: Shop) {
    const cur = s.is_featured ? '(currently featured)' : '(not featured)';
    const days = prompt(`Feature "${s.shop_name || s.display_name}" for how many days? ${cur}\nEnter 0 to unfeature.`, '30');
    if (days === null) return;
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0) { setErr('Enter a number ≥ 0.'); return; }
    setBusy(true);
    try { await api(`/admin/shops/${s.id}`, { method: 'PATCH', body: JSON.stringify({ featured_days: n }) }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  // Both flags are plain PATCH toggles. Contact suppression is server-side, so
  // flipping it takes effect on apps already installed from the stores — no
  // release needed.
  async function toggleFlag(s: Shop, flag: 'shop_hidden' | 'shop_no_contact' | 'shop_orders_enabled' | 'shop_cod_enabled') {
    setBusy(true);
    try {
      await api(`/admin/shops/${s.id}`, { method: 'PATCH', body: JSON.stringify({ [flag]: !s[flag] }) });
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  // Merchant-panel login. Prompt-based like featured_days — two questions,
  // one POST. Empty username clears the credentials.
  async function setDashLogin(s2: Shop) {
    const username = prompt(`Merchant login for "${s2.shop_name || s2.display_name}" — username:`, s2.shop_dash_username || '');
    if (username == null) return;
    if (!username.trim()) {
      if (!confirm("Clear this shop's merchant login?")) return;
      await api(`/admin/shops/${s2.id}/dash-credentials`, { method: 'POST', body: JSON.stringify({ username: '', password: '' }) });
      await load(); return;
    }
    const password = prompt('Password (min 6 chars):', '');
    if (!password) return;
    try {
      await api(`/admin/shops/${s2.id}/dash-credentials`, { method: 'POST', body: JSON.stringify({ username: username.trim(), password }) });
      await load();
    } catch (e: any) {
      alert(e?.data?.error === 'username_taken' ? 'Username already used by another shop.' : (e.message || 'failed'));
    }
  }

  async function unshop(s: Shop) {
    if (!confirm(`Revert "${s.shop_name || s.display_name}" to a normal (individual) account? It leaves the Shops directory.`)) return;
    setBusy(true);
    try { await api(`/admin/shops/${s.id}/unshop`, { method: 'POST' }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  // Shops with no governorate sort last in BOTH directions rather than
  // leading the Z-A list — an empty cell is missing data, not a value.
  const shown = govSort === 'none' ? shops : [...shops].sort((a, b) => {
    const ga = (a.governorate || '').trim();
    const gb = (b.governorate || '').trim();
    if (!ga !== !gb) return ga ? -1 : 1;
    const byGov = ga.localeCompare(gb);
    // Ties break on the shop's own name, so a governorate's shops read as a
    // stable alphabetical block instead of an arbitrary one.
    if (byGov) return govSort === 'asc' ? byGov : -byGov;
    return (a.shop_name || a.display_name || '').localeCompare(b.shop_name || b.display_name || '');
  });

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div className="chart-title">Shops ({shops.length})</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input placeholder="search name / phone" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            <button className="secondary" onClick={load}>Search</button>
          </div>
        </div>
        {loading ? <div className="muted">Loading…</div> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Shop</th>
                <th
                  onClick={() => setGovSort((v) => (v === 'none' ? 'asc' : v === 'asc' ? 'desc' : 'none'))}
                  title="Sort by governorate"
                  style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                >
                  Governorate{' '}
                  <span style={{ opacity: govSort === 'none' ? 0.35 : 1 }}>
                    {govSort === 'desc' ? '\u2193' : '\u2191'}
                  </span>
                </th>
                <th>Contact</th><th>Listings</th><th>Featured</th><th>Visibility</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.shop_image_path
                        ? <img src={imgUrl(s.shop_image_path)} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
                        : <div style={{ width: 32, height: 32, borderRadius: 8, background: '#333' }} />}
                      <div>
                        <strong>{s.shop_name || s.display_name}</strong>
                        <div className="muted" style={{ fontSize: 12, fontFamily: 'monospace' }}>#{s.id} · {s.phone || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td>{s.governorate}{s.city ? ` · ${s.city}` : ''}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {s.shop_no_contact ? (
                      // The numbers are still in the DB — say so, so nobody
                      // thinks they were deleted and re-enters them.
                      <span className="muted" title="Numbers kept in the DB, hidden from the app">
                        <s>{s.shop_phone || '—'}</s> · hidden
                      </span>
                    ) : (
                      <>{s.shop_phone || '—'}{s.shop_whatsapp ? <div>wa: {s.shop_whatsapp}</div> : null}</>
                    )}
                  </td>
                  <td>{s.listing_count}</td>
                  <td>
                    {s.is_featured
                      ? <span style={{ color: '#7bd88f' }}>until {s.shop_featured_until ? fmtDate(s.shop_featured_until) : ''}</span>
                      : <span className="muted">no</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}
                           title="Keep out of the public Shops directory (still reachable by a banner deep-link)">
                      <input type="checkbox" disabled={busy} checked={!!s.shop_hidden}
                             onChange={() => toggleFlag(s, 'shop_hidden')} />
                      Hidden
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}
                           title="Strip phone + WhatsApp from the shop page AND all its listings. Applies to apps already installed.">
                      <input type="checkbox" disabled={busy} checked={!!s.shop_no_contact}
                             onChange={() => toggleFlag(s, 'shop_no_contact')} />
                      No contact
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                           title="Storefront mode: this shop's listings get add-to-cart and cash-on-delivery checkout instead of call/WhatsApp.">
                      <input type="checkbox" disabled={busy} checked={!!s.shop_orders_enabled}
                             onChange={() => toggleFlag(s, 'shop_orders_enabled')} />
                      Orders{s.shop_orders_enabled ? ` (${Number(s.shop_shipping_fee || 0).toLocaleString('en-US')} د.ع)` : ''}
                    </label>
                    {s.shop_orders_enabled ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                             title="الدفع عند الاستلام: عند إيقافه يُكتب للزبون أن الدفع يُتفق عليه مع المتجر.">
                        <input type="checkbox" disabled={busy} checked={!!s.shop_cod_enabled}
                               onChange={() => toggleFlag(s, 'shop_cod_enabled')} />
                        COD
                      </label>
                    ) : null}
                    <button className="ghost" disabled={busy} onClick={() => setDashLogin(s)}
                            title="بيانات دخول لوحة التاجر — يشوف طلبات متجره فقط">
                      {s.shop_dash_username ? `لوحة: ${s.shop_dash_username}` : 'إنشاء دخول اللوحة'}
                    </button>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="primary" disabled={busy} onClick={() => setEditingId(editingId === s.id ? null : s.id)}>
                      {editingId === s.id ? 'Close' : 'Edit'}
                    </button>{' '}
                    <button className={s.is_featured ? 'secondary' : 'secondary'} disabled={busy} onClick={() => feature(s)}>
                      {s.is_featured ? 'Feature…' : 'Feature'}
                    </button>{' '}
                    <button className="danger" disabled={busy} onClick={() => unshop(s)}>Unshop</button>
                  </td>
                </tr>
              ))}
              {shops.length === 0 ? <tr><td colSpan={7} className="muted">No shops yet.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>

      {editingId != null ? (
        <ShopEditor
          key={editingId}
          id={editingId}
          onClose={() => setEditingId(null)}
          onChanged={load}
        />
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="chart-title">Add / flag a shop</div>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', maxWidth: 640 }}>
          <label>Account phone *</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxxx (finds or creates the user)" />
          <label>Shop name *</label>
          <input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="متجر ..." />
          <label>Governorate</label>
          <select value={gov} onChange={(e) => setGov(e.target.value)}>
            {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <label>Shop phone</label>
          <input value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} placeholder="(public contact)" />
          <label>Shop WhatsApp</label>
          <input value={shopWhatsapp} onChange={(e) => setShopWhatsapp(e.target.value)} placeholder="(public WhatsApp)" />
          <label>Address</label>
          <input value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} placeholder="street / area" />
          <label>Bio</label>
          <input value={shopBio} onChange={(e) => setShopBio(e.target.value)} placeholder="short description" />
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="primary" onClick={create} disabled={busy}>Add shop</button>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          If the phone already has an account it's converted to a shop; otherwise a new shop account is created.
          Use <strong>Edit</strong> on a row to change details, set the logo, and manage the price-list gallery.
        </div>
      </div>
    </div>
  );
}

// ─── Editor ────────────────────────────────────────────────────────────
function ShopEditor({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<ShopDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState('');
  const [galUrl, setGalUrl] = useState('');
  const logoFileRef = useRef<HTMLInputElement>(null);
  const galFileRef = useRef<HTMLInputElement>(null);

  // Editable text fields
  const [f, setF] = useState({
    shop_name: '', governorate: 'Baghdad', shop_address: '', shop_whatsapp: '',
    shop_facebook: '', shop_instagram: '', shop_bio: '', shop_phones: '',
  });

  async function loadDetail() {
    try {
      const d = await api<ShopDetail>(`/shops/${id}`);
      setDetail(d);
      setF({
        shop_name: d.shop_name || '',
        governorate: d.governorate || 'Baghdad',
        shop_address: d.shop_address || '',
        shop_whatsapp: d.shop_whatsapp || '',
        shop_facebook: d.shop_facebook || '',
        shop_instagram: d.shop_instagram || '',
        shop_bio: d.shop_bio || '',
        shop_phones: (d.shop_phones || []).join(', '),
      });
      setErr('');
    } catch (e: any) { setErr(e.data?.error || e.message); }
  }
  useEffect(() => { loadDetail(); }, [id]);

  async function saveDetails() {
    setBusy(true); setErr(''); setSaved(false);
    try {
      await api(`/admin/shops/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          shop_name: f.shop_name.trim(),
          governorate: f.governorate,
          shop_address: f.shop_address.trim() || null,
          shop_whatsapp: f.shop_whatsapp.trim() || null,
          shop_facebook: f.shop_facebook.trim() || null,
          shop_instagram: f.shop_instagram.trim() || null,
          shop_bio: f.shop_bio.trim() || null,
          shop_phones: f.shop_phones.split(',').map((x) => x.trim()).filter(Boolean),
        }),
      });
      setSaved(true);
      await loadDetail();
      onChanged();
    } catch (e: any) { setErr(e.data?.error || e.message); } finally { setBusy(false); }
  }

  async function run(fn: () => Promise<any>) {
    setBusy(true); setErr('');
    try { await fn(); await loadDetail(); onChanged(); }
    catch (e: any) { setErr(e.data?.error || e.message); } finally { setBusy(false); }
  }

  function uploadLogo(file?: File | null) {
    if (!file) return;
    const fd = new FormData(); fd.append('image', file);
    run(() => apiForm(`/admin/shops/${id}/logo`, fd)).then(() => { if (logoFileRef.current) logoFileRef.current.value = ''; });
  }
  function logoFromUrl() {
    if (!logoUrl.trim()) return;
    run(() => api(`/admin/shops/${id}/ingest-image`, { method: 'POST', body: JSON.stringify({ url: logoUrl.trim(), as: 'logo' }) }))
      .then(() => setLogoUrl(''));
  }
  function addGalleryFiles(files?: FileList | null) {
    if (!files || !files.length) return;
    const fd = new FormData();
    Array.from(files).forEach((file) => fd.append('images', file));
    run(() => apiForm(`/admin/shops/${id}/images`, fd)).then(() => { if (galFileRef.current) galFileRef.current.value = ''; });
  }
  function addGalleryUrl() {
    if (!galUrl.trim()) return;
    run(() => api(`/admin/shops/${id}/ingest-image`, { method: 'POST', body: JSON.stringify({ url: galUrl.trim(), as: 'gallery' }) }))
      .then(() => setGalUrl(''));
  }
  function deleteImage(imgId: number) {
    if (!confirm('Remove this image?')) return;
    run(() => api(`/admin/shops/${id}/images/${imgId}`, { method: 'DELETE' }));
  }

  const lbl: React.CSSProperties = { alignSelf: 'center' };
  const gallery = detail?.shop_images || [];

  return (
    <div className="card" style={{ marginTop: 16, borderColor: '#4a7' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="chart-title">Editing: {detail?.shop_name || `#${id}`} <span className="muted" style={{ fontFamily: 'monospace' }}>#{id}</span></div>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      {err ? <div style={{ color: 'salmon', margin: '8px 0' }}>Error: {err}</div> : null}
      {saved ? <div style={{ color: '#7bd88f', margin: '8px 0' }}>Saved ✓</div> : null}
      {!detail ? <div className="muted">Loading…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 10 }}>
          {/* Details */}
          <div>
            <div className="chart-title" style={{ fontSize: 14 }}>Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 8, alignItems: 'center' }}>
              <label style={lbl}>Shop name</label>
              <input value={f.shop_name} onChange={(e) => setF({ ...f, shop_name: e.target.value })} />
              <label style={lbl}>Governorate</label>
              <select value={f.governorate} onChange={(e) => setF({ ...f, governorate: e.target.value })}>
                {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <label style={lbl}>Phones</label>
              <input value={f.shop_phones} onChange={(e) => setF({ ...f, shop_phones: e.target.value })} placeholder="comma-separated branch numbers" />
              <label style={lbl}>WhatsApp</label>
              <input value={f.shop_whatsapp} onChange={(e) => setF({ ...f, shop_whatsapp: e.target.value })} />
              <label style={lbl}>Address</label>
              <input value={f.shop_address} onChange={(e) => setF({ ...f, shop_address: e.target.value })} />
              <label style={lbl}>Facebook</label>
              <input value={f.shop_facebook} onChange={(e) => setF({ ...f, shop_facebook: e.target.value })} placeholder="https://facebook.com/…" />
              <label style={lbl}>Instagram</label>
              <input value={f.shop_instagram} onChange={(e) => setF({ ...f, shop_instagram: e.target.value })} placeholder="https://instagram.com/…" />
              <label style={lbl}>Bio</label>
              <textarea value={f.shop_bio} onChange={(e) => setF({ ...f, shop_bio: e.target.value })} rows={3} />
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="primary" onClick={saveDetails} disabled={busy}>Save details</button>
            </div>
          </div>

          {/* Media */}
          <div>
            <div className="chart-title" style={{ fontSize: 14 }}>Logo</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {detail.shop_image_path
                ? <img src={imgUrl(detail.shop_image_path)} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover' }} />
                : <div style={{ width: 64, height: 64, borderRadius: 10, background: '#333', display: 'grid', placeItems: 'center', fontSize: 11 }} className="muted">no logo</div>}
              <div style={{ display: 'grid', gap: 6 }}>
                <input ref={logoFileRef} type="file" accept="image/*" disabled={busy} onChange={(e) => uploadLogo(e.target.files?.[0])} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="…or paste image URL" style={{ flex: 1 }} />
                  <button className="secondary" disabled={busy || !logoUrl.trim()} onClick={logoFromUrl}>Set</button>
                </div>
              </div>
            </div>

            <div className="chart-title" style={{ fontSize: 14, marginTop: 16 }}>Price-list gallery ({gallery.length}/20)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {gallery.map((im) => (
                <div key={im.id} style={{ position: 'relative' }}>
                  <img src={imgUrl(im.image_path)} alt="" style={{ width: 76, height: 76, borderRadius: 8, objectFit: 'cover' }} />
                  <button
                    className="danger"
                    title="Remove"
                    disabled={busy}
                    onClick={() => deleteImage(im.id)}
                    style={{ position: 'absolute', top: -6, right: -6, borderRadius: 999, width: 22, height: 22, padding: 0, lineHeight: '1' }}
                  >×</button>
                </div>
              ))}
              {gallery.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No gallery images yet.</div> : null}
            </div>
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <input ref={galFileRef} type="file" accept="image/*" multiple disabled={busy || gallery.length >= 20} onChange={(e) => addGalleryFiles(e.target.files)} />
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={galUrl} onChange={(e) => setGalUrl(e.target.value)} placeholder="…or paste image URL" style={{ flex: 1 }} disabled={gallery.length >= 20} />
                <button className="secondary" disabled={busy || !galUrl.trim() || gallery.length >= 20} onClick={addGalleryUrl}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
