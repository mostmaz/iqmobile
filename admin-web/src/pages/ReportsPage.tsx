import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface Report {
  id: number;
  reporter_id: number;
  reporter_name: string;
  reporter_phone: string;
  target_kind: string;
  target_id: number;
  reason: string;
  detail: string | null;
  status: string;
  created_at: number;
}

export function ReportsPage() {
  const [rows, setRows] = useState<Report[]>([]);
  const [status, setStatus] = useState('open');

  async function load() {
    const r = await api<Report[]>(`/admin/reports?status=${status}`);
    setRows(r);
  }
  useEffect(() => { load(); }, [status]);

  async function setS(id: number, s: string) {
    await api(`/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status: s }) });
    load();
  }

  return (
    <div>
      <div className="card">
        <h2>Reports</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['open', 'reviewed', 'dismissed'].map((s) => (
            <button key={s} className={status === s ? '' : 'secondary'} onClick={() => setStatus(s)}>{s}</button>
          ))}
        </div>
        <table>
          <thead>
            <tr><th>ID</th><th>Reporter</th><th>Target</th><th>Reason</th><th>Detail</th><th>When</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.reporter_name}<br/><small style={{ color: '#9ca3af' }}>{r.reporter_phone}</small></td>
                <td>{r.target_kind} #{r.target_id}</td>
                <td>{r.reason}</td>
                <td><small>{r.detail || '—'}</small></td>
                <td><small>{new Date(r.created_at).toLocaleString()}</small></td>
                <td>
                  {r.status === 'open' ? (
                    <>
                      <button onClick={() => setS(r.id, 'reviewed')}>Reviewed</button>
                      <button className="secondary" style={{ marginRight: 6 }} onClick={() => setS(r.id, 'dismissed')}>Dismiss</button>
                    </>
                  ) : <small>{r.status}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
