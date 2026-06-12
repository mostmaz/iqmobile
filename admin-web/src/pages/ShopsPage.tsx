// Shops directory management. A shop is a user with seller_type='shop'. Admin
// can flag an account as a shop (find-or-create by phone), edit the shop
// profile, grant a featured window, or revert to an individual account.
// Self-serve registration also exists in the app — those shops show up here too.

import React, { useEffect, useState } from 'react';
import { api } from '../api';

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
  shop_featured_until: number | null;
  listing_count: number;
  is_featured: boolean;
  verified: boolean;
};

const GOVERNORATES = [
  'Baghdad', 'Basra', 'Erbil', 'Sulaymaniyah', 'Duhok', 'Kirkuk', 'Najaf',
  'Karbala', 'Mosul', 'Anbar', 'Babil', 'Diyala', 'Diwaniyah', 'Dhi Qar',
  'Maysan', 'Muthanna', 'Salahuddin', 'Wasit',
];

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();

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

  async function unshop(s: Shop) {
    if (!confirm(`Revert "${s.shop_name || s.display_name}" to a normal (individual) account? It leaves the Shops directory.`)) return;
    setBusy(true);
    try { await api(`/admin/shops/${s.id}/unshop`, { method: 'POST' }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

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
                <th>Shop</th><th>Governorate</th><th>Contact</th><th>Listings</th><th>Featured</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.shop_name || s.display_name}</strong>
                    <div className="muted" style={{ fontSize: 12, fontFamily: 'monospace' }}>#{s.id} · {s.phone || '—'}</div>
                    {s.shop_bio ? <div className="muted" style={{ fontSize: 12 }}>{s.shop_bio}</div> : null}
                  </td>
                  <td>{s.governorate}{s.city ? ` · ${s.city}` : ''}{s.shop_address ? <div className="muted" style={{ fontSize: 12 }}>{s.shop_address}</div> : null}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {s.shop_phone || '—'}{s.shop_whatsapp ? <div>wa: {s.shop_whatsapp}</div> : null}
                  </td>
                  <td>{s.listing_count}</td>
                  <td>
                    {s.is_featured
                      ? <span style={{ color: '#7bd88f' }}>until {s.shop_featured_until ? fmtDate(s.shop_featured_until) : ''}</span>
                      : <span className="muted">no</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className={s.is_featured ? 'secondary' : 'primary'} disabled={busy} onClick={() => feature(s)}>
                      {s.is_featured ? 'Edit feature' : 'Feature'}
                    </button>{' '}
                    <button className="danger" disabled={busy} onClick={() => unshop(s)}>Unshop</button>
                  </td>
                </tr>
              ))}
              {shops.length === 0 ? <tr><td colSpan={6} className="muted">No shops yet.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>

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
          Feature is free to grant for now — set a day count to pin the shop to the top of its governorate.
        </div>
      </div>
    </div>
  );
}
