import React, { useCallback, useEffect, useState } from 'react';
import { Login } from './auth/Login';
import { api, getToken, setStoredToken } from './api';
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
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DeviceSuggestionsPage } from './pages/DeviceSuggestionsPage';
import { InspectionPage } from './pages/InspectionPage';
import { ShopNotifier } from './ShopNotifier';

type Page =
  | 'overview' | 'analytics' | 'brands' | 'banners' | 'featured' | 'shops' | 'listings'
  | 'users' | 'reports' | 'deals' | 'bypass' | 'settings' | 'import' | 'devices' | 'inspection';

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  // Default landing is the Overview page (KPIs + charts). Operators
  // appreciate the snapshot before diving into individual tables.
  const [page, setPage] = useState<Page>('overview');
  // Pending device suggestions. Unlike ShopNotifier's "new shop registered"
  // notice, this is a WORK QUEUE, so there is deliberately no dismiss/seen
  // watermark: the count stays up until the queue is actually cleared.
  // Otherwise suggestions go unnoticed, which is exactly what happened before.
  const [pendingDevices, setPendingDevices] = useState(0);

  const refreshDeviceCount = useCallback(() => {
    api<{ pending: number }>('/admin/device-suggestions/count')
      .then((r) => setPendingDevices(r.pending))
      .catch(() => { /* transient — keep the last known count */ });
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshDeviceCount();
    const t = setInterval(refreshDeviceCount, 30000);
    return () => clearInterval(t);
  }, [authed, refreshDeviceCount]);

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;

  const NAV: Array<{ key: Page; label: string; badge?: number }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'analytics', label: 'التحليلات' },
    { key: 'brands', label: 'Brands' },
    { key: 'banners', label: 'Banners' },
    { key: 'featured', label: 'Featured' },
    { key: 'shops', label: 'Shops' },
    { key: 'listings', label: 'Listings' },
    { key: 'users', label: 'Users' },
    { key: 'deals', label: 'Deals' },
    { key: 'reports', label: 'Reports' },
    { key: 'import', label: 'Import' },
    { key: 'devices', label: 'الأجهزة المقترحة', badge: pendingDevices },
    { key: 'inspection', label: 'الفحص' },
    { key: 'bypass', label: 'Bypass attempts' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>IQ Mobile · Marketplace Admin</h1>
        <button className="secondary" onClick={() => { setStoredToken(null); setAuthed(false); }}>Logout</button>
      </div>
      <ShopNotifier onGoShops={() => setPage('shops')} />
      {pendingDevices > 0 && page !== 'devices' ? (
        <div
          dir="rtl"
          className="card"
          style={{
            borderInlineStart: '3px solid #f59e0b', background: '#2a220f',
            display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
          }}
        >
          <div style={{ color: '#fff', fontWeight: 700 }}>
            📱 {pendingDevices === 1
              ? 'جهاز واحد اقترحه بائع وينتظر الإضافة إلى القائمة'
              : `${pendingDevices} أجهزة اقترحها البائعون وتنتظر الإضافة إلى القائمة`}
          </div>
          <button onClick={() => setPage('devices')}>مراجعتها</button>
        </div>
      ) : null}
      <div className="nav">
        {NAV.map((n) => (
          <a key={n.key} href="#" className={page === n.key ? 'active' : ''}
             onClick={(e) => { e.preventDefault(); setPage(n.key); }}>
            {n.label}
            {n.badge ? (
              <span style={{
                background: '#f59e0b', color: '#1b1a18', fontSize: 11, fontWeight: 800,
                borderRadius: 999, padding: '1px 6px', marginInlineStart: 6, verticalAlign: 'middle',
              }}>{n.badge}</span>
            ) : null}
          </a>
        ))}
      </div>
      {page === 'overview' && <OverviewPage />}
      {page === 'analytics' && <AnalyticsPage />}
      {page === 'brands' && <BrandsPage />}
      {page === 'banners' && <BannersPage />}
      {page === 'featured' && <FeatureRequestsPage />}
      {page === 'shops' && <ShopsPage />}
      {page === 'listings' && <ListingsPage />}
      {page === 'users' && <UsersPage />}
      {page === 'reports' && <ReportsPage />}
      {page === 'deals' && <DealsPage />}
      {page === 'import' && <ImportPage />}
      {/* onChanged drops the badge the moment a suggestion is actioned,
          instead of leaving a stale count until the next 30s poll. */}
      {page === 'devices' && <DeviceSuggestionsPage onChanged={refreshDeviceCount} />}
      {page === 'inspection' && <InspectionPage />}
      {page === 'bypass' && <BypassAttemptsPage />}
      {page === 'settings' && <SettingsPage />}
    </div>
  );
}
