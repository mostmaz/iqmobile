import React, { useState } from 'react';
import { Login } from './auth/Login';
import { getToken, setStoredToken } from './api';
import { ListingsPage } from './pages/ListingsPage';
import { UsersPage } from './pages/UsersPage';
import { ReportsPage } from './pages/ReportsPage';
import { DealsPage } from './pages/DealsPage';
import { BypassAttemptsPage } from './pages/BypassAttemptsPage';
import { SettingsPage } from './pages/SettingsPage';

type Page = 'listings' | 'users' | 'reports' | 'deals' | 'bypass' | 'settings';

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [page, setPage] = useState<Page>('listings');

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;

  const NAV: Array<{ key: Page; label: string }> = [
    { key: 'listings', label: 'Listings' },
    { key: 'users', label: 'Users' },
    { key: 'deals', label: 'Deals' },
    { key: 'reports', label: 'Reports' },
    { key: 'bypass', label: 'Bypass attempts' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>IQ Mobile · Marketplace Admin</h1>
        <button className="secondary" onClick={() => { setStoredToken(null); setAuthed(false); }}>Logout</button>
      </div>
      <div className="nav">
        {NAV.map((n) => (
          <a key={n.key} href="#" className={page === n.key ? 'active' : ''}
             onClick={(e) => { e.preventDefault(); setPage(n.key); }}>
            {n.label}
          </a>
        ))}
      </div>
      {page === 'listings' && <ListingsPage />}
      {page === 'users' && <UsersPage />}
      {page === 'reports' && <ReportsPage />}
      {page === 'deals' && <DealsPage />}
      {page === 'bypass' && <BypassAttemptsPage />}
      {page === 'settings' && <SettingsPage />}
    </div>
  );
}
