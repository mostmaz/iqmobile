import React, { useState } from 'react';
import { Login } from './auth/Login';
import { getToken, setStoredToken } from './api';
import { OverviewPage } from './pages/OverviewPage';
import { BrandsPage } from './pages/BrandsPage';
import { BannersPage } from './pages/BannersPage';
import { ListingsPage } from './pages/ListingsPage';
import { UsersPage } from './pages/UsersPage';
import { ReportsPage } from './pages/ReportsPage';
import { DealsPage } from './pages/DealsPage';
import { BypassAttemptsPage } from './pages/BypassAttemptsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportPage } from './pages/ImportPage';
import { FeatureRequestsPage } from './pages/FeatureRequestsPage';
import { ShopsPage } from './pages/ShopsPage';

type Page =
  | 'overview' | 'brands' | 'banners' | 'featured' | 'shops' | 'listings'
  | 'users' | 'reports' | 'deals' | 'bypass' | 'settings' | 'import';

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  // Default landing is the Overview page (KPIs + charts). Operators
  // appreciate the snapshot before diving into individual tables.
  const [page, setPage] = useState<Page>('overview');

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;

  const NAV: Array<{ key: Page; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'brands', label: 'Brands' },
    { key: 'banners', label: 'Banners' },
    { key: 'featured', label: 'Featured' },
    { key: 'shops', label: 'Shops' },
    { key: 'listings', label: 'Listings' },
    { key: 'users', label: 'Users' },
    { key: 'deals', label: 'Deals' },
    { key: 'reports', label: 'Reports' },
    { key: 'import', label: 'Import' },
    { key: 'bypass', label: 'Bypass attempts' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px' }}>
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
      {page === 'overview' && <OverviewPage />}
      {page === 'brands' && <BrandsPage />}
      {page === 'banners' && <BannersPage />}
      {page === 'featured' && <FeatureRequestsPage />}
      {page === 'shops' && <ShopsPage />}
      {page === 'listings' && <ListingsPage />}
      {page === 'users' && <UsersPage />}
      {page === 'reports' && <ReportsPage />}
      {page === 'deals' && <DealsPage />}
      {page === 'import' && <ImportPage />}
      {page === 'bypass' && <BypassAttemptsPage />}
      {page === 'settings' && <SettingsPage />}
    </div>
  );
}
