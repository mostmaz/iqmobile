// Public, shareable web page for a single listing — the landing page the
// Facebook/Instagram marketing posts link to. Server-rendered HTML (no app
// needed) with Open Graph tags so WhatsApp/FB/Telegram show a rich preview,
// and a clear "get the app to contact the seller" call to action.
//
// Privacy: the seller's phone/WhatsApp is deliberately NOT shown here — the
// public web is not the place to expose a number. Buyers are funnelled into
// the app to make contact (which is also where the contact analytics live).

import { Router } from 'express';
import { db } from '../db.js';

const r = Router();

const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://api.iqmobile.org').replace(/\/+$/, '');
const PLAY_URL = 'https://play.google.com/store/apps/details?id=org.iqmobile.app';
const APPSTORE_URL = 'https://apps.apple.com/app/id6776442942';

const GOV_AR = {
  Baghdad: 'بغداد', Basra: 'البصرة', Erbil: 'اربيل', Sulaymaniyah: 'السليمانية',
  Duhok: 'دهوك', Kirkuk: 'كركوك', Najaf: 'النجف', Karbala: 'كربلاء',
  Mosul: 'الموصل', Anbar: 'الأنبار', Babil: 'بابل', Diyala: 'ديالى',
  Diwaniyah: 'الديوانية', 'Dhi Qar': 'ذي قار', Maysan: 'ميسان',
  Muthanna: 'المثنى', Salahuddin: 'صلاح الدين', Wasit: 'واسط',
};
const COND_AR = { new: 'جديد', used: 'مستعمل', refurbished: 'مجدّد', repaired: 'مصلّح' };

// Escape every dynamic value before it lands in HTML/attribute context —
// model + description are user input, so this is the XSS guard.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function govAr(g) { return GOV_AR[g] || g || ''; }
function fmtPrice(n) { return Number(n || 0).toLocaleString('en-US'); }

function notAvailablePage(res) {
  res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>الإعلان غير متوفر — iQ Mobile</title>
<meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;background:#ECE6DA;color:#1B1A18;text-align:center;padding:60px 20px">
<h1 style="color:#D9583A">iQ Mobile</h1>
<p style="font-size:18px">هذا الإعلان لم يعد متوفراً.</p>
<p><a href="${PLAY_URL}" style="color:#B23F25">تصفّح إعلانات أخرى على التطبيق</a></p>
</body></html>`);
}

r.get('/:id(\\d+)', (req, res) => {
  const l = db.prepare(
    `SELECT l.*, u.display_name AS seller_name, u.rating_avg, u.rating_count, u.verified
     FROM phone_listings l JOIN users u ON u.id = l.seller_id
     WHERE l.id = ?`,
  ).get(req.params.id);

  // Only surface live listings publicly; removed/expired ones 404 politely.
  if (!l || l.status === 'removed' || l.status === 'expired') return notAvailablePage(res);

  const images = db.prepare(
    'SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC',
  ).all(l.id);
  const imgUrls = images.map((im) => PUBLIC_BASE + im.image_path);
  const cover = imgUrls[0] || `${PUBLIC_BASE}/uploads/`;

  const title = `${esc(l.brand)} ${esc(l.model)} — ${fmtPrice(l.asking_price)} د.ع`;
  const locality = [govAr(l.governorate), esc(l.city)].filter(Boolean).join(' - ');
  const condAr = COND_AR[l.condition] || esc(l.condition || '');
  const desc = `${condAr}${l.storage ? ' · ' + esc(l.storage) : ''} · ${locality}`;
  const pageUrl = `${PUBLIC_BASE}/l/${l.id}`;
  const soldBadge = l.status === 'sold' ? '<span class="sold">تم البيع</span>'
    : l.status === 'reserved' ? '<span class="sold" style="background:#f59e0b">محجوز</span>' : '';

  const specRows = [
    ['الحالة', condAr],
    ['السعة', l.storage],
    ['اللون', l.color],
    l.condition === 'used' && l.battery_health ? ['البطارية', `${l.battery_health}٪`] : null,
    ['الضمان', l.warranty_status],
    ['الموقع', locality],
  ].filter((row) => row && row[1]);

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — iQ Mobile</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="iQ Mobile">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(cover)}">
<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root{--accent:#D9583A;--deep:#B23F25;--cream:#ECE6DA;--ink:#1B1A18;--line:#e5ddd0}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--cream);color:var(--ink)}
  .wrap{max-width:520px;margin:0 auto;background:#fff;min-height:100vh}
  header{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0}
  .logo{width:34px;height:34px;border-radius:9px;background:var(--accent);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}
  .brandname{font-weight:800}
  .gallery{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;background:#111}
  .gallery img{width:100%;flex:0 0 100%;scroll-snap-align:center;aspect-ratio:1/1;object-fit:contain;background:#111}
  .body{padding:16px}
  h1{font-size:20px;margin:0 0 4px}
  .price{font-size:30px;font-weight:800;color:var(--deep);margin:8px 0}
  .sold{display:inline-block;background:#ef4444;color:#fff;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;margin-inline-start:8px;vertical-align:middle}
  .loc{color:#6b7280;font-size:14px}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  td{padding:9px 4px;border-bottom:1px solid var(--line);font-size:14px}
  td:first-child{color:#6b7280;width:38%}
  .desc{white-space:pre-wrap;line-height:1.7;font-size:14px;color:#333;margin-top:6px}
  .seller{display:flex;align-items:center;gap:8px;margin:14px 0;padding:12px;background:var(--cream);border-radius:12px}
  .cta{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--line);padding:12px 16px}
  .cta p{margin:0 0 8px;font-size:13px;color:#6b7280;text-align:center}
  .stores{display:flex;gap:10px}
  .btn{flex:1;text-align:center;text-decoration:none;padding:12px;border-radius:12px;font-weight:700;font-size:14px}
  .btn.primary{background:var(--accent);color:#fff}
  .btn.dark{background:var(--ink);color:#fff}
  h3{margin:16px 0 6px;font-size:15px}
</style>
</head>
<body>
<div class="wrap">
  <header><div class="logo">iQ</div><div class="brandname">iQ Mobile</div></header>
  ${imgUrls.length ? `<div class="gallery">${imgUrls.map((u) => `<img src="${esc(u)}" alt="${title}" loading="lazy">`).join('')}</div>` : ''}
  <div class="body">
    <h1>${esc(l.brand)} ${esc(l.model)}${soldBadge}</h1>
    <div class="loc">📍 ${esc(locality)}</div>
    <div class="price">${fmtPrice(l.asking_price)} <span style="font-size:18px">د.ع</span></div>
    <table>${specRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    ${l.description ? `<h3>الوصف</h3><div class="desc">${esc(l.description)}</div>` : ''}
    <div class="seller">
      <div class="logo" style="background:var(--deep)">${esc((l.seller_name || '؟').slice(0, 1))}</div>
      <div>
        <div style="font-weight:700">${esc(l.seller_name || 'بائع')}${l.verified ? ' ✅' : ''}</div>
        ${l.rating_count ? `<div style="font-size:12px;color:#6b7280">★ ${Number(l.rating_avg).toFixed(1)} (${l.rating_count})</div>` : ''}
      </div>
    </div>
  </div>
  <div class="cta">
    <p>للتواصل مع البائع، حمّل تطبيق iQ Mobile</p>
    <div class="stores">
      <a class="btn primary" href="${PLAY_URL}">Google Play</a>
      <a class="btn dark" href="${APPSTORE_URL}">App Store</a>
    </div>
  </div>
</div>
</body></html>`;

  res.set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'public, max-age=300')
    .send(html);
});

export default r;
