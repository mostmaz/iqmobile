import React from 'react';
import type { Page } from './App';

// The row of "someone is waiting on you" tiles at the top of the overview.
//
// Every tile is clickable and lands on the page that clears it — a count you
// can't act on from where you're reading it just becomes noise. Tiles with
// nothing pending stay visible but dimmed rather than disappearing, so the
// row doesn't reflow under the cursor as counts change, and so "nothing to
// review" is a statement rather than an absence.

export type Queue = {
  orders: number;
  videos: number;
  dup_photos: number;
  inspection: number;
  inspection_errors: number;
  devices: number;
  reports: number;
  feature_requests: number;
  new_shops: number;
  tier_requests: number;
};

type Tile = { key: keyof Queue; label: string; page: Page; icon: string };

const TILES: Tile[] = [
  // Orders lead: a COD customer is waiting on a phone call.
  { key: 'orders', label: 'طلبات جديدة', page: 'orders', icon: '🛒' },
  { key: 'videos', label: 'فيديوهات بانتظار الموافقة', page: 'videos', icon: '🎬' },
  { key: 'dup_photos', label: 'صور مكررة عبر بائعين', page: 'dup_photos', icon: '🕵️' },
  { key: 'inspection', label: 'إعلانات بانتظار الفحص', page: 'inspection', icon: '🔍' },
  { key: 'devices', label: 'أجهزة مقترحة', page: 'devices', icon: '📱' },
  { key: 'reports', label: 'بلاغات مفتوحة', page: 'reports', icon: '🚩' },
  { key: 'feature_requests', label: 'طلبات ترويج', page: 'featured', icon: '⭐' },
  { key: 'new_shops', label: 'متاجر بانتظار المراجعة', page: 'shop_review', icon: '🏪' },
  { key: 'tier_requests', label: 'طلبات ترقية لوحة', page: 'tier_requests', icon: '⚙️' },
];

export function WorkQueue({ queue, onGo }: { queue: Queue; onGo: (p: Page) => void }) {
  const total = TILES.reduce((s, t) => s + (queue[t.key] || 0), 0);

  return (
    <div dir="rtl">
      <div className="queue-row">
        {TILES.map((t) => {
          const n = queue[t.key] || 0;
          return (
            <button
              key={t.key}
              className={`queue-tile ${n > 0 ? 'has-work' : 'is-clear'}`}
              onClick={() => onGo(t.page)}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>{t.icon}</span>
              <span>
                <span className="queue-n">{n}</span>
                <span className="queue-label" style={{ display: 'block', marginTop: 3 }}>{t.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* The inspection error count is separate from its queue: these are
          listings the API failed on, not listings a human must judge. They
          would otherwise look like a healthy empty queue. */}
      {queue.inspection_errors > 0 ? (
        <div className="card" style={{ borderInlineStart: '3px solid var(--danger)' }}>
          <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
            {queue.inspection_errors} فحص فشل
          </span>
          <span className="muted"> — راجع تبويب «فشل» في صفحة الفحص. غالباً مفتاح API غير صالح أو رصيد منتهٍ.</span>
        </div>
      ) : null}

      {total === 0 && queue.inspection_errors === 0 ? (
        <div className="card" style={{ borderInlineStart: '3px solid var(--ok)' }}>
          <span style={{ color: 'var(--ok)', fontWeight: 650 }}>لا يوجد عمل معلّق.</span>
          <span className="muted"> كل الطوابير فارغة.</span>
        </div>
      ) : null}
    </div>
  );
}
