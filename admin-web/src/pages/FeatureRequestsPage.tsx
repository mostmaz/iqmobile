// Featured-listing requests. Sellers transfer airtime to the owner's number
// and file a request from the app; here the owner reconciles the transfer and
// approves (which pins the listing) or rejects it.

import React, { useEffect, useState } from 'react';
import { api, API_BASE } from '../api';

type FeatureRequest = {
  id: number;
  listing_id: number;
  user_id: number;
  tier: string;
  amount: number;
  days: number;
  boosts_per_day: number;
  carrier: string;
  sender_phone: string | null;
  sender_name: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  reviewed_at: number | null;
  brand: string;
  model: string;
  asking_price: number;
  governorate: string;
  featured_until: number | null;
  user_name: string;
  user_phone: string | null;
  cover_image: string | null;
};

const fmtIQD = (n: number) => new Intl.NumberFormat('en-US').format(n) + ' IQD';
const fmtDate = (ms: number) => new Date(ms).toLocaleString();

export function FeatureRequestsPage() {
  const [rows, setRows] = useState<FeatureRequest[]>([]);
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    try {
      setRows(await api<FeatureRequest[]>(`/admin/feature-requests?status=${status}`));
      setErr('');
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  async function approve(f: FeatureRequest) {
    if (!confirm(`Approve "${f.brand} ${f.model}" — ${tierLabel(f)}?\nConfirm you received ${fmtIQD(f.amount)} from ${f.sender_name || f.sender_phone || '—'} (${f.carrier}).`)) return;
    setBusy(true);
    try { await api(`/admin/feature-requests/${f.id}/approve`, { method: 'POST' }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function reject(f: FeatureRequest) {
    if (!confirm(`Reject this request for "${f.brand} ${f.model}"? The seller is notified.`)) return;
    setBusy(true);
    try { await api(`/admin/feature-requests/${f.id}/reject`, { method: 'POST' }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="chart-title">Featured requests ({rows.length})</div>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          No payment gateway — the seller sends airtime to your number, then submits this.
          Reconcile the transfer (amount + sender number + carrier), then Approve to pin the listing.
        </div>
        {loading ? <div className="muted">Loading…</div> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Listing</th>
                <th>Tier</th>
                <th>Paid via</th>
                <th>Sender</th>
                <th>Seller</th>
                <th>Submitted</th>
                {status === 'pending' ? <th>Actions</th> : <th>Reviewed</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <a href={`https://iqmobile.org/l/${f.listing_id}`} target="_blank" rel="noreferrer"
                        style={{ display: 'contents', color: 'inherit', textDecoration: 'none' }}>
                      {f.cover_image ? (
                        <img src={`${API_BASE}${f.cover_image}`} alt=""
                          style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                      ) : null}
                      <div>
                    <strong style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>#{f.listing_id} · {f.brand} {f.model}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{fmtIQD(f.asking_price)} · {f.governorate}</div>
                    {f.note ? <div className="muted" style={{ fontSize: 12 }}>“{f.note}”</div> : null}
                    {f.featured_until && f.featured_until > Date.now()
                      ? <div style={{ color: '#7bd88f', fontSize: 12 }}>featured until {fmtDate(f.featured_until)}</div> : null}
                      </div>
                      </a>
                    </div>
                  </td>
                  <td>{tierLabel(f)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{f.carrier}</td>
                  <td style={{ fontFamily: 'monospace' }}>{f.sender_name || f.sender_phone || '—'}</td>
                  <td>{f.user_name}<div className="muted" style={{ fontSize: 12, fontFamily: 'monospace' }}>{f.user_phone || '—'}</div></td>
                  <td className="muted" style={{ fontSize: 12 }}>{fmtDate(f.created_at)}</td>
                  {status === 'pending' ? (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="primary" disabled={busy} onClick={() => approve(f)}>Approve</button>{' '}
                      <button className="danger" disabled={busy} onClick={() => reject(f)}>Reject</button>
                    </td>
                  ) : (
                    <td className="muted" style={{ fontSize: 12 }}>{f.reviewed_at ? fmtDate(f.reviewed_at) : '—'}</td>
                  )}
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={7} className="muted">No {status} requests.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function tierLabel(f: FeatureRequest): string {
  const cap = f.tier.charAt(0).toUpperCase() + f.tier.slice(1);
  return `${cap} · ${fmtIQD(f.amount)} · ${f.days}d · ${f.boosts_per_day}×/day`;
}
