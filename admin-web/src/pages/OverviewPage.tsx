// Dashboard landing page — KPI cards + bar charts + recent activity.
//
// One round-trip to /admin/overview returns everything; we refetch every
// 60s so the operator gets a near-live view without manually reloading.

import React, { useEffect, useState } from 'react';
import { api } from '../api';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

type OverviewData = {
  growth: { tracking_start: number; acquisition: { registrations: number; guests: number }; contact_buyers: number };
  users: { total: number; real: number; guest: number; suspended: number; new_7d: number; new_30d: number };
  listings: { active: number; sold: number; expired: number; removed: number; new_7d: number; new_30d: number };
  by_brand: Array<{ name: string; count: number }>;
  by_governorate: Array<{ name: string; count: number }>;
  by_condition: Array<{ name: string; count: number }>;
  recent_listings: Array<{ id: number; brand: string; model: string; asking_price: number; governorate: string; created_at: number; seller_name: string }>;
  recent_signups: Array<{ id: number; display_name: string; is_guest: boolean; created_at: number }>;
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtIQD(n: number) {
  return new Intl.NumberFormat('en-US').format(n) + ' د.ع';
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [err, setErr] = useState<string>('');

  async function load() {
    try {
      setData(await api<OverviewData>('/admin/overview'));
      setErr('');
    } catch (e: any) {
      setErr(e.message || 'load_failed');
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (err) return <div className="card" style={{ color: 'salmon' }}>Error loading overview: {err}</div>;
  if (!data) return <div className="card">Loading…</div>;



  return (
    <div>
      {/* KPI row */}
      <div className="kpi-row">
        <Kpi label="Registered accounts" value={data.users.real} sub={`${data.users.new_7d} recorded registrations (7d)`} />
        <Kpi label="Guest accounts" value={data.users.guest} sub={`${data.growth.acquisition.guests} recorded guest creations (30d)`} />
        <Kpi label="Active listings" value={data.listings.active} sub={`${data.listings.new_7d} new this week`} />
        <Kpi label="Buyers contacting sellers (30d)" value={data.growth.contact_buyers} sub="Unique accounts across call, WhatsApp and buyer messages" />
      </div>

      <p className="muted">Registration and guest-creation events are recorded from {new Date(data.growth.tracking_start).toLocaleString('en-GB', { timeZone: 'Asia/Baghdad' })} (Baghdad). Earlier event dates are unknown; these counts may cover only part of the selected period. Registered totals include existing/imported accounts. Guest accounts are not sessions or unique people. External contacts require an app version with tracking.</p>
      {/* Charts row */}
      <div className="chart-row">
        <ChartCard title="Listings by brand">
          {data.by_brand.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.by_brand} margin={{ top: 8, right: 8, bottom: 28, left: 4 }}>
                <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#bbb' }} angle={-25} textAnchor="end" interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#bbb' }} />
                <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff' }} />
                <Bar dataKey="count" fill="#D9583A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Listings by governorate">
          {data.by_governorate.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.by_governorate} margin={{ top: 8, right: 8, bottom: 28, left: 4 }}>
                <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#bbb' }} angle={-25} textAnchor="end" interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#bbb' }} />
                <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff' }} />
                <Bar dataKey="count" fill="#5C9EAD" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Activity row */}
      <div className="chart-row">
        <ChartCard title="Recent listings">
          {data.recent_listings.length === 0 ? <Empty /> : (
            <ul className="activity-list">
              {data.recent_listings.map((l) => (
                <li key={l.id}>
                  <strong>{l.brand} {l.model}</strong>
                  <span className="muted"> · {fmtIQD(l.asking_price)} · {l.governorate}</span>
                  <span className="ts">{timeAgo(l.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
        <ChartCard title="Recently created accounts">
          {data.recent_signups.length === 0 ? <Empty /> : (
            <ul className="activity-list">
              {data.recent_signups.map((u) => (
                <li key={u.id}>
                  <strong>{u.display_name}</strong>
                  {u.is_guest ? <span className="muted"> · guest</span> : <span className="muted"> · registered</span>}
                  <span className="ts">{timeAgo(u.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value.toLocaleString('en-US')}</div>
      {sub ? <div className="kpi-sub muted">{sub}</div> : null}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card chart-card">
      <div className="chart-title">{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="empty muted">No data yet.</div>;
}
