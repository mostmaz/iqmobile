// Promotional banners management — CRUD UI for the `banners` table.
//
// Three surfaces (driven by placement + brand):
//   • home              → injected at slot 2 of the mobile feed
//   • brand, Every brand → shows on any brand-filtered view
//   • brand, <a brand>   → shows only when that brand is filtered
// Each banner is an uploaded image linking to a listing (by id) or an
// external https URL, with an on/off toggle. The image upload goes through
// FormData (the shared api() helper forces a JSON content-type, so create /
// image-replace use a raw fetch instead — same approach as the Import page).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, API_BASE, getToken } from '../api';

type Banner = {
  id: number;
  placement: 'home' | 'brand';
  brand: string | null;
  governorate: string | null;
  image_path: string;
  link_type: 'listing' | 'external';
  link_value: string;
  enabled: number;
  position: number;
  created_at: number;
};
type Brand = { id: number; name: string; display_ar: string | null; position: number; count: number };

const EVERY_BRAND = '__every__';
const ALL_GOV = '__all_gov__';
// Canonical English governorate names — mirror server/src/governorates.js.
const GOVERNORATES = [
  'Baghdad', 'Basra', 'Erbil', 'Sulaymaniyah', 'Duhok', 'Kirkuk', 'Najaf',
  'Karbala', 'Mosul', 'Anbar', 'Babil', 'Diyala', 'Diwaniyah', 'Dhi Qar',
  'Maysan', 'Muthanna', 'Salahuddin', 'Wasit',
];

async function sendForm(path: string, method: string, fd: FormData) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { authorization: `Bearer ${getToken()}` },
    body: fd,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err: any = new Error(data?.error || `http_${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

export function BannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Form state (doubles as add + edit; editingId null = adding).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [placement, setPlacement] = useState<'home' | 'brand'>('home');
  const [brand, setBrand] = useState<string>(EVERY_BRAND);
  const [gov, setGov] = useState<string>(ALL_GOV);
  const [linkType, setLinkType] = useState<'listing' | 'external'>('listing');
  const [linkValue, setLinkValue] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [position, setPosition] = useState<number | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [b, br] = await Promise.all([
        api<Banner[]>('/admin/banners'),
        api<Brand[]>('/admin/brands'),
      ]);
      setBanners(b);
      setBrands(br);
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function resetForm() {
    setEditingId(null);
    setPlacement('home');
    setBrand(EVERY_BRAND);
    setGov(ALL_GOV);
    setLinkType('listing');
    setLinkValue('');
    setEnabled(true);
    setPosition('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function startEdit(b: Banner) {
    setEditingId(b.id);
    setPlacement(b.placement);
    setBrand(b.placement === 'brand' ? (b.brand ?? EVERY_BRAND) : EVERY_BRAND);
    setGov(b.governorate ?? ALL_GOV);
    setLinkType(b.link_type);
    setLinkValue(b.link_value);
    setEnabled(!!b.enabled);
    setPosition(b.position);
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  async function submit() {
    if (busy) return;
    if (!editingId && !file) { setErr('Pick an image for the new banner.'); return; }
    if (!linkValue.trim()) { setErr('Enter a link target.'); return; }
    setBusy(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('placement', placement);
      // brand only matters for the brand placement; EVERY_BRAND → omit (NULL).
      if (placement === 'brand' && brand !== EVERY_BRAND) fd.append('brand', brand);
      else fd.append('brand', '');
      fd.append('governorate', gov === ALL_GOV ? '' : gov);
      fd.append('link_type', linkType);
      fd.append('link_value', linkValue.trim());
      fd.append('enabled', enabled ? '1' : '0');
      if (position !== '') fd.append('position', String(position));
      if (file) fd.append('image', file);

      if (editingId) await sendForm(`/admin/banners/${editingId}`, 'PATCH', fd);
      else await sendForm('/admin/banners', 'POST', fd);

      resetForm();
      await load();
    } catch (e: any) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(b: Banner) {
    setBusy(true);
    try {
      await api(`/admin/banners/${b.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: b.enabled ? 0 : 1 }) });
      await load();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  async function remove(b: Banner) {
    if (!confirm(`Delete this ${b.placement} banner? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/admin/banners/${b.id}`, { method: 'DELETE' });
      if (editingId === b.id) resetForm();
      await load();
    } catch (e: any) { setErr(friendly(e)); } finally { setBusy(false); }
  }

  const placementLabel = (b: Banner) => {
    const base = b.placement === 'home' ? 'Home feed'
      : b.brand ? `Brand · ${b.brand}` : 'Brand · Every brand';
    return `${base}  ·  ${b.governorate || 'All Iraq'}`;
  };

  const sortedBanners = useMemo(
    () => [...banners].sort((a, b) =>
      a.placement.localeCompare(b.placement) || a.position - b.position || a.id - b.id),
    [banners],
  );

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}

      <div className="card">
        <div className="chart-title">Banners ({banners.length})</div>
        {loading ? <div className="muted">Loading…</div> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Placement</th>
                <th>Link</th>
                <th>Pos</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedBanners.map((b) => (
                <tr key={b.id} style={{ opacity: b.enabled ? 1 : 0.5 }}>
                  <td>
                    <img
                      src={API_BASE + b.image_path}
                      alt=""
                      style={{ width: 120, height: 50, objectFit: 'cover', borderRadius: 6, background: '#222' }}
                    />
                  </td>
                  <td>{placementLabel(b)}</td>
                  <td>
                    {b.link_type === 'listing'
                      ? <span className="muted">Listing #{b.link_value}</span>
                      : <a href={b.link_value} target="_blank" rel="noreferrer">{b.link_value}</a>}
                  </td>
                  <td>{b.position}</td>
                  <td>
                    <button className={b.enabled ? 'primary' : 'secondary'} disabled={busy} onClick={() => toggle(b)}>
                      {b.enabled ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td>
                    <button className="secondary" onClick={() => startEdit(b)}>Edit</button>{' '}
                    <button className="danger" disabled={busy} onClick={() => remove(b)}>Delete</button>
                  </td>
                </tr>
              ))}
              {sortedBanners.length === 0 ? (
                <tr><td colSpan={6} className="muted">No banners yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / edit form */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="chart-title">{editingId ? `Edit banner #${editingId}` : 'Add banner'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', maxWidth: 640 }}>
          <label>Placement</label>
          <select value={placement} onChange={(e) => setPlacement(e.target.value as any)}>
            <option value="home">Home feed (slot 2)</option>
            <option value="brand">Brand view</option>
          </select>

          {placement === 'brand' ? (
            <>
              <label>Brand</label>
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value={EVERY_BRAND}>Every brand</option>
                {brands.map((br) => <option key={br.id} value={br.name}>{br.name}</option>)}
              </select>
            </>
          ) : null}

          <label>Governorate</label>
          <select value={gov} onChange={(e) => setGov(e.target.value)}>
            <option value={ALL_GOV}>All governorates</option>
            {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>

          <label>Links to</label>
          <select value={linkType} onChange={(e) => setLinkType(e.target.value as any)}>
            <option value="listing">A listing (by id)</option>
            <option value="external">External website (URL)</option>
          </select>

          <label>{linkType === 'listing' ? 'Listing id' : 'URL'}</label>
          <input
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            placeholder={linkType === 'listing' ? 'e.g. 42' : 'https://example.com/promo'}
          />

          <label>Image {editingId ? '(leave empty to keep)' : ''}</label>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />

          <label>Position</label>
          <input type="number" min={0} value={position} placeholder="(auto)" onChange={(e) => setPosition(e.target.value === '' ? '' : Number(e.target.value))} />

          <label>Enabled</label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ justifySelf: 'start', width: 18, height: 18 }} />
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button className="primary" onClick={submit} disabled={busy}>
            {editingId ? 'Save changes' : 'Add banner'}
          </button>
          {editingId ? <button className="secondary" onClick={resetForm} disabled={busy}>Cancel</button> : null}
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Recommended image ratio ≈ 5:2 (e.g. 1000×400). A listing link opens that
          listing in-app; an external link opens in the browser.
        </div>
      </div>
    </div>
  );
}

function friendly(e: any): string {
  const code = e?.data?.error || e?.message || 'error';
  const map: Record<string, string> = {
    image_required: 'Pick an image file.',
    bad_placement: 'Invalid placement.',
    bad_brand: 'That brand does not exist.',
    bad_link_type: 'Invalid link type.',
    bad_link: 'Invalid link — a listing id must be a number; a URL must start with http(s)://.',
    listing_not_found: 'No listing with that id exists.',
    bad_position: 'Position must be 0 or more.',
    not_found: 'Banner not found (already deleted?).',
  };
  return map[code] || code;
}
