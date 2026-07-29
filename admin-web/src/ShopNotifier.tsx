import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';

// Polls the server for shops that registered after the last-seen timestamp
// and surfaces a dismissible banner + a count. Sits at the top of the app,
// always mounted while authed.
//
// "Seen" is a shop_created_at watermark kept in localStorage. On first ever
// load we initialise it to "now" so the admin isn't blasted with a notice
// for every historical shop — the feature announces shops that register
// FROM here on. `onGoShops` lets the banner jump to the Shops page.

const SEEN_KEY = 'iq_admin_shops_seen';
const POLL_MS = 25000;

interface RecentShop {
  id: number; shop_name: string | null; display_name: string;
  governorate: string | null; phone: string; shop_created_at: number;
}

export function ShopNotifier({ onGoShops }: { onGoShops: () => void }) {
  const [shops, setShops] = useState<RecentShop[]>([]);
  const seenRef = useRef<number>(0);

  useEffect(() => {
    const stored = Number(localStorage.getItem(SEEN_KEY));
    if (!stored) { seenRef.current = Date.now(); localStorage.setItem(SEEN_KEY, String(seenRef.current)); }
    else seenRef.current = stored;

    let alive = true;
    const poll = async () => {
      try {
        const r = await api<{ shops: RecentShop[]; count: number }>(`/admin/shops/recent?since=${seenRef.current}`);
        if (alive) setShops(r.shops);
      } catch { /* transient — keep whatever we had */ }
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  function markSeen() {
    // Watermark at the newest shop we've shown so those exact rows don't
    // reappear; future registrations (later timestamps) still will.
    const newest = shops.reduce((m, s) => Math.max(m, s.shop_created_at), seenRef.current);
    seenRef.current = newest;
    localStorage.setItem(SEEN_KEY, String(newest));
    setShops([]);
  }

  if (shops.length === 0) return null;

  return (
    <div
      dir="rtl"
      className="card"
      style={{
        borderInlineStart: '3px solid #10b981', background: '#0f2a1f',
        display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 700, color: '#fff', marginBottom: 6 }}>
          🔔 {shops.length === 1 ? 'متجر جديد سجّل' : `${shops.length} متاجر جديدة سجّلت`}
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {shops.slice(0, 6).map((s) => (
            <li key={s.id} style={{ fontSize: 13, color: '#d1d5db' }}>
              <span style={{ color: '#fff' }}>{s.shop_name || s.display_name}</span>
              {s.governorate ? <span className="muted"> · {s.governorate}</span> : null}
              <span className="muted" dir="ltr"> · {s.phone}</span>
              <span className="muted"> · {timeAgo(s.shop_created_at)}</span>
            </li>
          ))}
          {shops.length > 6 ? <li className="muted" style={{ fontSize: 12 }}>+{shops.length - 6} أخرى…</li> : null}
        </ul>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { onGoShops(); markSeen(); }}>عرض المتاجر</button>
        <button className="secondary" onClick={markSeen}>تحديد كمقروء</button>
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  return `قبل ${Math.floor(h / 24)} يوم`;
}
