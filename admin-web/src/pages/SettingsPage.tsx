import React, { useEffect, useState } from 'react';
import { api } from '../api';

export function SettingsPage() {
  const [ttl, setTtl] = useState<string>('30');
  const [reserveOnConfirm, setReserveOnConfirm] = useState<boolean>(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<{ listing_ttl_days: number; reserve_on_confirm: boolean }>('/admin/settings').then((s) => {
      setTtl(String(s.listing_ttl_days));
      setReserveOnConfirm(s.reserve_on_confirm);
    });
  }, []);

  async function save() {
    await api('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ listing_ttl_days: Number(ttl), reserve_on_confirm: reserveOnConfirm }),
    });
    setMsg('Saved'); setTimeout(() => setMsg(''), 1500);
  }

  return (
    <div>
      <div className="card">
        <h2>Settings</h2>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', marginBottom: 6, color: '#9ca3af' }}>Listing expiry (days)</label>
          <input type="number" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={reserveOnConfirm} onChange={(e) => setReserveOnConfirm(e.target.checked)} />
            On seller confirm: mark listing as <strong>reserved</strong> (else <strong>sold</strong>)
          </label>
        </div>
        <button onClick={save}>Save</button>
        {msg ? <span style={{ marginRight: 12, color: '#10b981' }}>{msg}</span> : null}
      </div>
    </div>
  );
}
