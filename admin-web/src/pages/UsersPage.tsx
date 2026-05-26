import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface User {
  id: number;
  phone: string;
  display_name: string;
  governorate: string;
  city: string | null;
  rating_avg: number;
  rating_count: number;
  verified: boolean;
  // suspended_at: ms timestamp when the user was suspended, or null
  // when active. Returned by /admin/users since the admin endpoint
  // selects SELECT * from the users table.
  suspended_at: number | null;
  created_at: number;
}

export function UsersPage() {
  const [rows, setRows] = useState<User[]>([]);
  const [q, setQ] = useState('');

  async function load() {
    const r = await api<User[]>('/admin/users' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    setRows(r);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function toggleVerify(u: User) {
    await api(`/admin/users/${u.id}/verify`, { method: 'PATCH', body: JSON.stringify({ verified: !u.verified }) });
    load();
  }

  async function toggleSuspend(u: User) {
    const action = u.suspended_at ? 'unsuspend' : 'suspend';
    if (!confirm(`Are you sure you want to ${action} ${u.display_name || u.phone}?`)) return;
    await api(`/admin/users/${u.id}/suspend`, { method: 'PATCH' });
    load();
  }

  return (
    <div>
      <div className="card">
        <h2>Users</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="search by name or phone" />
          <button onClick={load}>Search</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Phone</th><th>Name</th><th>Loc</th><th>Rating</th><th>Verified</th><th>Status</th><th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} style={u.suspended_at ? { opacity: 0.6 } : undefined}>
                <td>{u.id}</td>
                <td>{u.phone}</td>
                <td>{u.display_name}</td>
                <td>{u.governorate}{u.city ? ` · ${u.city}` : ''}</td>
                <td>{u.rating_count > 0 ? `★ ${u.rating_avg.toFixed(1)} (${u.rating_count})` : '—'}</td>
                <td><button className={u.verified ? '' : 'secondary'} onClick={() => toggleVerify(u)}>{u.verified ? 'Verified' : 'Verify'}</button></td>
                <td>
                  {u.suspended_at ? (
                    <button className="primary" onClick={() => toggleSuspend(u)}>Unsuspend</button>
                  ) : (
                    <button className="danger" onClick={() => toggleSuspend(u)}>Suspend</button>
                  )}
                </td>
                <td><small>{new Date(u.created_at).toLocaleDateString()}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
