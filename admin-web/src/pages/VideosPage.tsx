// Listing-video review queue.
//
// A seller's clip stays invisible to buyers until it is watched HERE and
// approved — that is the whole moderation model, so this page is built
// around the player: video front and center, the listing's facts beside
// it, and two buttons. Reject deletes the file server-side and frees the
// seller to upload a different clip.

import React, { useEffect, useState } from 'react';
import {api, API_BASE, listingUrl, listingLinkStyle} from '../api';

type VideoRow = {
  id: number; brand: string; model: string; storage: string | null;
  asking_price: number; governorate: string | null;
  video_path: string; video_status: 'pending' | 'approved'; video_uploaded_at: number;
  seller_name: string | null; seller_phone: string | null;
  cover_image: string | null;
};

const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');
const when = (ms: number) => new Date(ms).toLocaleString('en-GB', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function VideosPage({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<VideoRow[]>([]);
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api<VideoRow[]>(`/admin/videos?status=${tab}`));
      setErr('');
    } catch (e: any) { setErr(e?.message || 'خطأ'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [tab]);

  async function decide(row: VideoRow, action: 'approve' | 'reject') {
    if (action === 'reject' && !confirm(
      `رفض فيديو ${row.brand} ${row.model}؟\nسيُحذف الملف نهائياً ويُشعَر البائع.`,
    )) return;
    setBusy(row.id);
    try {
      await api(`/admin/videos/${row.id}/${action}`, { method: 'POST' });
      await load();
      onChanged?.();
    } catch (e: any) { setErr(e?.message || 'خطأ'); } finally { setBusy(null); }
  }

  return (
    <div>
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>{err}</div> : null}

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="chart-title" style={{ marginLeft: 'auto' }}>🎬 فيديوهات الإعلانات ({rows.length})</div>
        <button className={tab === 'pending' ? 'primary' : 'secondary'} onClick={() => setTab('pending')}>بانتظار الموافقة</button>
        <button className={tab === 'approved' ? 'primary' : 'secondary'} onClick={() => setTab('approved')}>الموافَق عليها</button>
      </div>

      {loading ? <div className="card muted">Loading…</div> : null}
      {!loading && !rows.length ? (
        <div className="card muted" style={{ textAlign: 'center', padding: 32 }}>
          {tab === 'pending' ? 'لا فيديوهات بانتظار الموافقة.' : 'لا فيديوهات موافَق عليها.'}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {rows.map((row) => (
          <div className="card" key={row.id}>
            <video
              src={API_BASE + row.video_path}
              controls
              preload="metadata"
              style={{ width: '100%', maxHeight: 320, borderRadius: 8, background: '#000' }}
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
              {row.cover_image ? (
                <img src={API_BASE + row.cover_image} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
              ) : null}
              <div style={{ flex: 1, fontSize: 13.5 }}>
                <div><a href={listingUrl(row.id)} target="_blank" rel="noreferrer" style={listingLinkStyle}><strong>{row.brand} {row.model}</strong></a>{row.storage ? ` · ${row.storage}` : ''}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  إعلان #{row.id} · {iqd(row.asking_price)} د.ع · {row.seller_name || '—'}
                  {row.seller_phone ? <> · <a href={`tel:${row.seller_phone}`}>{row.seller_phone}</a></> : null}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>رُفع {when(row.video_uploaded_at)}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {row.video_status === 'pending' ? (
                <button className="primary" disabled={busy === row.id} onClick={() => decide(row, 'approve')}>
                  موافقة ونشر
                </button>
              ) : null}
              <button className="secondary" style={{ color: 'salmon' }} disabled={busy === row.id}
                onClick={() => decide(row, 'reject')}>
                {row.video_status === 'pending' ? 'رفض وحذف' : 'إزالة الفيديو'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
