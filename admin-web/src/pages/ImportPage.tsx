// Import queue — staging area for batch-uploading scraped CSVs into the
// listings table. Workflow (server side in routes/admin/index.js):
//   1. Upload CSV → each row becomes a pending `import_jobs` row with a
//      best-effort parse (importParse.js).
//   2. Operator reviews/edits any field inline.
//   3. Approve → server creates a phone_listings row, find-or-creates
//      the seller user keyed on contact_phone, and links the job to
//      the new listing.
//   4. Reject → no listing created; status flips for audit.
//
// This page is intentionally dense — each row has a lot of metadata
// that the operator needs to see at once (parsed fields + warnings +
// the raw FB description for cross-checking).

import React, { useEffect, useState } from 'react';
import { api, API_BASE, getToken } from '../api';

type Warning = string;
type Parsed = {
  phone: string | null;
  whatsapp: string | null;
  display_name: string | null;
  brand: string | null;
  model: string | null;
  storage: string | null;
  asking_price: number | null;
  governorate: string | null;
  city: string | null;
  description: string;
  // The original Facebook photo-viewer URLs from the scrape. They are
  // NOT directly downloadable (FB requires auth + JS) — surfaced only as
  // clickable links so the operator can open each post in a browser
  // tab, save the images locally, and drop them onto the upload zone
  // below. The actual images live in `uploaded_images`.
  image_urls: string[];
  // Server-staged image paths (added by POST /admin/import/:id/images).
  // Become listing_images rows on approve.
  uploaded_images?: string[];
  warnings: Warning[];
};
type Job = {
  id: number;
  source: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  reviewed_at: number | null;
  listing_id: number | null;
  notes: string | null;
  raw: Record<string, string>;
  parsed: Parsed;
};

const WARN_LABEL: Record<string, string> = {
  no_phone: 'phone missing',
  no_brand: 'brand missing',
  no_model: 'model missing',
  no_price: 'price missing',
  price_inferred_thousands: 'price × 1000 (low confidence)',
  no_governorate: 'governorate missing',
  marked_sold: 'description says SOLD',
};

export function ImportPage() {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  // Upload form
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  // Per-row local edits before they're PATCHed to the server. Keyed by
  // job id; whatever's here overrides the server's parsed values when
  // rendering the inputs.
  const [edits, setEdits] = useState<Record<number, Partial<Parsed>>>({});

  // Per-row expand state for the long raw FB description.
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  async function load() {
    setLoading(true); setErr('');
    try {
      const data = await api<Job[]>(`/admin/import/queue?status=${statusFilter}`);
      setJobs(data);
      setEdits({});
    } catch (e: any) {
      setErr(e?.message || 'load_failed');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function doUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true); setUploadMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const url = `${API_BASE}/admin/import/upload?source=${encodeURIComponent(source || file.name.replace(/\.csv$/i, ''))}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'upload_failed');
      setUploadMsg(`Imported ${j.inserted} rows from "${j.source}".`);
      setFile(null); setSource('');
      // Reset file input so re-selecting the same file fires onChange.
      (e.target as HTMLFormElement).reset();
      if (statusFilter === 'pending') load();
    } catch (e: any) {
      setUploadMsg(`Error: ${e?.message || 'upload_failed'}`);
    } finally { setUploading(false); }
  }

  function patchField<K extends keyof Parsed>(id: number, key: K, value: Parsed[K]) {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  }

  // Merge server-parsed + local edits for rendering inputs.
  function effective(job: Job): Parsed {
    const local = edits[job.id] || {};
    return { ...job.parsed, ...local };
  }

  async function saveAndApprove(job: Job) {
    setBusyId(job.id);
    try {
      // 1. PATCH any local edits first (if dirty).
      if (edits[job.id]) {
        await api(`/admin/import/${job.id}`, {
          method: 'PATCH', body: JSON.stringify(edits[job.id]),
        });
      }
      // 2. Approve.
      const r = await api<{ listing_id: number }>(`/admin/import/${job.id}/approve`, { method: 'POST' });
      // Optimistic remove from list (it's no longer pending).
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      setEdits((prev) => { const c = { ...prev }; delete c[job.id]; return c; });
      // Brief flash via uploadMsg so the operator sees it landed.
      setUploadMsg(`✓ Approved job #${job.id} → listing #${r.listing_id}.`);
    } catch (e: any) {
      const detail = e?.data?.missing ? ` (missing: ${e.data.missing.join(', ')})` : '';
      alert(`Approve failed: ${e?.message || 'error'}${detail}`);
    } finally { setBusyId(null); }
  }

  // Upload one or more image files to a pending job. Each file goes
  // through multer on the server; the response carries the updated
  // full uploaded_images array, which we splat onto local state so the
  // thumbnails appear without a full /queue refetch.
  async function uploadImages(jobId: number, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusyId(jobId);
    try {
      const fd = new FormData();
      for (let i = 0; i < files.length; i++) fd.append('images', files[i]);
      const url = `${API_BASE}/admin/import/${jobId}/images`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'upload_failed');
      setJobs((prev) => prev.map((job) => job.id === jobId
        ? { ...job, parsed: { ...job.parsed, uploaded_images: j.images } }
        : job));
    } catch (e: any) {
      alert(`Image upload failed: ${e?.message || 'error'}`);
    } finally { setBusyId(null); }
  }

  async function removeImage(jobId: number, idx: number) {
    try {
      const url = `${API_BASE}/admin/import/${jobId}/images/${idx}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || 'delete_failed');
      }
      setJobs((prev) => prev.map((job) => job.id === jobId
        ? { ...job, parsed: { ...job.parsed, uploaded_images: (job.parsed.uploaded_images || []).filter((_, i) => i !== idx) } }
        : job));
    } catch (e: any) {
      alert(`Remove failed: ${e?.message || 'error'}`);
    }
  }

  async function reject(job: Job) {
    if (!confirm(`Reject job #${job.id}? It will not create a listing.`)) return;
    setBusyId(job.id);
    try {
      await api(`/admin/import/${job.id}/reject`, { method: 'POST', body: JSON.stringify({}) });
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch (e: any) {
      alert(`Reject failed: ${e?.message || 'error'}`);
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <h2>Import queue</h2>

      {/* Upload */}
      <form onSubmit={doUpload} className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="file" accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <input
            type="text" placeholder="source tag (e.g. xiaomi-iraq-2026-05)"
            value={source} onChange={(e) => setSource(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button type="submit" className="primary" disabled={!file || uploading}>
            {uploading ? 'Uploading…' : 'Upload CSV'}
          </button>
          {uploadMsg && <span className="muted" style={{ marginLeft: 8 }}>{uploadMsg}</span>}
        </div>
      </form>

      {/* Status filter pills */}
      <div className="nav" style={{ marginBottom: 12 }}>
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <a key={s} href="#" className={statusFilter === s ? 'active' : ''}
             onClick={(e) => { e.preventDefault(); setStatusFilter(s); }}>
            {s}
          </a>
        ))}
        <button className="secondary" style={{ marginLeft: 'auto' }} onClick={load}>↻ Refresh</button>
      </div>

      {err && <div style={{ color: '#d34', marginBottom: 12 }}>{err}</div>}
      {loading && <div className="muted">Loading…</div>}
      {!loading && jobs.length === 0 && (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
          No {statusFilter} jobs.
        </div>
      )}

      {jobs.map((job) => {
        const v = effective(job);
        const dirty = !!edits[job.id];
        const isExpanded = expanded[job.id];
        const previewLen = 180;
        return (
          <div key={job.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <span style={{ fontWeight: 600 }}>Job #{job.id}</span>
                <span className="muted" style={{ marginLeft: 8 }}>· {job.source}</span>
                {statusFilter !== 'pending' && job.listing_id && (
                  <span className="muted" style={{ marginLeft: 8 }}>→ listing #{job.listing_id}</span>
                )}
                {v.warnings?.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {v.warnings.map((w) => (
                      <span key={w} style={{ background: '#3a2a1c', color: '#f7c97a', padding: '2px 8px', borderRadius: 8, fontSize: 12 }}>
                        ⚠ {WARN_LABEL[w] || w}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {job.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="primary" disabled={busyId === job.id}
                          onClick={() => saveAndApprove(job)}>
                    {busyId === job.id ? '…' : (dirty ? 'Save + Approve' : 'Approve')}
                  </button>
                  <button className="secondary" disabled={busyId === job.id}
                          onClick={() => reject(job)}>Reject</button>
                </div>
              )}
            </div>

            {/* Editable parsed fields */}
            {job.status === 'pending' ? (
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <Field label="Phone"        value={v.phone || ''}        onChange={(s) => patchField(job.id, 'phone', s || null)} />
                <Field label="WhatsApp"     value={v.whatsapp || ''}     onChange={(s) => patchField(job.id, 'whatsapp', s || null)} />
                <Field label="Display name" value={v.display_name || ''} onChange={(s) => patchField(job.id, 'display_name', s || null)} />
                <Field label="Governorate"  value={v.governorate || ''}  onChange={(s) => patchField(job.id, 'governorate', s || null)} />
                <Field label="Brand"        value={v.brand || ''}        onChange={(s) => patchField(job.id, 'brand', s || null)} />
                <Field label="Model"        value={v.model || ''}        onChange={(s) => patchField(job.id, 'model', s || null)} />
                <Field label="Storage"      value={v.storage || ''}      onChange={(s) => patchField(job.id, 'storage', s || null)} />
                <Field label="Asking price (IQD)" type="number"
                       value={String(v.asking_price ?? '')}
                       onChange={(s) => patchField(job.id, 'asking_price', s ? parseInt(s, 10) : null as any)} />
              </div>
            ) : (
              // Read-only summary for approved/rejected jobs.
              <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                {v.brand} {v.model} · {v.storage || '?'} · {v.asking_price ? v.asking_price.toLocaleString() + ' د.ع' : '—'} · {v.governorate || '—'} · phone {v.phone || '—'}
              </div>
            )}

            {/* Image manager — only for pending jobs. Shows already-uploaded
                images as 60×60 thumbs with × remove buttons; a final
                "+ drop here" tile opens the file picker (and accepts
                drag-drop). The original FB photo-viewer URLs from the
                CSV are linked below so the operator can open each in
                a tab, save the JPGs, and drag them onto this zone. */}
            {job.status === 'pending' && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>
                  Images attached: {v.uploaded_images?.length || 0}
                  {v.image_urls?.length ? ` (CSV had ${v.image_urls.length} FB links — open + save below)` : ''}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(v.uploaded_images || []).map((url, i) => (
                    <div key={`${url}-${i}`} style={{ position: 'relative', width: 60, height: 60 }}>
                      <img src={`${API_BASE}${url}`} alt=""
                           style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                      <button onClick={() => removeImage(job.id, i)}
                              title="Remove"
                              style={{
                                position: 'absolute', top: -6, right: -6,
                                width: 18, height: 18, borderRadius: 999,
                                background: '#d34', color: '#fff', border: 'none',
                                fontSize: 11, lineHeight: '16px', padding: 0,
                                cursor: 'pointer',
                              }}>×</button>
                    </div>
                  ))}
                  <DropZone
                    busy={busyId === job.id}
                    onPick={(files) => uploadImages(job.id, files)}
                  />
                </div>
                {v.image_urls?.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
                    Source FB photos (open + save → drop above):{' '}
                    {v.image_urls.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer"
                         style={{ color: '#7aa', marginLeft: 4 }}>
                        [{i + 1}]
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Raw FB description preview */}
            {v.description && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#bbb', lineHeight: 1.6, direction: 'rtl', textAlign: 'right' }}>
                {isExpanded ? v.description : v.description.slice(0, previewLen) + (v.description.length > previewLen ? '…' : '')}
                {v.description.length > previewLen && (
                  <a href="#" onClick={(e) => { e.preventDefault(); setExpanded((p) => ({ ...p, [job.id]: !isExpanded })); }}
                     style={{ marginLeft: 6, color: '#7aa', textDecoration: 'underline', direction: 'ltr', display: 'inline-block' }}>
                    {isExpanded ? 'less' : 'more'}
                  </a>
                )}
              </div>
            )}

            {/* Image thumbnails — render only if FB URLs aren't behind login.
                They almost always are (FB CDN requires session), so the
                operator gets broken images but can still see how many were
                attached and click through to the post. Cheap signal. */}
            {v.image_urls && v.image_urls.length > 0 && (
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                {v.image_urls.length} image link{v.image_urls.length === 1 ? '' : 's'} (FB CDN, may require login):
                {' '}
                {v.image_urls.slice(0, 3).map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer" style={{ color: '#7aa', marginLeft: 6 }}>
                    [{i + 1}]
                  </a>
                ))}
                {v.image_urls.length > 3 && <span> +{v.image_urls.length - 3} more</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }:
  { label: string; value: string; onChange: (s: string) => void; type?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
      <span className="muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
             style={{ padding: '6px 8px', fontSize: 13 }} />
    </label>
  );
}

// Drop-zone tile that doubles as a file-picker. The label-wrap-input
// pattern is the simplest way to make a plain `<input type=file>`
// match the styling around it without an extra Button + DOM-level
// .click() trampoline.
function DropZone({ onPick, busy }: { onPick: (files: FileList | null) => void; busy: boolean }) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragging(false);
        if (busy) return;
        onPick(e.dataTransfer?.files || null);
      }}
      style={{
        width: 60, height: 60, borderRadius: 4,
        border: '2px dashed ' + (dragging ? '#7aa' : '#555'),
        background: dragging ? 'rgba(120,170,170,0.08)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: busy ? 'wait' : 'pointer',
        color: '#888', fontSize: 22, lineHeight: 1,
        opacity: busy ? 0.5 : 1,
      }}
      title="Click or drop images"
    >
      {busy ? '…' : '+'}
      <input type="file" multiple accept="image/jpeg,image/png,image/webp"
             style={{ display: 'none' }}
             disabled={busy}
             onChange={(e) => { onPick(e.target.files); (e.target as HTMLInputElement).value = ''; }} />
    </label>
  );
}
