import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface Bypass {
  id: number;
  chat_id: number;
  user_id: number;
  user_name: string;
  user_phone: string;
  raw_text: string;
  matched_pattern: string | null;
  created_at: number;
}

export function BypassAttemptsPage() {
  const [rows, setRows] = useState<Bypass[]>([]);
  useEffect(() => { api<Bypass[]>('/admin/bypass-attempts').then(setRows); }, []);

  return (
    <div>
      <div className="card">
        <h2>Blocked Phone-Number Attempts</h2>
        <table>
          <thead>
            <tr><th>ID</th><th>User</th><th>Chat</th><th>Original message</th><th>Matched</th><th>When</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.user_name}<br/><small style={{ color: '#9ca3af' }}>{r.user_phone}</small></td>
                <td>#{r.chat_id}</td>
                <td><small>{r.raw_text}</small></td>
                <td><code>{r.matched_pattern || '—'}</code></td>
                <td><small>{new Date(r.created_at).toLocaleString()}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
