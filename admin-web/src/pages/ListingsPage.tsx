import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setSuccess('');
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
      setSuccess(`Created listing #${r.listing_id} for seller #${r.seller_id}`);
      setForm(EMPTY_FORM);
      setDupe(null);
      onCreated();
    } catch (e: any) {
      setErr(e?.message || 'Failed');
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

        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create listing'}
          </button>
          {err ? <span style={{ color: '#dc2626', fontSize: 13 }}>{err}</span> : null}
          {success ? <span style={{ color: '#16a34a', fontSize: 13 }}>{success}</span> : null}
        </div>
      </form>
    </div>
  );
}

const dupeIconStyle: React.CSSProperties = {
  position: 'absolute',
  insetInlineEnd: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 16,
  pointerEvents: 'auto',
};
