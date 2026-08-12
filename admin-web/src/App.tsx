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
import { DailyUsersPage } from './pages/DailyUsersPage';
import { DeviceSuggestionsPage } from './pages/DeviceSuggestionsPage';
import { DeviceCatalogPage } from './pages/DeviceCatalogPage';
import { OrdersPage } from './pages/OrdersPage';
import { StorePage } from './pages/StorePage';
import { StoreOverviewPage } from './pages/StoreOverviewPage';
import { StoreTrafficPage } from './pages/StoreTrafficPage';
import { StoreCustomersPage } from './pages/StoreCustomersPage';
import { StoreFulfilmentPage } from './pages/StoreFulfilmentPage';
import { NameReviewPage } from './pages/NameReviewPage';
import { StoreCardPage } from './pages/StoreCardPage';
import { InspectionPage } from './pages/InspectionPage';
import { AppControlPage } from './pages/AppControlPage';
import { ShopNotifier } from './ShopNotifier';
import { WorkQueue, type Queue } from './WorkQueue';

export type Page =
  | 'overview' | 'users_daily' | 'analytics' | 'brands' | 'banners' | 'featured' | 'shops'
  | 'listings' | 'users' | 'reports' | 'deals' | 'bypass' | 'settings' | 'import'
  | 'devices' | 'device_catalog' | 'inspection' | 'appcontrol' | 'orders' | 'store'
  | 'store_overview' | 'store_traffic' | 'store_customers' | 'store_fulfilment'
  | 'name_review' | 'store_card';

// Nav grouped by what the operator is trying to do, rather than one flat row
// of fifteen equally-weighted links where nothing stands out.
const NAV_GROUPS: Array<{ label: string; items: Array<{ key: Page; label: string; badgeKey?: keyof Queue }> }> = [
  {
    label: 'نظرة عامة',
    items: [
      { key: 'overview', label: 'الرئيسية' },
      // Not "المستخدمون" — the Growth group already has a page by that name
      // for the user table, and two identical labels is a coin toss.
      { key: 'users_daily', label: 'النشاط اليومي' },
      { key: 'analytics', label: 'الطلب والتواصل' },
    ],
  },
  {
    // The storefront is a shop, not a corner of the catalog: running it is
    // one job (stock -> orders -> customers) and it deserves one group.
    label: 'متجر iQ Mobile',
    items: [
      { key: 'store_overview', label: 'أداء المتجر' },
      { key: 'store_traffic', label: 'حركة المتجر' },
      { key: 'store', label: 'المخزون' },
      { key: 'store_card', label: 'بطاقة الرئيسية' },
      { key: 'orders', label: 'الطلبات', badgeKey: 'orders' },
      { key: 'store_fulfilment', label: 'التجهيز' },
      { key: 'store_customers', label: 'الزبائن' },
    ],
  },
  {
    label: 'الإشراف',
    items: [
      { key: 'inspection', label: 'الفحص', badgeKey: 'inspection' },
      { key: 'devices', label: 'الأجهزة المقترحة', badgeKey: 'devices' },
      { key: 'reports', label: 'البلاغات', badgeKey: 'reports' },
      { key: 'bypass', label: 'التحايل' },
    ],
  },
  {
    label: 'الكتالوج',
    items: [
      { key: 'listings', label: 'الإعلانات' },
      { key: 'brands', label: 'الماركات' },
      { key: 'device_catalog', label: 'الأجهزة' },
      { key: 'name_review', label: 'مراجعة الأسماء' },
      { key: 'import', label: 'الاستيراد' },
    ],
  },
  {
    label: 'النمو',
    items: [
      { key: 'shops', label: 'المتاجر' },
      { key: 'banners', label: 'البانرات' },
      { key: 'featured', label: 'الترويج', badgeKey: 'feature_requests' },
      { key: 'users', label: 'المستخدمون' },
      { key: 'deals', label: 'الصفقات' },
    ],
  },
  {
    label: 'الإعداد',
    items: [
      { key: 'settings', label: 'الإعدادات' },
      { key: 'appcontrol', label: 'تحكّم التطبيق' },
    ],
  },
];

const EMPTY_QUEUE: Queue = {
  orders: 0, inspection: 0, inspection_errors: 0, devices: 0,
  reports: 0, feature_requests: 0, new_shops: 0,
};

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [page, setPage] = useState<Page>('overview');
  // Every "someone is waiting on you" count, in one poll. These are work
  // queues, so there is deliberately no dismiss: a count stays up until the
  // work is actually done. Suggestions went unnoticed for weeks precisely
  // because nothing persisted.
  const [queue, setQueue] = useState<Queue>(EMPTY_QUEUE);

  const refreshQueue = useCallback(() => {
    api<Queue>('/admin/work-queue')
      .then(setQueue)
      .catch(() => { /* transient — keep the last known counts */ });
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshQueue();
    const t = setInterval(refreshQueue, 30000);
    return () => clearInterval(t);
  }, [authed, refreshQueue]);

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;

  return (
    <div style={{ maxWidth: 1240, margin: '24px auto', padding: '0 16px' }}>
      <div className="app-header">
        <div className="brand">
          <div className="brand-mark">iQ</div>
          <h1>IQ Mobile · Admin</h1>
        </div>
        <button className="secondary" onClick={() => { setStoredToken(null); setAuthed(false); }}>
          تسجيل الخروج
        </button>
      </div>

      <nav className="nav" dir="rtl">
        {NAV_GROUPS.map((g) => (
          <div className="nav-group" key={g.label}>
            <span className="nav-group-label">{g.label}</span>
            <div className="nav-group-items">
              {g.items.map((n) => {
                const badge = n.badgeKey ? queue[n.badgeKey] : 0;
                return (
                  <a
                    key={n.key}
                    href="#"
                    className={page === n.key ? 'active' : ''}
                    onClick={(e) => { e.preventDefault(); setPage(n.key); }}
                  >
                    {n.label}
                    {badge ? <span className="nav-badge">{badge}</span> : null}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <ShopNotifier onGoShops={() => setPage('shops')} />

      {/* Outstanding work leads the overview, so the first thing on screen is
          what needs a decision rather than a vanity chart. */}
      {page === 'overview' ? <WorkQueue queue={queue} onGo={setPage} /> : null}

      {page === 'overview' && <OverviewPage />}
      {page === 'users_daily' && <DailyUsersPage />}
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
      {page === 'devices' && <DeviceSuggestionsPage onChanged={refreshQueue} />}
      {page === 'device_catalog' && <DeviceCatalogPage />}
      {page === 'orders' && <OrdersPage onChanged={refreshQueue} />}
      {page === 'store' && <StorePage />}
      {page === 'store_overview' && <StoreOverviewPage />}
      {page === 'store_traffic' && <StoreTrafficPage />}
      {page === 'store_customers' && <StoreCustomersPage />}
      {page === 'store_fulfilment' && <StoreFulfilmentPage />}
      {page === 'name_review' && <NameReviewPage />}
      {page === 'store_card' && <StoreCardPage />}
      {page === 'inspection' && <InspectionPage />}
      {page === 'bypass' && <BypassAttemptsPage />}
      {page === 'settings' && <SettingsPage />}
      {page === 'appcontrol' && <AppControlPage />}
    </div>
  );
}
