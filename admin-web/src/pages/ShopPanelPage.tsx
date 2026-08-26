// لوحة التاجر — the per-shop merchant panel. A shop logs in with the
// credentials the admin issued (shops page → "إنشاء دخول اللوحة") and sees
// ONLY its own orders: status chips, customer + items per order, and the
// linear lifecycle actions (تأكيد → شحن → تسليم, إلغاء until delivery).
// Token and API surface are completely separate from the admin's.

import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../api';

const TOKEN_KEY = 'iq_shop_token';
export const getShopToken = () => localStorage.getItem(TOKEN_KEY);
const setShopToken = (t: string | null) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

async function shopApi<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  const token = getShopToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err: any = new Error(data?.error || `http_${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

type OrderItem = {
  id: number; brand: string; model: string; storage?: string | null;
  color?: string | null; qty: number; unit_price: number; line_total: number;
};
type Order = {
  id: number; code: string; status: string; total: number; shipping_fee: number;
  customer_name: string; customer_phone: string; governorate: string;
  address: string; note?: string | null; created_at: number; items: OrderItem[];
};
type Me = {
  id: number; name: string; active_listings: number;
  order_counts: Record<string, number>;
};

const STATUS_AR: Record<string, string> = {
  pending: 'جديد', confirmed: 'مؤكد', shipped: 'بالطريق',
  delivered: 'مُسلَّم', cancelled: 'ملغي',
};
const NEXT_ACTIONS: Record<string, { to: string; label: string; danger?: boolean }[]> = {
  pending: [{ to: 'confirmed', label: 'تأكيد الطلب' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  confirmed: [{ to: 'shipped', label: 'تم الشحن' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  shipped: [{ to: 'delivered', label: 'تم التسليم' }, { to: 'cancelled', label: 'إلغاء', danger: true }],
  delivered: [], cancelled: [],
};
const iqd = (n: number) => Number(n || 0).toLocaleString('en-US');

export function ShopPanelPage({ onExit }: { onExit: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<string>('pending');
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([
        shopApi<Me>('/shop-admin/me'),
        shopApi<Order[]>(`/shop-admin/orders${status ? `?status=${status}` : ''}`),
      ]);
      setMe(m); setOrders(o); setErr('');
    } catch (e: any) {
      if (e.status === 401) { setShopToken(null); onExit(); return; }
      setErr(e.message);
    }
  }, [status, onExit]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  async function move(o: Order, to: string) {
    if (to === 'cancelled' && !confirm(`إلغاء الطلب ${o.code}؟`)) return;
    setBusy(true);
    try { await shopApi(`/shop-admin/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: to }) }); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const counts = me?.order_counts || {};

  return (
    <div dir="rtl" style={{ maxWidth: 860, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{me?.name || '…'}</h1>
          <div style={{ color: '#9ca3af', fontSize: 13 }}>
            لوحة التاجر · {me ? `${me.active_listings} جهاز فعّال` : ''}
          </div>
        </div>
        <button className="secondary" onClick={() => { setShopToken(null); onExit(); }}>خروج</button>
      </div>

      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>خطأ: {err}</div> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.keys(STATUS_AR).map((st) => (
          <button
            key={st}
            className={status === st ? '' : 'secondary'}
            onClick={() => setStatus(st)}
          >
            {STATUS_AR[st]}{counts[st] ? ` (${counts[st]})` : ''}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="card" style={{ color: '#9ca3af' }}>لا توجد طلبات {STATUS_AR[status] ? `بحالة «${STATUS_AR[status]}»` : ''} حالياً.</div>
      ) : orders.map((o) => (
        <div key={o.id} className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <strong style={{ fontSize: 15 }}>{o.code}</strong>
            <span style={{ color: '#9ca3af', fontSize: 12.5 }}>{new Date(o.created_at).toLocaleString()}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 13.5 }}>
            {o.customer_name} · <a href={`tel:${o.customer_phone}`} style={{ color: 'inherit' }}>{o.customer_phone}</a>
          </div>
          <div style={{ color: '#9ca3af', fontSize: 12.5, marginTop: 2 }}>
            {o.governorate} — {o.address}{o.note ? ` · ${o.note}` : ''}
          </div>
          <div style={{ marginTop: 8, borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: 8 }}>
            {o.items.map((it) => (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                <span>{it.brand} {it.model}{it.storage ? ` · ${it.storage}` : ''}{it.qty > 1 ? ` × ${it.qty}` : ''}</span>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{iqd(it.line_total)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginTop: 6, fontWeight: 700 }}>
              <span>المجموع (مع التوصيل {iqd(o.shipping_fee)})</span>
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{iqd(o.total)} د.ع</span>
            </div>
          </div>
          {NEXT_ACTIONS[o.status]?.length ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {NEXT_ACTIONS[o.status].map((a) => (
                <button key={a.to} className={a.danger ? 'danger' : 'primary'} disabled={busy} onClick={() => move(o, a.to)}>
                  {a.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// Login form for the merchant panel — reached from a link on the admin
// login screen. Successful login stores the shop token and re-renders the
// app shell into panel mode.
export function ShopLogin({ onAuth, onBack }: { onAuth: () => void; onBack: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await shopApi<{ token: string }>('/shop-admin/login', {
        method: 'POST', body: JSON.stringify({ username: username.trim(), password }),
      });
      setShopToken(r.token);
      onAuth();
    } catch (e2: any) {
      setErr(e2?.data?.error === 'bad_credentials' ? 'بيانات الدخول غير صحيحة.' : (e2.message || 'فشل الدخول'));
    } finally { setBusy(false); }
  }

  return (
    <div dir="rtl" style={{ maxWidth: 380, margin: '10vh auto', padding: 16 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>دخول لوحة التاجر</h2>
        <form onSubmit={submit}>
          <input
            placeholder="اسم المستخدم"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
            autoFocus
          />
          <input
            placeholder="كلمة المرور"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          {err ? <div style={{ color: 'salmon', fontSize: 13, marginBottom: 8 }}>{err}</div> : null}
          <button className="primary" disabled={busy} style={{ width: '100%' }}>دخول</button>
        </form>
        <button className="ghost" onClick={onBack} style={{ marginTop: 10 }}>→ لوحة الإدارة</button>
      </div>
    </div>
  );
}
