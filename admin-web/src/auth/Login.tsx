import React, { useState } from 'react';
import { api, setStoredToken } from '../api';

export function Login({ onAuth }: { onAuth: () => void }) {
  const [u, setU] = useState('admin');
  const [p, setP] = useState('admin');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const r = await api<{ token: string }>('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p }),
      });
      setStoredToken(r.token);
      onAuth();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div style={{ maxWidth: 320, margin: '64px auto' }}>
      <div className="card">
        <h2>Admin Login</h2>
        <form onSubmit={submit}>
          <input style={{ width: '100%', marginBottom: 8 }} placeholder="username" value={u} onChange={(e) => setU(e.target.value)} />
          <input style={{ width: '100%', marginBottom: 8 }} type="password" placeholder="password" value={p} onChange={(e) => setP(e.target.value)} />
          {err && <div style={{ color: '#EF4444' }}>{err}</div>}
          <button type="submit" style={{ width: '100%' }}>Login</button>
        </form>
      </div>
    </div>
  );
}
