import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, API_BASE, getToken } from '../api';

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

  async function load() {
    const r = await api<Listing[]>(`/admin/listings${status ? `?status=${status}` : ''}`);
    setRows(r);
  }
  useEffect(() => { load(); }, [status]);

  async function remove(id: number) {
    if (!confirm('Remove this listing?')) return;
    await api(`/admin/listings/${id}/remove`, { method: 'PATCH' });
    load();
  }

  return (
    <div>
      <QuickAddCard onCreated={load} />
      <div className="card">
        <h2>Listings</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['', 'active', 'reserved', 'sold', 'expired', 'removed'].map((s) => (
            <button key={s || 'all'}
              className={status === s ? '' : 'secondary'}
              onClick={() => setStatus(s)}>
              {s || 'All'}
            </button>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Phone</th><th>Seller</th><th>Price</th><th>Loc</th><th>Status</th><th>When</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.brand} {r.model}</td>
                <td>{r.seller_name}<br/><small style={{ color: '#9ca3af' }}>{r.seller_phone}</small></td>
                <td>{r.asking_price.toLocaleString()}</td>
                <td>{r.governorate}{r.city ? ` · ${r.city}` : ''}</td>
                <td><span className="pill open">{r.status}</span></td>
                <td><small>{new Date(r.created_at).toLocaleDateString()}</small></td>
                <td>{r.status !== 'removed' ? <button className="danger" onClick={() => remove(r.id)}>Remove</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
