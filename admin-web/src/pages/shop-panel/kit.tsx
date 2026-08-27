// Shared foundation for the store dashboard: design tokens, the scoped API
// client, Arabic formatting, and the primitives every view is built from.
//
// Palette and font are the spec's (§14): the cream marketplace theme the
// shop owner already knows from the app, not a separate admin skin.
import React, { useEffect, useState } from 'react';
import { API_BASE } from '../../api';

// ─── tokens ──────────────────────────────────────────────────────────
export const T = {
  accent: '#D9583A',
  deep: '#B23F25',
  bg: '#ECE6DA',
  surface: '#F5F0E6',
  ink: '#1B1A18',
  subtle: '#6E6A62',
  chip: '#E2DBCB',
  green: '#1F6B5C',
  greenSoft: 'rgba(31,107,92,0.13)',
  red: '#B43A2E',
  redSoft: 'rgba(180,58,46,0.10)',
  line: 'rgba(27,26,24,0.08)',
  line2: 'rgba(27,26,24,0.14)',
  scrim: 'rgba(27,26,24,0.45)',
};
export const FONT = "'Cairo', system-ui, sans-serif";

// ─── auth ────────────────────────────────────────────────────────────
const TOKEN_KEY = 'iq_shop_token';
export const getShopToken = () => localStorage.getItem(TOKEN_KEY);
export const setShopToken = (t: string | null) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

export async function shopApi<T2 = any>(path: string, init: RequestInit = {}): Promise<T2> {
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

/** Multipart upload (images) — same auth, no JSON content-type. */
export async function shopUpload(path: string, form: FormData) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${getShopToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json().catch(() => ({}));
}

// ─── formatting ──────────────────────────────────────────────────────
const AR_D = '٠١٢٣٤٥٦٧٨٩';
export const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_D[+d]);
export const money = (n: number) => Number(n || 0).toLocaleString('en-US');
export const agoAr = (ms: number) => {
  const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return `منذ ${arNum(m)} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `منذ ${arNum(h)} ساعة`;
  return `منذ ${arNum(Math.round(h / 24))} يوم`;
};

const GOV_AR: Record<string, string> = {
  Baghdad: 'بغداد', Basra: 'البصرة', Nineveh: 'نينوى', Erbil: 'أربيل',
  Sulaymaniyah: 'السليمانية', Duhok: 'دهوك', Kirkuk: 'كركوك', Anbar: 'الأنبار',
  Babil: 'بابل', Karbala: 'كربلاء', Najaf: 'النجف', Wasit: 'واسط',
  Maysan: 'ميسان', 'Dhi Qar': 'ذي قار', Muthanna: 'المثنى', Qadisiyyah: 'القادسية',
  Diyala: 'ديالى', Saladin: 'صلاح الدين',
};
export const govAr = (g?: string | null) => (g && GOV_AR[g]) || g || '';

/** ≥900px gets the desktop layout — a table, not cards (spec §5). */
export function useWide(px = 900) {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= px);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= px);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [px]);
  return wide;
}

// ─── primitives ──────────────────────────────────────────────────────
export function Card({ children, style, pad = 16 }: { children: React.ReactNode; style?: React.CSSProperties; pad?: number }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.line}`, borderRadius: 18,
      padding: pad, marginBottom: 12, ...style,
    }}>{children}</div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ font: `700 15px ${FONT}`, color: T.ink }}>{children}</div>
      {action}
    </div>
  );
}

export function Btn({ children, onClick, kind = 'primary', disabled, style, type }: {
  children: React.ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'ink';
  disabled?: boolean; style?: React.CSSProperties; type?: 'button' | 'submit';
}) {
  const map = {
    primary: { background: T.accent, color: '#fff', border: 'none' },
    ink: { background: T.ink, color: T.surface, border: 'none' },
    ghost: { background: 'transparent', color: T.ink, border: `1px solid ${T.line2}` },
    danger: { background: 'transparent', color: T.red, border: `1px solid ${T.redSoft}` },
  }[kind];
  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 12, padding: '11px 16px', cursor: disabled ? 'not-allowed' : 'pointer',
        font: `700 13px ${FONT}`, opacity: disabled ? 0.55 : 1, ...map, ...style,
      }}
    >{children}</button>
  );
}

export const inputStyle: React.CSSProperties = {
  background: '#fff', border: `1px solid ${T.line2}`, borderRadius: 10,
  padding: '10px 12px', font: `400 13.5px ${FONT}`, color: T.ink,
  outline: 'none', width: '100%', boxSizing: 'border-box',
};

export function Chip({ label, on, onClick, count }: { label: string; on?: boolean; onClick?: () => void; count?: number }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 14px', borderRadius: 999, cursor: 'pointer',
      background: on ? T.accent : T.chip, border: 'none',
      font: `600 12.5px ${FONT}`, color: on ? '#fff' : '#3A352D',
    }}>
      {label}{count ? ` ${arNum(count)}` : ''}
    </button>
  );
}

// ─── the three mandatory states (spec §14) ───────────────────────────
export function Skeleton({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          background: T.surface, border: `1px solid ${T.line}`, borderRadius: 18,
          height, marginBottom: 10, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', inset: 12, background: T.chip, borderRadius: 8, opacity: 0.6 }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <Card style={{ textAlign: 'center', padding: 30 }}>
      <div style={{ font: `700 15px ${FONT}`, color: T.ink }}>{title}</div>
      {body ? <div style={{ font: `400 12.5px ${FONT}`, color: T.subtle, marginTop: 6, lineHeight: 1.7 }}>{body}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </Card>
  );
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Card style={{ borderColor: T.redSoft }}>
      <div style={{ font: `600 13.5px ${FONT}`, color: T.red }}>تعذّر تحميل البيانات</div>
      <div style={{ font: `400 12px ${FONT}`, color: T.subtle, marginTop: 4 }}>{error}</div>
      {onRetry ? <div style={{ marginTop: 10 }}><Btn kind="ghost" onClick={onRetry}>إعادة المحاولة</Btn></div> : null}
    </Card>
  );
}

/**
 * Per-device diagnostics (spec §7). THE rule of this dashboard: a weak
 * number never appears without the reason it is weak and the thing to do
 * about it. The component takes the reason as a REQUIRED prop, so a caller
 * cannot render a bare bad metric even by accident.
 */
export function DeviceDiagnostic({ reason, deltaPct, photos, lastContactAt, views }: {
  reason: string | null;
  deltaPct?: number | null;
  photos?: number;
  lastContactAt?: number | null;
  views?: number;
}) {
  if (!reason || reason === 'ok') {
    return (
      <span style={{ font: `400 11.5px ${FONT}`, color: T.green }}>
        {views != null && views > 0 ? `${arNum(views)} مشاهدة` : 'يشتغل تمام'}
      </span>
    );
  }
  const text = reason === 'price_high'
    ? `سعرك أعلى ${arNum(Math.abs(deltaPct || 0))}٪ من أجهزة مثله`
    : reason === 'few_photos'
      ? `أقل من ٣ صور${photos != null ? ` (${arNum(photos)})` : ''}`
      : lastContactAt
        ? `ما وصلك تواصل من ${arNum(Math.floor((Date.now() - lastContactAt) / 86400000))} يوم`
        : 'ما وصلك ولا تواصل';
  const tone = reason === 'price_high' ? T.red : T.deep;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      font: `600 11.5px ${FONT}`, color: tone,
      background: reason === 'price_high' ? T.redSoft : 'transparent',
      border: reason === 'price_high' ? 'none' : `1px solid ${T.line2}`,
      borderRadius: 999, padding: '3px 9px',
    }}>{text}</span>
  );
}

/** Bulk-action undo toast — 30 seconds, then it's gone (spec §4). */
export function UndoToast({ undo, onUndo, onExpire }: {
  undo: { id: number; affected: number; label: string } | null;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(30);
  useEffect(() => {
    if (!undo) return;
    setLeft(30);
    const iv = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) { clearInterval(iv); onExpire(); return 0; }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [undo, onExpire]);
  if (!undo) return null;
  return (
    <div style={{
      position: 'fixed', insetInline: 0, bottom: 86, margin: '0 auto', width: 'fit-content',
      background: T.ink, color: T.surface, borderRadius: 14, padding: '12px 18px',
      display: 'flex', alignItems: 'center', gap: 14, zIndex: 60,
      boxShadow: '0 8px 30px rgba(27,26,24,0.25)',
    }}>
      <span style={{ font: `600 13px ${FONT}` }}>
        {undo.label} · {arNum(undo.affected)} جهاز
      </span>
      <button onClick={onUndo} style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        font: `700 13px ${FONT}`, color: T.accent,
      }}>تراجع ({arNum(left)})</button>
    </div>
  );
}
