// Linking the WhatsApp number the nudges are sent from, and watching it stay
// linked.
//
// The QR arrives already drawn, as SVG, from our own server — the pairing
// string is a credential (whoever scans it links a device to the account),
// so it is never handed to an image service to be rendered.
//
// Polls every 4 seconds while unlinked because a WhatsApp QR expires in
// roughly twenty, and every 30 once linked, which is only a liveness check.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Status = {
  connection: string;
  linked: boolean;
  qr_available: boolean;
  qr_svg: string | null;
  auth_dir_exists: boolean;
  last_error: string | null;
};

const CONNECTION_AR: Record<string, string> = {
  idle: 'غير متصل',
  connecting: 'يتصل…',
  open: 'مربوط',
  close: 'انقطع — يعيد المحاولة',
  logged_out: 'أُلغي الربط من الهاتف',
  unavailable: 'المكتبة غير متوفرة على الخادم',
};

export function WhatsAppPage() {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      setSt(await api<Status>('/admin/whatsapp/status'));
      setErr('');
    } catch (e: any) { setErr(e.message); }
  }, []);

  useEffect(() => {
    load();
    const schedule = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => { await load(); schedule(); }, st?.linked ? 30000 : 4000);
    };
    schedule();
    return () => clearTimeout(timer.current);
  }, [load, st?.linked]);

  async function connect() {
    setBusy(true);
    try { await api('/admin/whatsapp/connect', { method: 'POST' }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function unlink() {
    if (!confirm('إلغاء الربط؟ راح تحتاج تمسح كود جديد حتى ترجع ترسل.')) return;
    setBusy(true);
    try { await api('/admin/whatsapp/unlink', { method: 'POST' }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div dir="rtl">
      {err ? <div className="card" style={{ color: 'salmon', marginBottom: 12 }}>Error: {err}</div> : null}

      <div className="card">
        <div className="chart-title">ربط رقم واتساب</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.8 }}>
          الرسائل تنرسل من هذا الرقم نفسه، مثل «الأجهزة المرتبطة» بواتساب. الجلسة
          تنحفظ على الخادم وتبقى بعد كل نشر — تمسح الكود مرة وحدة بس.
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 15 }}>الحالة:</strong>
          <span style={{ color: st?.linked ? '#7bd88f' : '#f59e0b', fontWeight: 700 }}>
            {st ? (CONNECTION_AR[st.connection] || st.connection) : '…'}
          </span>
          {st?.last_error ? <span className="muted" style={{ fontSize: 12 }}>({st.last_error})</span> : null}
          <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 8 }}>
            {!st?.linked ? (
              <button className="primary" disabled={busy} onClick={connect}>ابدأ الربط</button>
            ) : null}
            {st?.auth_dir_exists ? (
              <button className="danger" disabled={busy} onClick={unlink}>إلغاء الربط</button>
            ) : null}
          </span>
        </div>
      </div>

      {st?.linked ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, lineHeight: 1.9 }}>
            الرقم مربوط ويقدر يرسل. تشوفه بالهاتف: واتساب ← الإعدادات ← الأجهزة
            المرتبطة ← «iQ Mobile». إلغاؤه من هناك يوقف الإرسال فوراً.
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <ol style={{ fontSize: 14, lineHeight: 2, paddingInlineStart: 20, margin: '0 0 12px' }}>
            <li>افتح واتساب على الهاتف صاحب الرقم <strong>07502062804</strong></li>
            <li>الإعدادات ← <strong>الأجهزة المرتبطة</strong> ← ربط جهاز</li>
            <li>امسح الكود تحت — ينتهي خلال ثوانٍ، والصفحة تجيب واحد جديد لحالها</li>
          </ol>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 300, background: '#fff', borderRadius: 12, padding: 16,
          }}>
            {st?.qr_svg
              ? <div style={{ width: 280, height: 280 }} dangerouslySetInnerHTML={{ __html: st.qr_svg }} />
              : <span className="muted" style={{ color: '#666' }}>
                  {st?.connection === 'connecting' ? 'يجهّز الكود…' : 'اضغط «ابدأ الربط»'}
                </span>}
          </div>
        </div>
      )}
    </div>
  );
}
