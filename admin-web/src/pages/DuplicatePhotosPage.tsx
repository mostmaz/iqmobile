// Stolen-photo review queue.
//
// A group here = one image file (identical SHA-256) that appears on listings
// from more than one seller — the classic "download the photo, re-post as
// mine" scam. The operator sees every clashing listing side by side (oldest
// first — the original is usually the earliest) and calls or removes from
// the listings page. This screen only surfaces; it doesn't auto-punish,
// because a shared stock photo is occasionally innocent.

import React, { useEffect, useState } from 'react';
import {api, API_BASE, listingUrl, listingLinkStyle} from '../api';

type DupListing = {
  id: number; brand: string; model: string; asking_price: number; status: string;
  created_at: number; image_path: string;
  seller_id: number; seller_name: string | null; seller_phone: string | null;
};
type DupGroup = { hash: string; sellers: number; listings: DupListing[] };

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');
const when = (ms: number) => new Date(ms).toLocaleDateString('en-GB');

export function DuplicatePhotosPage() {
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<DupGroup[]>('/admin/duplicate-photos')
      .then(setGroups).catch((e) => setErr(e?.message || 'خطأ')).finally(() => setLoading(false));
  }, []);

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-title">🕵️ صور مكررة عبر بائعين ({groups.length})</div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          نفس ملف الصورة ظهر لدى أكثر من بائع — غالباً صورة مسروقة. الأقدم عادةً هو الأصل.
        </p>
      </div>

      {loading ? <div className="card muted">Loading…</div> : null}
      {!loading && !groups.length ? (
        <div className="card muted" style={{ textAlign: 'center', padding: 32 }}>لا توجد صور مكررة.</div>
      ) : null}

      {groups.map((g) => (
        <div className="card" key={g.hash} style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {g.sellers} بائعين · {g.listings.length} إعلان · <code style={{ fontSize: 11 }}>{g.hash.slice(0, 12)}…</code>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {g.listings.map((l, i) => (
              <div key={l.id} style={{
                width: 220, border: '1px solid var(--border, #333)', borderRadius: 8, overflow: 'hidden',
                position: 'relative',
              }}>
                {i === 0 ? (
                  <span style={{
                    position: 'absolute', top: 6, right: 6, zIndex: 1,
                    background: '#2FA36B', color: '#fff', fontSize: 10.5, fontWeight: 700,
                    borderRadius: 999, padding: '2px 8px',
                  }}>الأقدم</span>
                ) : null}
                <img src={API_BASE + l.image_path} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', background: '#222' }} />
                <div style={{ padding: 9, fontSize: 13 }}>
                  <div><a href={listingUrl(l.id)} target="_blank" rel="noreferrer" style={listingLinkStyle}><strong>{l.brand} {l.model}</strong></a></div>
                  <div className="muted" style={{ fontSize: 12 }}>إعلان #{l.id} · {iqd(l.asking_price)} د.ع · {when(l.created_at)}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                    {l.seller_name || '—'}
                    {l.seller_phone ? <> · <a href={`tel:${l.seller_phone}`}>{l.seller_phone}</a></> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
