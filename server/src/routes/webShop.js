// Public, shareable web page for a shop — the browser fallback for the
// /shop/:id banner deep-link.
//
// Why this exists: BannerCarousel only started intercepting …/shop/:id in
// 0.1.6. Every build at 0.1.5 and below hands the URL to the browser, and
// until now that URL 404'd, so tapping a shop banner on an installed app
// landed the user on "Cannot GET /shop/2548". This route turns that dead end
// into the shop itself, and doubles as the link preview for sharing.
//
// Mirrors webListing.js: server-rendered, Open Graph tags, and the same
// privacy stance — no phone numbers on the public web, contact happens in the
// app. Shops flagged shop_no_contact have none to show anyway.

import { Router } from 'express';
import { db, getSetting } from '../db.js';

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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function govAr(g) { return GOV_AR[g] || g || ''; }
function fmtPrice(n) { return Number(n || 0).toLocaleString('en-US'); }

function notFoundPage(res) {
  res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>المتجر غير متوفر — iQ Mobile</title>
<meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;background:#ECE6DA;color:#1B1A18;text-align:center;padding:60px 20px">
<h1 style="color:#D9583A">iQ Mobile</h1>
<p style="font-size:18px">هذا المتجر غير متوفر.</p>
<p><a href="${PLAY_URL}" style="color:#B23F25">تصفّح المتاجر على التطبيق</a></p>
</body></html>`);
}

r.get('/shop/:id(\\d+)', (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  // Hidden shops stay reachable by direct id — that is the whole point of the
  // flag (a banner links straight here); it only removes them from the
  // directory. Only a non-existent shop 404s.
  if (!u) return notFoundPage(res);

  const neverExpire = getSetting('listings_never_expire') !== '0';
  const statusClause = neverExpire
    ? "status IN ('active','reserved','sold','expired')"
    : "status IN ('active','reserved','sold','expired') AND expires_at > ?";
  const nowTs = Date.now();
  // Render the whole catalogue (capped for sanity) rather than a short page:
  // the brand filter below is client-side, and filtering a truncated list
  // would show "Xiaomi 31" then reveal only the handful that made the cut.
  const listings = db.prepare(
    `SELECT * FROM phone_listings WHERE seller_id=? AND ${statusClause}
      ORDER BY created_at DESC LIMIT 300`,
  ).all(...(neverExpire ? [u.id] : [u.id, nowTs]));

  const imgFor = db.prepare(
    'SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC LIMIT 1',
  );

  const name = u.shop_name || u.display_name;
  const locality = [govAr(u.governorate), u.city].filter(Boolean).join(' - ');
  const count = db.prepare(
    "SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND status IN ('active','reserved','sold','expired')",
  ).get(u.id).n;
  const logo = u.shop_image_path || u.profile_image_path;
  const cover = logo ? PUBLIC_BASE + logo : (listings.length && imgFor.get(listings[0].id)
    ? PUBLIC_BASE + imgFor.get(listings[0].id).image_path : '');
  const desc = u.shop_bio || `${count} إعلان · ${locality}`;
  const pageUrl = `${PUBLIC_BASE}/shop/${u.id}`;

  const cards = listings.map((l) => {
    const im = imgFor.get(l.id);
    const src = im ? PUBLIC_BASE + im.image_path : '';
    const badge = l.status === 'sold' ? '<span class="badge sold">مباع</span>'
      : l.status === 'reserved' ? '<span class="badge res">محجوز</span>'
      : l.status === 'expired' ? '<span class="badge exp">منتهي</span>' : '';
    return `<a class="card" data-brand="${esc(l.brand || '')}" href="${PUBLIC_BASE}/l/${l.id}">
      <div class="thumb">${src ? `<img src="${esc(src)}" alt="${esc(l.brand)} ${esc(l.model)}" loading="lazy">` : `<span class="ph">${esc(l.brand)}</span>`}</div>
      <div class="meta">
        <div class="t">${esc(l.brand)} ${esc(l.model)}${badge}</div>
        <div class="p">${fmtPrice(l.asking_price)} <span>د.ع</span></div>
        <div class="s">${esc(COND_AR[l.condition] || l.condition || '')}${l.storage ? ' · ' + esc(l.storage) : ''}</div>
      </div>
    </a>`;
  }).join('');

  // Brand chips, mirroring the app's shop page: derived from this shop's own
  // inventory so a chip can never filter to nothing, counted, most-stocked
  // first, and omitted entirely for a single-brand shop.
  const brandCounts = (() => {
    const m = new Map();
    for (const l of listings) if (l.brand) m.set(l.brand, (m.get(l.brand) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  })();
  const filterBar = brandCounts.length > 1 ? `<div class="filters" id="filters">
    <button class="chip on" data-b="">الكل <i>${listings.length}</i></button>
    ${brandCounts.map(([b, n]) => `<button class="chip" data-b="${esc(b)}">${esc(b)} <i>${n}</i></button>`).join('')}
  </div>` : '';

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — iQ Mobile</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="iQ Mobile">
<meta property="og:title" content="${esc(name)}">
<meta property="og:description" content="${esc(desc)}">
${cover ? `<meta property="og:image" content="${esc(cover)}">` : ''}
<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root{--accent:#D9583A;--deep:#B23F25;--cream:#ECE6DA;--ink:#1B1A18;--line:#e5ddd0}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--cream);color:var(--ink)}
  .wrap{max-width:520px;margin:0 auto;background:#fff;min-height:100vh}
  header{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
  .logo{width:34px;height:34px;border-radius:9px;background:var(--accent);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}
  .brandname{font-weight:800}
  .shop{display:flex;gap:12px;align-items:center;padding:16px}
  .shop .avatar{width:64px;height:64px;border-radius:16px;object-fit:cover;background:var(--cream);display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:var(--deep)}
  .shop h1{font-size:19px;margin:0 0 3px}
  .loc{color:#6b7280;font-size:13px}
  .bio{padding:0 16px 14px;font-size:14px;line-height:1.7;color:#333}
  .filters{display:flex;gap:8px;overflow-x:auto;padding:0 16px 12px;scrollbar-width:none}
  .filters::-webkit-scrollbar{display:none}
  .chip{flex:0 0 auto;font:inherit;font-size:13px;font-weight:700;cursor:pointer;
        padding:8px 14px;border-radius:999px;border:1px solid var(--line);
        background:#fff;color:var(--ink);display:flex;align-items:center;gap:6px}
  .chip i{font-style:normal;font-size:11px;font-weight:600;color:#9ca3af}
  .chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .chip.on i{color:rgba(255,255,255,.65)}
  .empty{padding:28px 16px;text-align:center;color:#6b7280;font-size:14px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px 16px}
  .card{display:block;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
  .thumb{aspect-ratio:1/1;background:var(--cream);display:flex;align-items:center;justify-content:center;overflow:hidden}
  .thumb img{width:100%;height:100%;object-fit:contain}
  .ph{font-size:13px;color:#9ca3af;letter-spacing:.12em;text-transform:uppercase}
  .meta{padding:8px 10px}
  .t{font-size:13px;font-weight:700;line-height:1.4;min-height:2.6em}
  .p{font-size:16px;font-weight:800;color:var(--deep);margin-top:3px}
  .p span{font-size:11px;font-weight:600}
  .s{font-size:11px;color:#6b7280;margin-top:2px}
  .badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;margin-inline-start:5px;color:#fff;vertical-align:middle}
  .sold{background:#ef4444}.res{background:#f59e0b}.exp{background:#6b7280}
  .cta{position:sticky;bottom:0;background:#fff;border-top:1px solid var(--line);padding:12px 16px}
  .cta p{margin:0 0 8px;font-size:13px;color:#6b7280;text-align:center}
  .stores{display:flex;gap:10px}
  .btn{flex:1;text-align:center;text-decoration:none;padding:12px;border-radius:12px;font-weight:700;font-size:14px}
  .btn.primary{background:var(--accent);color:#fff}
  .btn.dark{background:var(--ink);color:#fff}
</style>
</head>
<body>
<div class="wrap">
  <header><div class="logo">iQ</div><div class="brandname">iQ Mobile</div></header>
  <div class="shop">
    ${logo ? `<img class="avatar" src="${esc(PUBLIC_BASE + logo)}" alt="${esc(name)}">`
           : `<div class="avatar">${esc((name || '؟').trim().slice(0, 1))}</div>`}
    <div>
      <h1>${esc(name)}${u.verified ? ' ✅' : ''}</h1>
      <div class="loc">📍 ${esc(locality)} · ${count} إعلان</div>
    </div>
  </div>
  ${u.shop_bio ? `<div class="bio">${esc(u.shop_bio)}</div>` : ''}
  ${filterBar}
  <div class="grid" id="grid">${cards}</div>
  <div class="empty" id="empty" hidden>لا توجد أجهزة من هذه الماركة.</div>
  <div class="cta">
    <p>لتصفّح المتجر كاملاً والتواصل، حمّل تطبيق iQ Mobile</p>
    <div class="stores">
      <a class="btn primary" href="${PLAY_URL}&referrer=shop_${u.id}">Google Play</a>
      <a class="btn dark" href="${APPSTORE_URL}">App Store</a>
    </div>
  </div>
</div>
${brandCounts.length > 1 ? `<script>
// Client-side so a chip tap is instant and costs no round trip. Every card is
// already in the DOM, and the filter only toggles display — nothing here
// fetches or rewrites content.
(function () {
  var bar = document.getElementById('filters');
  var grid = document.getElementById('grid');
  var empty = document.getElementById('empty');
  if (!bar || !grid) return;
  bar.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var want = chip.getAttribute('data-b');
    Array.prototype.forEach.call(bar.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('on', c === chip);
    });
    var shown = 0;
    Array.prototype.forEach.call(grid.children, function (card) {
      var hit = !want || card.getAttribute('data-brand') === want;
      card.hidden = !hit;
      if (hit) shown++;
    });
    empty.hidden = shown > 0;
    // Keep the newly filtered grid in view rather than stranding the reader
    // halfway down the previous, longer list.
    window.scrollTo({ top: bar.offsetTop - 8, behavior: 'smooth' });
  });
})();
</script>` : ''}
</body></html>`;

  res.set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'public, max-age=300')
    .send(html);
});

export default r;
