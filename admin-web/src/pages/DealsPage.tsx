import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface Deal {
  id: number;
  brand: string; model: string;
  buyer_name: string; seller_name: string;
  final_price: number; status: string;
  created_at: number; updated_at: number;
}

export function DealsPage() {
  const [rows, setRows] = useState<Deal[]>([]);
  const [status, setStatus] = useState('seller_confirmed');

  async function load() {
    const r = await api<Deal[]>(`/admin/deals?status=${status}`);
    setRows(r);
  }
  useEffect(() => { load(); }, [status]);

  return (
    <div>
      <div className="card">
        <h2>Deals</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {['seller_confirmed', 'buyer_accepted', 'proposed', 'rejected', 'cancelled', 'expired'].map((s) => (
            <button key={s} className={status === s ? '' : 'secondary'} onClick={() => setStatus(s)}>{s}</button>
          ))}
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>Phone</th><th>Buyer</th><th>Seller</th><th>Price</th><th>Status</th><th>When</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.brand} {r.model}</td>
                <td>{r.buyer_name}</td>
                <td>{r.seller_name}</td>
                <td>{r.final_price.toLocaleString()}</td>
                <td><span className="pill open">{r.status}</span></td>
                <td><small>{new Date(r.updated_at).toLocaleString()}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
