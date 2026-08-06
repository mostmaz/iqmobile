import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, API_BASE, getToken } from '../api';
import { facebookPost, instagramPost, composeListingImage } from '../lib/marketing';

// Client-side image compressor. Downscales to max 1600px on the long
// edge and re-encodes as JPEG at quality 0.8 — same shape as what the
// mobile listing-post wizard does (compressForListing in
// mobile/src/lib/imageCompress.ts). Typical input 4–6 MB phone photo
// shrinks to ~150–300 KB, which is the difference between a Quick-Add
// upload on a flaky connection feeling instant vs timing out.
async function compressImage(file: File, maxDim = 1600, quality = 0.8): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    let { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unsupported');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('encode_failed');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface PickedImage {
  // Original file kept only for the preview URL — the actual upload
  // payload is the compressed blob. Once previewed we never read the
  // original bytes again, but we keep a stable id for the React key.
  id: string;
  originalSize: number;
  compressedSize: number;
  blob: Blob;
  previewUrl: string;
}

interface Listing {
  id: number;
  brand: string;
  model: string;
  asking_price: number;
  status: string;
  governorate: string;
  city: string | null;
  seller_name: string;
  seller_phone: string;
  created_at: number;
  featured_until: number | null;
  feature_tier: string | null;
  // Extra columns the list endpoint already returns (SELECT l.*) — needed
  // to seed the edit form without a second fetch per row.
  condition: string | null;
  storage: string | null;
  color: string | null;
  description: string | null;
  contact_whatsapp: string | null;
  contact_phone: string | null;
  battery_health: number | null;
  warranty_status: string | null;
}

interface ListingImage {
  id: number;
  image_path: string;
  position: number;
}

interface SocialStatus {
  configured: boolean;
  channels: { facebook: boolean; instagram: boolean };
  cap: number;
  used_today: number;
  remaining: number;
}

interface PhoneDupeResp {
  count: number;
  listings: Array<{
    id: number;
    brand: string;
    model: string;
    status: string;
    asking_price: number;
    created_at: number;
  }>;
}

// Canonical governorate list — mirrors server/src/governorates.js.
// Kept inline (instead of fetched) because it's a fixed 18-element list
// that never changes; serving it from the server would add a round-trip
// for zero benefit.
const GOVERNORATES = [
  'Baghdad', 'Basra', 'Erbil', 'Sulaymaniyah', 'Duhok', 'Kirkuk',
  'Najaf', 'Karbala', 'Mosul', 'Anbar', 'Babil', 'Diyala',
  'Diwaniyah', 'Dhi Qar', 'Maysan', 'Muthanna', 'Salahuddin', 'Wasit',
];

const CONDITIONS = ['new', 'used', 'repaired', 'refurbished'];

const EMPTY_FORM = {
  phone: '',
  display_name: '',
  brand: '',
  model: '',
  asking_price: '',
  governorate: 'Baghdad',
  city: '',
  condition: 'used',
  storage: '',
  color: '',
  contact_whatsapp: '',
  description: '',
};

export function ListingsPage() {
  const [rows, setRows] = useState<Listing[]>([]);
  const [status, setStatus] = useState<string>('');
  // `search` is what the operator is typing; `q` is the debounced value that
  // actually hits the server. Searching on every keystroke would fire a query
  // per character over a 700-row table for no benefit.
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  // Per-id checkbox state. Cleared when the filter changes (otherwise
  // selections "carry over" silently to a new view, which is confusing
  // when the user then clicks Remove and rows they can't see also go).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [removingBatch, setRemovingBatch] = useState(false);
  // Listing currently open in the edit modal (null = modal closed).
  const [editing, setEditing] = useState<Listing | null>(null);
  // Listing open in the marketing-post modal (null = closed).
  const [promoting, setPromoting] = useState<Listing | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  async function load() {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    const qs = p.toString();
    const r = await api<Listing[]>(`/admin/listings${qs ? `?${qs}` : ''}`);
    setRows(r);
  }
  // Search runs server-side, so it reaches listings beyond the 200-row page —
  // which is precisely when someone is hunting for one.
  useEffect(() => { load(); setSelected(new Set()); }, [status, q]);

  async function remove(id: number) {
    if (!confirm('Remove this listing?')) return;
    await api(`/admin/listings/${id}/remove`, { method: 'PATCH' });
    load();
  }

  // Manual feature — for direct (WhatsApp/cash) payments that skip the
  // in-app airtime request. Two prompts: duration (days) then how many
  // times/day the listing is re-bumped to the top of the feed. 0 days =
  // unfeature (the second prompt is skipped).
  async function feature(l: Listing) {
    const isFeatured = !!(l.featured_until && l.featured_until > Date.now());
    const cur = isFeatured ? `(featured until ${new Date(l.featured_until!).toLocaleDateString()})` : '(not featured)';
    const days = prompt(`Feature "${l.brand} ${l.model}" for how many days? ${cur}\nEnter 0 to unfeature.`, '5');
    if (days === null) return;
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0) { alert('Enter a number ≥ 0.'); return; }

    let boosts = 3;
    if (n > 0) {
      const b = prompt(`How many times per day should it be pushed to the top?\n(tier reference: bronze 2 · silver 3 · gold 4)`, '3');
      if (b === null) return;
      boosts = Number(b);
      if (!Number.isInteger(boosts) || boosts < 1 || boosts > 24) { alert('Enter a whole number between 1 and 24.'); return; }
    }
    try {
      await api(`/admin/listings/${l.id}/feature`, {
        method: 'PATCH',
        body: JSON.stringify({ days: n, boosts_per_day: boosts }),
      });
      await load();
    } catch (e: any) { alert(`Feature failed: ${e?.message || 'unknown'}`); }
  }

  // Rows visible in the current view that aren't already removed —
  // those are the only ones the batch action can act on (the server
  // also filters but we mirror it here so the count + select-all are
  // honest about what's actually deletable).
  const selectable = useMemo(
    () => rows.filter((r) => r.status !== 'removed'),
    [rows],
  );
  const selectableIds = useMemo(() => selectable.map((r) => r.id), [selectable]);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const someSelected = selectable.some((r) => selected.has(r.id));

  function toggleOne(id: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((cur) => {
      if (allSelected) return new Set();
      const next = new Set(cur);
      selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Soft-delete ${ids.length} listing(s)? Sets status='removed'. Reversible via DB.`)) return;
    setRemovingBatch(true);
    try {
      const r = await api<{ removed: number }>('/admin/listings/remove-batch', {
        method: 'PATCH',
        body: JSON.stringify({ ids }),
      });
      setSelected(new Set());
      await load();
      // Quick toast — no full-page alert spam when the count matches.
      // Only surface the mismatch case (someone else removed a row
      // between the load and the click, or an id was already-removed).
      if (r.removed !== ids.length) {
        alert(`Removed ${r.removed} of ${ids.length}. ${ids.length - r.removed} were already removed or no longer exist.`);
      }
    } catch (e: any) {
      alert(`Batch remove failed: ${e?.message || 'unknown'}`);
    } finally {
      setRemovingBatch(false);
    }
  }

  return (
    <div>
      <QuickAddCard onCreated={load} />
      <div className="card">
        <h2>Listings</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {['', 'active', 'reserved', 'sold', 'expired', 'removed'].map((s) => (
            <button key={s || 'all'}
              className={status === s ? '' : 'secondary'}
              onClick={() => setStatus(s)}>
              {s || 'All'}
            </button>
          ))}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginInlineStart: 'auto' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="id, brand, model, seller, phone…"
              style={{ width: 260 }}
            />
            {search ? (
              <button className="ghost" onClick={() => setSearch('')}>clear</button>
            ) : null}
          </div>
          {/* Batch action — only visible when at least one row is ticked.
              Disabled while a request is in flight so a double-click
              doesn't fire two PATCHes (the second one would just hit
              the WHERE status != 'removed' guard and no-op, but it's
              still a spurious round-trip). */}
          {someSelected ? (
            <button
              className="danger"
              onClick={removeSelected}
              disabled={removingBatch}
              style={{ marginInlineStart: 'auto' }}
            >
              {removingBatch ? 'Removing…' : `Remove ${selected.size} selected`}
            </button>
          ) : null}
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  // The DOM `indeterminate` property is not exposed via
                  // JSX attributes — ref callback is the canonical way
                  // to drive it. Set true when some but not all visible
                  // selectable rows are ticked.
                  ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                  onChange={toggleAll}
                  disabled={selectable.length === 0}
                  title={selectable.length ? 'Select all on this page' : 'Nothing to select'}
                />
              </th>
              <th>ID</th><th>Phone</th><th>Seller</th><th>Price</th><th>Loc</th><th>Status</th><th>When</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.status !== 'removed' ? (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                    />
                  ) : null}
                </td>
                <td>{r.id}</td>
                <td>{r.model}</td>
                <td>{r.seller_name}<br/><small style={{ color: '#9ca3af' }}>{r.seller_phone}</small></td>
                <td>{r.asking_price.toLocaleString()}</td>
                <td>{r.governorate}{r.city ? ` · ${r.city}` : ''}</td>
                <td>
                  <span className="pill open">{r.status}</span>
                  {r.featured_until && r.featured_until > Date.now() ? (
                    <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>
                      ★ {r.feature_tier || 'featured'} → {new Date(r.featured_until).toLocaleDateString()}
                    </div>
                  ) : null}
                </td>
                <td><small>{new Date(r.created_at).toLocaleDateString()}</small></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.status !== 'removed' ? (
                    <>
                      <button
                        className={r.featured_until && r.featured_until > Date.now() ? '' : 'secondary'}
                        onClick={() => feature(r)}
                        title="Feature this listing (manual / direct payment)"
                      >★</button>{' '}
                      <button
                        className="secondary"
                        onClick={() => setEditing(r)}
                        title="Edit this listing"
                      >Edit</button>{' '}
                      <button
                        className="secondary"
                        onClick={() => setPromoting(r)}
                        title="Generate a Facebook / Instagram post"
                      >📣 Post</button>{' '}
                      <button className="danger" onClick={() => remove(r.id)}>Remove</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <EditListingModal
          listing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      ) : null}
      {promoting ? (
        <MarketingModal listing={promoting} onClose={() => setPromoting(null)} />
      ) : null}
    </div>
  );
}

// Marketing-post modal. Renders ready-to-paste Facebook + Instagram copy
// (generated client-side from the row's own fields) with copy buttons, and
// the listing's photos with download links so the operator can attach them
// to the post. No server call for the text; images come from the same
// admin images endpoint the edit modal uses.
function MarketingModal({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const [images, setImages] = useState<ListingImage[]>([]);
  const [copied, setCopied] = useState<'fb' | 'ig' | null>(null);
  // Branded share-image state: which source photo is selected, the composed
  // data URL, and whether a compose is in flight.
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [composed, setComposed] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeErr, setComposeErr] = useState('');
  // Buffer publish state.
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fb = facebookPost(listing);
  const ig = instagramPost(listing);

  // Load Buffer status (configured? remaining today?) so the button knows
  // whether it can fire.
  useEffect(() => {
    api<SocialStatus>('/admin/social/status')
      .then(setSocial)
      .catch(() => setSocial(null));
  }, []);

  async function publish() {
    if (!composed || publishing) return;
    setPublishing(true); setPublishMsg(null);
    try {
      const blob = await (await fetch(composed)).blob();
      const fd = new FormData();
      fd.append('image', blob, `post_${listing.id}.jpg`);
      fd.append('caption', fb);
      const token = getToken();
      const res = await fetch(`${API_BASE}/admin/listings/${listing.id}/publish`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map: Record<string, string> = {
          buffer_not_configured: 'النشر التلقائي غير مُفعّل — يجب ربط Buffer أولاً.',
          daily_cap_reached: `بلغت الحد اليومي (${data.cap ?? social?.cap ?? 3} منشورات).`,
          publish_failed: 'فشل النشر عبر Buffer — تحقّق من ربط الحسابات.',
          no_caption: 'النص فارغ.',
        };
        setPublishMsg({ ok: false, text: map[data.error] || 'تعذّر النشر.' });
      } else {
        const okCh = (data.results || []).filter((r: any) => r.ok).map((r: any) => r.channel).join(' + ');
        // The post is scheduled (next 10ص / 3م / 6م Baghdad slot), not sent now.
        let when = '';
        if (data.scheduled_for) {
          try {
            when = ` · موعد النشر: ${new Intl.DateTimeFormat('ar-IQ', {
              timeZone: 'Asia/Baghdad', weekday: 'short', hour: 'numeric', minute: '2-digit',
            }).format(new Date(data.scheduled_for))}`;
          } catch { /* ignore formatting issues */ }
        }
        setPublishMsg({ ok: true, text: `تمت الجدولة عبر ${okCh || 'Buffer'}${when} · متبقٍ اليوم: ${data.remaining}` });
        setSocial((s) => (s ? { ...s, remaining: data.remaining, used_today: s.cap - data.remaining } : s));
      }
    } catch {
      setPublishMsg({ ok: false, text: 'خطأ في الاتصال بالخادم.' });
    } finally {
      setPublishing(false);
    }
  }

  useEffect(() => {
    api<{ images: ListingImage[] }>(`/admin/listings/${listing.id}/images`)
      .then((r) => setImages(r.images))
      .catch(() => setImages([]));
  }, [listing.id]);

  // (Re)compose the branded image whenever the selected source photo changes.
  useEffect(() => {
    const src = images[selectedIdx];
    if (!src) { setComposed(null); return; }
    let alive = true;
    setComposing(true); setComposeErr('');
    composeListingImage(listing, `${API_BASE}${src.image_path}`)
      .then((r) => { if (alive) setComposed(r.dataUrl); })
      .catch(() => { if (alive) setComposeErr('تعذّر تجهيز الصورة'); })
      .finally(() => { if (alive) setComposing(false); });
    return () => { alive = false; };
  }, [images, selectedIdx, listing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy(which: 'fb' | 'ig', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600);
    } catch {
      // Clipboard API needs a secure context / permission — fall back to a
      // select-all hint rather than silently doing nothing.
      alert('تعذّر النسخ تلقائياً — حدّد النص وانسخه يدوياً.');
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 24, overflowY: 'auto', zIndex: 50,
      }}
    >
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(820px, 100%)', marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>📣 منشور تسويقي — {listing.brand} {listing.model}</h2>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>

        {/* Branded share image — framed, iQ-logo'd, price-stamped, ready to
            post to Facebook / Instagram. */}
        {images.length > 0 ? (
          <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 300px', maxWidth: '100%' }}>
              <div style={{
                width: 300, height: 300, borderRadius: 8, overflow: 'hidden',
                border: '1px solid #374151', background: '#0a1628',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {composing ? (
                  <span style={{ color: '#9ca3af', fontSize: 13 }}>جارٍ التجهيز…</span>
                ) : composeErr ? (
                  <span style={{ color: '#ef4444', fontSize: 13 }}>{composeErr}</span>
                ) : composed ? (
                  <img src={composed} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <a
                  href={composed || '#'}
                  download={`iqmobile_${listing.id}_${listing.brand}_${listing.model}.jpg`.replace(/\s+/g, '_')}
                  className=""
                  style={{
                    flex: 1, textAlign: 'center', textDecoration: 'none',
                    background: composed ? '#10b981' : '#374151', color: '#fff',
                    padding: '9px 0', borderRadius: 6, fontSize: 14,
                    pointerEvents: composed ? 'auto' : 'none',
                  }}
                >⬇︎ تحميل الصورة</a>
              </div>

              {/* One-click publish via Buffer → FB + IG. Only enabled when
                  Buffer is wired up server-side and today's quota isn't spent. */}
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={publish}
                  disabled={
                    publishing || !composed ||
                    !social?.configured || (social ? social.remaining <= 0 : false)
                  }
                  title={
                    !social?.configured ? 'اربط Buffer أولاً لتفعيل النشر التلقائي'
                      : social && social.remaining <= 0 ? 'بلغت الحد اليومي'
                        : 'انشر إلى Facebook + Instagram'
                  }
                  style={{
                    width: '100%',
                    background: (!social?.configured || (social ? social.remaining <= 0 : false)) ? '#374151' : '#3b82f6',
                    color: '#fff', padding: '9px 0', borderRadius: 6, fontSize: 14,
                    cursor: (!social?.configured || publishing) ? 'default' : 'pointer',
                  }}
                >
                  {publishing ? 'جارٍ النشر…' : '🚀 نشر إلى Facebook + Instagram'}
                </button>
                {social?.configured ? (
                  <div style={{ marginTop: 5, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
                    متبقٍ اليوم: {social.remaining} / {social.cap}
                  </div>
                ) : (
                  <div style={{ marginTop: 5, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
                    النشر التلقائي غير مُفعّل — يتطلب ربط Buffer
                  </div>
                )}
                {publishMsg ? (
                  <div style={{ marginTop: 6, fontSize: 12, textAlign: 'center', color: publishMsg.ok ? '#10b981' : '#ef4444' }}>
                    {publishMsg.text}
                  </div>
                ) : null}
              </div>

              <div style={{ marginTop: 8, fontSize: 11.5, color: '#9ca3af', lineHeight: 1.6 }}>
                أو حمّل الصورة وانشرها يدوياً على <strong style={{ color: '#60a5fa' }}>Facebook</strong> /{' '}
                <strong style={{ color: '#f472b6' }}>Instagram</strong> مع النص أدناه.
              </div>
            </div>

            {/* source-photo picker */}
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
                اختر صورة المنتج للإطار:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {images.map((img, i) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setSelectedIdx(i)}
                    title="استخدم هذه الصورة"
                    style={{
                      width: 68, height: 68, borderRadius: 6, overflow: 'hidden', padding: 0,
                      border: i === selectedIdx ? '2px solid #10b981' : '1px solid #374151',
                      cursor: 'pointer', background: 'transparent',
                    }}
                  >
                    <img src={`${API_BASE}${img.image_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14, fontSize: 12.5, color: '#9ca3af' }}>
            لا توجد صور لهذا الإعلان — أضِف صوراً من زر «Edit» لتوليد صورة تسويقية.
          </div>
        )}

        {/* Facebook */}
        <PostBlock
          label="Facebook"
          text={fb}
          copied={copied === 'fb'}
          onCopy={() => copy('fb', fb)}
        />

        {/* Instagram */}
        <PostBlock
          label="Instagram"
          text={ig}
          copied={copied === 'ig'}
          onCopy={() => copy('ig', ig)}
        />
      </div>
    </div>
  );
}

function PostBlock({ label, text, copied, onCopy }: { label: string; text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ color: '#fff' }}>{label}</strong>
        <button type="button" className={copied ? 'primary' : ''} onClick={onCopy}>
          {copied ? '✓ تم النسخ' : 'نسخ النص'}
        </button>
      </div>
      <textarea
        readOnly
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        dir="rtl"
        rows={label === 'Facebook' ? 12 : 9}
        style={{
          width: '100%', background: '#1f2e47', color: '#e5e7eb',
          border: '1px solid #374151', borderRadius: 6, padding: 10,
          fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7, resize: 'vertical',
        }}
      />
    </div>
  );
}

const STATUSES = ['active', 'reserved', 'sold', 'removed'];

// Edit modal. Sends a PATCH containing ONLY the fields the operator
// actually changed — the server treats the body as a partial update, so
// an untouched field is never rewritten (and we can't clobber a column
// that changed server-side between load and save).
function EditListingModal({
  listing, onClose, onSaved,
}: { listing: Listing; onClose: () => void; onSaved: () => void }) {
  const [brands, setBrands] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // Photos are managed independently of the field form: each add/remove
  // hits the server immediately (they're separate endpoints), so there's
  // no "unsaved photo" state to reconcile with the Save button.
  const [images, setImages] = useState<ListingImage[]>([]);
  const [maxImages, setMaxImages] = useState(10);
  const [imgBusy, setImgBusy] = useState('');
  const [imgErr, setImgErr] = useState('');
  const addInputRef = useRef<HTMLInputElement | null>(null);
  // Set when a photo op changed something — tells the parent to reload
  // the row on close even if no field edits were saved.
  const imagesTouched = useRef(false);
  const [form, setForm] = useState({
    brand: listing.brand || '',
    model: listing.model || '',
    asking_price: String(listing.asking_price ?? ''),
    governorate: listing.governorate || 'Baghdad',
    city: listing.city || '',
    condition: listing.condition || 'used',
    storage: listing.storage || '',
    color: listing.color || '',
    contact_whatsapp: listing.contact_whatsapp || '',
    description: listing.description || '',
    status: listing.status || 'active',
  });

  useEffect(() => {
    api<Array<{ name: string }>>('/admin/brands')
      .then((rows) => setBrands(rows.map((b) => b.name).sort()))
      .catch(() => setBrands([]));
  }, []);

  // Load the listing's current photos when the modal opens.
  useEffect(() => {
    api<{ images: ListingImage[]; max: number }>(`/admin/listings/${listing.id}/images`)
      .then((r) => { setImages(r.images); setMaxImages(r.max ?? 10); })
      .catch(() => setImages([]));
  }, [listing.id]);

  // Close on Escape — a modal that traps the operator is worse than one
  // that closes too easily, since nothing is saved until they hit Save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Photo edits are already persisted, so closing after one still needs to
  // refresh the parent list (the row's updated_at / thumbnail changed).
  function handleClose() {
    if (imagesTouched.current) onSaved(); else onClose();
  }

  async function deleteImage(img: ListingImage) {
    if (!confirm('Remove this photo? This deletes the file and cannot be undone.')) return;
    setImgErr(''); setImgBusy(`del-${img.id}`);
    try {
      await api(`/admin/listings/${listing.id}/images/${img.id}`, { method: 'DELETE' });
      setImages((cur) => cur.filter((i) => i.id !== img.id));
      imagesTouched.current = true;
    } catch (e: any) {
      setImgErr(e?.message || 'Delete failed');
    } finally { setImgBusy(''); }
  }

  // Compress client-side (same canvas path Quick Add uses) then upload.
  // Multipart can't go through api(), which forces a JSON content-type.
  async function addImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setImgErr('');
    const room = maxImages - images.length;
    if (room <= 0) { setImgErr(`Already at the ${maxImages}-photo limit.`); return; }

    setImgBusy('add');
    try {
      const fd = new FormData();
      let n = 0;
      for (const f of files.slice(0, room)) {
        try {
          const blob = await compressImage(f);
          fd.append('images', blob, `edit_${Date.now()}_${n}.jpg`);
          n++;
        } catch { /* skip undecodable files, upload the rest */ }
      }
      if (n === 0) { setImgErr('None of those files could be read as images.'); return; }

      const token = getToken();
      const res = await fetch(`${API_BASE}/admin/listings/${listing.id}/images`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`upload_failed (${res.status}) ${t.slice(0, 80)}`);
      }
      const r = await res.json();
      setImages((cur) => [...cur, ...(r.added || [])]);
      imagesTouched.current = true;
      if (files.length > room) setImgErr(`Only ${room} added — ${maxImages}-photo limit reached.`);
    } catch (e: any) {
      setImgErr(e?.message || 'Upload failed');
    } finally {
      setImgBusy('');
      if (addInputRef.current) addInputRef.current.value = '';
    }
  }

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Original values in the same shape as `form`, so a plain !== comparison
  // tells us which keys to send.
  const original: typeof form = {
    brand: listing.brand || '',
    model: listing.model || '',
    asking_price: String(listing.asking_price ?? ''),
    governorate: listing.governorate || 'Baghdad',
    city: listing.city || '',
    condition: listing.condition || 'used',
    storage: listing.storage || '',
    color: listing.color || '',
    contact_whatsapp: listing.contact_whatsapp || '',
    description: listing.description || '',
    status: listing.status || 'active',
  };
  const changedKeys = (Object.keys(form) as Array<keyof typeof form>)
    .filter((k) => form[k] !== original[k]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving || changedKeys.length === 0) return;
    setErr('');
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const k of changedKeys) {
        payload[k] = k === 'asking_price' ? Number(form.asking_price) : form[k];
      }
      await api(`/admin/listings/${listing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 24, overflowY: 'auto', zIndex: 50,
      }}
    >
      {/* Stop propagation so clicking inside the card doesn't dismiss it. */}
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(760px, 100%)', marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Edit listing #{listing.id}</h2>
          <button type="button" className="secondary" onClick={handleClose}>Close</button>
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af', margin: '6px 0 14px' }}>
          {listing.seller_name} · {listing.seller_phone}
        </div>

        <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div>
            <label style={labelStyle}>Brand</label>
            <select value={form.brand} onChange={(e) => set('brand', e.target.value)} required>
              {/* Keep the current value selectable even if it's no longer
                  in the brand whitelist, so opening the modal on a legacy
                  row doesn't silently switch its brand on save. */}
              {brands.includes(form.brand) ? null : <option value={form.brand}>{form.brand}</option>}
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Model</label>
            <input type="text" value={form.model} onChange={(e) => set('model', e.target.value)} required />
          </div>

          <div>
            <label style={labelStyle}>Asking price (IQD)</label>
            <input
              type="number" min="1"
              value={form.asking_price}
              onChange={(e) => set('asking_price', e.target.value)}
              required
            />
          </div>

          <div>
            <label style={labelStyle}>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {/* 'expired' is owned by the expirer job, so it isn't offered
                  here; show it as a read-only current value if that's the
                  row's state. */}
              {STATUSES.includes(form.status) ? null : <option value={form.status}>{form.status}</option>}
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Governorate</label>
            <select value={form.governorate} onChange={(e) => set('governorate', e.target.value)}>
              {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>City</label>
            <input type="text" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>

          <div>
            <label style={labelStyle}>Condition</label>
            <select value={form.condition} onChange={(e) => set('condition', e.target.value)}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Storage</label>
            <input type="text" value={form.storage} onChange={(e) => set('storage', e.target.value)} placeholder="128GB" />
          </div>

          <div>
            <label style={labelStyle}>Color</label>
            <input type="text" value={form.color} onChange={(e) => set('color', e.target.value)} />
          </div>

          <div>
            <label style={labelStyle}>WhatsApp</label>
            <input
              type="tel"
              value={form.contact_whatsapp}
              onChange={(e) => set('contact_whatsapp', e.target.value)}
              placeholder="07XXXXXXXXX — blank to clear"
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              style={{ width: '100%' }}
            />
          </div>

          {/* Photos. Unlike the fields above, these save immediately —
              each add/remove is its own request, so the Save button's
              change count intentionally ignores them. */}
          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #374151', paddingTop: 12 }}>
            <label style={labelStyle}>
              Photos ({images.length}/{maxImages}) — changes apply immediately
            </label>
            {images.length > 0 ? (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {images.map((img, i) => (
                  <div key={img.id} style={{
                    position: 'relative', width: 84, height: 84, borderRadius: 6,
                    overflow: 'hidden', border: '1px solid #374151',
                  }}>
                    <img
                      src={`${API_BASE}${img.image_path}`}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <button
                      type="button"
                      onClick={() => deleteImage(img)}
                      disabled={!!imgBusy}
                      title="Remove this photo"
                      style={{
                        position: 'absolute', top: 2, insetInlineEnd: 2,
                        width: 20, height: 20, padding: 0,
                        background: 'rgba(0,0,0,0.72)', color: '#fff',
                        border: 'none', borderRadius: 4, cursor: 'pointer',
                        fontSize: 13, lineHeight: '20px', textAlign: 'center',
                      }}
                    >{imgBusy === `del-${img.id}` ? '…' : '×'}</button>
                    {/* Position 0 is the cover photo in the mobile gallery —
                        worth flagging so removing it isn't a surprise. */}
                    {i === 0 ? (
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        background: 'rgba(0,0,0,0.65)', color: '#fbbf24',
                        fontSize: 9, padding: '1px 3px', textAlign: 'center',
                      }}>cover</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 12, color: '#9ca3af' }}>No photos on this listing.</div>
            )}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input
                ref={addInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={addImages}
                disabled={!!imgBusy || images.length >= maxImages}
              />
              {imgBusy === 'add' ? <span style={{ fontSize: 12, color: '#9ca3af' }}>Uploading…</span> : null}
              {imgErr ? <span style={{ fontSize: 12, color: '#dc2626' }}>{imgErr}</span> : null}
            </div>
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <button type="submit" disabled={saving || changedKeys.length === 0}>
              {saving ? 'Saving…' : changedKeys.length === 0 ? 'No changes' : `Save ${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="secondary" onClick={handleClose}>Cancel</button>
            {err ? <span style={{ color: '#dc2626', fontSize: 13 }}>{err}</span> : null}
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: '#6b7280' };

// Quick-add form. Phone is intentionally the FIRST field — the operator
// usually has the phone number in hand from a WhatsApp / call and needs
// to know up front whether this seller already has listings before
// entering anything else. The exclamation chip next to the phone input
// lights up as soon as the typed digits resolve to an existing seller
// with non-removed listings (debounced, server-side check).
function QuickAddCard({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [brands, setBrands] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [dupe, setDupe] = useState<PhoneDupeResp | null>(null);
  const [dupeLoading, setDupeLoading] = useState(false);
  const dupeTimer = useRef<number | null>(null);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pull the brand list from /admin/brands so the dropdown matches the
  // server's whitelist exactly (the brand validator on POST /admin/listings
  // refuses anything off-list, so a hardcoded array here would drift).
  useEffect(() => {
    api<Array<{ name: string }>>('/admin/brands')
      .then((rows) => setBrands(rows.map((b) => b.name).sort()))
      .catch(() => setBrands([]));
  }, []);

  // Debounced duplicate check. The endpoint returns an empty list for
  // anything that doesn't normalise to a valid Iraqi number, so we don't
  // need to client-side gate on phone length. 300ms feels snappy without
  // hammering the endpoint on every keystroke.
  useEffect(() => {
    if (dupeTimer.current) window.clearTimeout(dupeTimer.current);
    if (!form.phone.trim()) { setDupe(null); return; }
    setDupeLoading(true);
    dupeTimer.current = window.setTimeout(async () => {
      try {
        const r = await api<PhoneDupeResp>(`/admin/listings/by-phone?phone=${encodeURIComponent(form.phone.trim())}`);
        setDupe(r);
      } catch { setDupe(null); } finally { setDupeLoading(false); }
    }, 300);
    return () => { if (dupeTimer.current) window.clearTimeout(dupeTimer.current); };
  }, [form.phone]);

  function set<K extends keyof typeof EMPTY_FORM>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Compress on PICK (not on submit) so the upload click feels instant
  // and the user can see the before/after byte counts before committing.
  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setCompressing(true);
    try {
      const remaining = 10 - images.length;
      const picked: PickedImage[] = [];
      for (const f of files.slice(0, remaining)) {
        try {
          const blob = await compressImage(f);
          picked.push({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            originalSize: f.size,
            compressedSize: blob.size,
            blob,
            previewUrl: URL.createObjectURL(blob),
          });
        } catch {
          // Skip files we couldn't decode (corrupt heic, weird format).
          // The rest of the batch still goes through.
        }
      }
      setImages((cur) => [...cur, ...picked]);
    } finally {
      setCompressing(false);
      // Reset the input so picking the same file again still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeImage(id: string) {
    setImages((cur) => {
      const next = cur.filter((p) => p.id !== id);
      const removed = cur.find((p) => p.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  // Upload happens AFTER POST /admin/listings returns the new id. We
  // use raw fetch + FormData because the api() helper hardcodes a JSON
  // content-type that breaks multipart. The bearer token is pulled from
  // the same localStorage slot api() uses.
  async function uploadImages(listingId: number): Promise<number> {
    if (images.length === 0) return 0;
    const fd = new FormData();
    images.forEach((img, idx) => {
      // Server filenames are randomised — we still set a name here so
      // multer's file.originalname has something to base the safe-ext
      // pick on.
      fd.append('images', img.blob, `quickadd_${idx}.jpg`);
    });
    const token = getToken();
    const res = await fetch(`${API_BASE}/admin/listings/${listingId}/images`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`image_upload_failed (${res.status}) ${text.slice(0, 80)}`);
    }
    const r = await res.json();
    return r.added?.length || 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setSuccess(''); setUploadStatus('');
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await api<{ listing_id: number; seller_id: number }>('/admin/listings', {
        method: 'POST',
        body: JSON.stringify({
          phone: form.phone.trim(),
          display_name: form.display_name.trim() || undefined,
          brand: form.brand,
          model: form.model.trim(),
          asking_price: Number(form.asking_price),
          governorate: form.governorate,
          city: form.city.trim() || undefined,
          condition: form.condition,
          storage: form.storage.trim() || undefined,
          color: form.color.trim() || undefined,
          contact_whatsapp: form.contact_whatsapp.trim() || undefined,
          description: form.description.trim() || undefined,
        }),
      });
      let uploaded = 0;
      if (images.length > 0) {
        setUploadStatus(`Uploading ${images.length} image(s)…`);
        uploaded = await uploadImages(r.listing_id);
      }
      setSuccess(`Created listing #${r.listing_id} for seller #${r.seller_id}${uploaded ? ` · ${uploaded} image(s) attached` : ''}`);
      setForm(EMPTY_FORM);
      setDupe(null);
      images.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setImages([]);
      setUploadStatus('');
      onCreated();
    } catch (e: any) {
      setErr(e?.message || 'Failed');
      setUploadStatus('');
    } finally {
      setSubmitting(false);
    }
  }

  const hasDupes = !!dupe && dupe.count > 0;

  return (
    <div className="card">
      <h2>Quick Add</h2>
      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {/* Phone is row 1 / col 1 — first thing the operator types. */}
        <div style={{ gridColumn: '1 / span 1' }}>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            Phone <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="tel"
              autoFocus
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="07XXXXXXXXX"
              required
              style={{
                width: '100%',
                paddingInlineEnd: hasDupes || dupeLoading ? 36 : 8,
                borderColor: hasDupes ? '#dc2626' : undefined,
              }}
            />
            {dupeLoading && !hasDupes ? (
              <span style={dupeIconStyle} title="checking…">⏳</span>
            ) : null}
            {hasDupes ? (
              <span
                style={{ ...dupeIconStyle, color: '#dc2626', cursor: 'help' }}
                title={`This phone already has ${dupe!.count} listing(s):\n` +
                  dupe!.listings.map((l) => `  #${l.id} ${l.brand} ${l.model} (${l.status})`).join('\n')}
              >
                ⚠
              </span>
            ) : null}
          </div>
          {hasDupes ? (
            <div style={{ marginTop: 4, fontSize: 11, color: '#dc2626' }}>
              {dupe!.count} existing listing{dupe!.count === 1 ? '' : 's'} on this number
            </div>
          ) : null}
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>Display name (if new seller)</label>
          <input
            type="text"
            value={form.display_name}
            onChange={(e) => set('display_name', e.target.value)}
            placeholder="optional — auto-generated if blank"
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>WhatsApp (optional)</label>
          <input
            type="tel"
            value={form.contact_whatsapp}
            onChange={(e) => set('contact_whatsapp', e.target.value)}
            placeholder="07XXXXXXXXX"
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            Brand <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <select
            value={form.brand}
            onChange={(e) => set('brand', e.target.value)}
            required
          >
            <option value="" disabled>— pick —</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            Model <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={form.model}
            onChange={(e) => set('model', e.target.value)}
            placeholder="iPhone 15 Pro"
            required
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            Asking price (IQD) <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="number"
            min="1"
            value={form.asking_price}
            onChange={(e) => set('asking_price', e.target.value)}
            placeholder="1500000"
            required
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            Governorate <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <select
            value={form.governorate}
            onChange={(e) => set('governorate', e.target.value)}
            required
          >
            {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>City (optional)</label>
          <input
            type="text"
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>Condition</label>
          <select
            value={form.condition}
            onChange={(e) => set('condition', e.target.value)}
          >
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>Storage</label>
          <input
            type="text"
            value={form.storage}
            onChange={(e) => set('storage', e.target.value)}
            placeholder="128GB"
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: '#6b7280' }}>Color</label>
          <input
            type="text"
            value={form.color}
            onChange={(e) => set('color', e.target.value)}
          />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: 12, color: '#6b7280' }}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            style={{ width: '100%' }}
          />
        </div>

        {/* Photos — compressed client-side (JPEG q=0.8, max 1600px) so
            the upload is bandwidth-friendly even on poor connections.
            Server caps at 10 per listing and 5MB per file (post-compress
            the typical photo is well under 500KB). */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            Photos (up to 10) — compressed before upload
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickImages}
              disabled={images.length >= 10}
            />
            {compressing ? <span style={{ fontSize: 12, color: '#6b7280' }}>Compressing…</span> : null}
            {images.length > 0 ? (
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                {images.length}/10 · {fmtBytes(images.reduce((a, p) => a + p.compressedSize, 0))} total
                {' '}(saved {fmtBytes(images.reduce((a, p) => a + (p.originalSize - p.compressedSize), 0))})
              </span>
            ) : null}
          </div>
          {images.length > 0 ? (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {images.map((p) => (
                <div key={p.id} style={{
                  position: 'relative', width: 72, height: 72, borderRadius: 6,
                  overflow: 'hidden', border: '1px solid #374151',
                }}>
                  <img src={p.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button
                    type="button"
                    onClick={() => removeImage(p.id)}
                    title="Remove"
                    style={{
                      position: 'absolute', top: 2, insetInlineEnd: 2,
                      width: 18, height: 18, padding: 0,
                      background: 'rgba(0,0,0,0.7)', color: '#fff',
                      border: 'none', borderRadius: 4, cursor: 'pointer',
                      fontSize: 12, lineHeight: '18px', textAlign: 'center',
                    }}
                  >×</button>
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'rgba(0,0,0,0.6)', color: '#fff',
                    fontSize: 9, padding: '1px 3px', textAlign: 'center',
                  }}>
                    {fmtBytes(p.compressedSize)}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button type="submit" disabled={submitting || compressing}>
            {submitting ? (uploadStatus || 'Creating…') : 'Create listing'}
          </button>
          {err ? <span style={{ color: '#dc2626', fontSize: 13 }}>{err}</span> : null}
          {success ? <span style={{ color: '#16a34a', fontSize: 13 }}>{success}</span> : null}
        </div>
      </form>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const dupeIconStyle: React.CSSProperties = {
  position: 'absolute',
  insetInlineEnd: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 16,
  pointerEvents: 'auto',
};
