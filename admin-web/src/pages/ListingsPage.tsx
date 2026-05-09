import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface Listing {
  id: number;
  brand: string;
  model: string;
  asking_price: number;
  status: string;
  governorate: string;
  city: string | null;
  seller_name: string;
  seller_phone: string;
  created_at: number;
}

export function ListingsPage() {
  const [rows, setRows] = useState<Listing[]>([]);
  const [status, setStatus] = useState<string>('');

  async function load() {
    const r = await api<Listing[]>(`/admin/listings${status ? `?status=${status}` : ''}`);
    setRows(r);
  }
  useEffect(() => { load(); }, [status]);

  async function remove(id: number) {
    if (!confirm('Remove this listing?')) return;
    await api(`/admin/listings/${id}/remove`, { method: 'PATCH' });
    load();
  }

  return (
    <div>
      <div className="card">
        <h2>Listings</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['', 'active', 'reserved', 'sold', 'expired', 'removed'].map((s) => (
            <button key={s || 'all'}
              className={status === s ? '' : 'secondary'}
              onClick={() => setStatus(s)}>
              {s || 'All'}
            </button>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Phone</th><th>Seller</th><th>Price</th><th>Loc</th><th>Status</th><th>When</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.brand} {r.model}</td>
                <td>{r.seller_name}<br/><small style={{ color: '#9ca3af' }}>{r.seller_phone}</small></td>
                <td>{r.asking_price.toLocaleString()}</td>
                <td>{r.governorate}{r.city ? ` · ${r.city}` : ''}</td>
                <td><span className="pill open">{r.status}</span></td>
                <td><small>{new Date(r.created_at).toLocaleDateString()}</small></td>
                <td>{r.status !== 'removed' ? <button className="danger" onClick={() => remove(r.id)}>Remove</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
