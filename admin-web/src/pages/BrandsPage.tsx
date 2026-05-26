// Brand catalog management — CRUD UI for the `brands` table.
//
// The dashboard is the only writer; mobile reads from the public
// /brands endpoint cached 5 min. Renaming a brand atomically updates
// every phone_listings row that referenced the old name (server-side
// transaction); deleting is refused if any active listing still uses
// the brand (409 brand_in_use).

import React, { useEffect, useState } from 'react';
import { api } from '../api';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

type Brand = {
  id: number;
  name: string;
  display_ar: string | null;
  position: number;
  count: number;
};

export function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newAr, setNewAr] = useState('');
  const [busy, setBusy] = useState(false);

  // Editing state — when set to a brand id, that row's inputs are live
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editAr, setEditAr] = useState('');
  const [editPos, setEditPos] = useState<number | ''>('');

  async function load() {
    setLoading(true);
    try {
      setBrands(await api<Brand[]>('/admin/brands'));
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await api('/admin/brands', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), display_ar: newAr.trim() || null }),
      });
      setNewName(''); setNewAr('');
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  function startEdit(b: Brand) {
    setEditingId(b.id);
    setEditName(b.name);
    setEditAr(b.display_ar || '');
    setEditPos(b.position);
  }

  async function saveEdit() {
    if (editingId == null) return;
    setBusy(true);
    try {
      await api(`/admin/brands/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          display_ar: editAr.trim() || null,
          position: typeof editPos === 'number' ? editPos : undefined,
        }),
      });
      setEditingId(null);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  async function remove(b: Brand) {
    // Native confirm is fine; this is admin-only.
    if (!confirm(`Delete brand "${b.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/admin/brands/${b.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      if (e.status === 409 && e.data?.error === 'brand_in_use') {
        const n = e.data?.listings ?? '?';
        alert(`Cannot delete "${b.name}" — ${n} active listing(s) still use this brand. Reassign or remove them first.`);
      } else {
        setErr(e.message);
      }
    } finally { setBusy(false); }
  }

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}

      <div className="chart-row">
        <div className="card" style={{ flex: 2 }}>
          <div className="chart-title">Brands ({brands.length})</div>
          {loading ? <div className="muted">Loading…</div> : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Name</th>
                  <th>Arabic display</th>
                  <th>Listings</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => editingId === b.id ? (
                  <tr key={b.id}>
                    <td><input style={{ width: 50 }} type="number" min={1} value={editPos} onChange={(e) => setEditPos(e.target.value === '' ? '' : Number(e.target.value))} /></td>
                    <td><input value={editName} onChange={(e) => setEditName(e.target.value)} /></td>
                    <td><input value={editAr} onChange={(e) => setEditAr(e.target.value)} placeholder="(optional)" /></td>
                    <td>{b.count}</td>
                    <td>
                      <button className="primary" disabled={busy} onClick={saveEdit}>Save</button>{' '}
                      <button className="secondary" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={b.id}>
                    <td>{b.position}</td>
                    <td>{b.name}</td>
                    <td className="muted">{b.display_ar || '—'}</td>
                    <td>{b.count}</td>
                    <td>
                      <button className="secondary" onClick={() => startEdit(b)}>Edit</button>{' '}
                      <button className="danger" onClick={() => remove(b)} disabled={busy}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Add row */}
          <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Brand name (e.g. Sony)" />
            <input value={newAr} onChange={(e) => setNewAr(e.target.value)} placeholder="Arabic (optional)" />
            <button className="primary" onClick={add} disabled={!newName.trim() || busy}>Add brand</button>
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            Name format: 1–30 chars, letters/digits/spaces/.,+,-,/  · matches
            what `phone_listings.brand` stores. Renaming auto-updates every
            existing listing.
          </div>
        </div>

        <div className="card chart-card" style={{ flex: 1 }}>
          <div className="chart-title">By listing count</div>
          {brands.length === 0 ? <div className="empty muted">No brands yet.</div> : (
            <ResponsiveContainer width="100%" height={Math.max(260, brands.length * 28)}>
              <BarChart
                data={[...brands].sort((a, b) => b.count - a.count)}
                layout="vertical"
                margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
              >
                <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#bbb' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#bbb' }} width={80} />
                <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff' }} />
                <Bar dataKey="count" fill="#D9583A" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
