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
import QRCode from 'qrcode';
import { db, getSetting } from '../db.js';
import { logEvent } from '../eventLog.js';

const r = Router();

// Page addresses on the brand domain; images from the host that stores them.
import { SITE_URL, MEDIA_URL, jsonLd, shopJsonLd, breadcrumbJsonLd } from '../seo.js';

const PUBLIC_BASE = MEDIA_URL;
const PLAY_URL = 'https://play.google.com/store/apps/details?id=org.iqmobile.app';
const APPSTORE_URL = 'https://apps.apple.com/app/id6776442942';

const GOV_AR = {
  Baghdad: 'بغداد', Basra: 'البصرة', Erbil: 'اربيل', Sulaymaniyah: 'السليمانية',
  Duhok: 'دهوك', Kirkuk: 'كركوك', Najaf: 'النجف', Karbala: 'كربلاء',
  Mosul: 'الموصل', Anbar: 'الأنبار', Babil: 'بابل', Diyala: 'ديالى',
  Diwaniyah: 'الديوانية', 'Dhi Qar': 'ذي قار', Maysan: 'ميسان',
  Muthanna: 'المثنى', Salahuddin: 'صلاح الدين', Wasit: 'واسط',
};
import { CONDITION_AR as COND_AR } from '../conditions.js';

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

// ─── the printable sticker ───────────────────────────────────────────
// One page, A5, that both the operator and the shop print. Deliberately a
// web page rather than a generated PNG: the artwork is Arabic, and shaping
// Arabic through sharp/librsvg depends on whatever fonts the droplet
// happens to have, while every browser already does it correctly. "Print
// to PDF" from here is the print file.
//
// Public on purpose — it contains only what the shop's own page already
// shows, and the shop must be able to open it from the app without an
// admin token.
r.get('/shop/:id(\\d+)/sticker', async (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  if (!u) return notFoundPage(res);

  const name = u.shop_name || u.display_name || '';
  const where = [govAr(u.governorate), u.city].filter(Boolean).join(' — ');
  // ?src=sticker is what makes a scan countable — see shopSticker.js. The
  // preview link below deliberately drops it, so an operator checking the
  // page does not inflate the count the operator is about to read.
  const target = `${SITE_URL}/shop/${u.id}?src=sticker`;
  const plain = `${SITE_URL}/shop/${u.id}`;

  // Q, not M: a sticker on a shop window collects dust, glare and fingers,
  // and 25% recovery is what survives that. The extra modules cost nothing
  // at this print size.
  const qr = await QRCode.toString(target, {
    type: 'svg', margin: 0, errorCorrectionLevel: 'Q',
    color: { dark: '#1B1A18', light: '#FFFFFF' },
  });

  const badge = (glyph, small, big) => `<div style="display:flex;align-items:center;gap:2mm;background:#1B1A18;border-radius:2mm;padding:1.6mm 3mm;direction:ltr">
${glyph}<div style="display:flex;flex-direction:column;line-height:1.05">
<span style="font-size:5.5pt;color:#fff;font-family:Helvetica,Arial,sans-serif;letter-spacing:.3px">${small}</span>
<span style="font-size:10pt;font-weight:700;color:#fff;font-family:Helvetica,Arial,sans-serif">${big}</span>
</div></div>`;

  const playGlyph = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 2.2 L14.4 12 L3.6 21.8 Z" fill="#00D3FF"/><path d="M3.6 2.2 L17.6 9.4 L14.4 12 Z" fill="#00F076"/><path d="M14.4 12 L17.6 14.6 L3.6 21.8 Z" fill="#FF3A44"/><path d="M17.6 9.4 L21.4 12 L17.6 14.6 Z" fill="#FFCE00"/></svg>`;
  const appleGlyph = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="#fff"><path d="M15.8 2.1c.2.9-.2 1.8-.7 2.5-.6.7-1.5 1.3-2.5 1.2-.2-.9.3-1.8.8-2.4.6-.7 1.6-1.2 2.4-1.3z"/><path d="M19.5 8.9c-1.7 1-2.7 2.5-2.7 4.4 0 2.1 1.4 3.6 2.9 4.2-.4 1.1-.9 2.1-1.6 3-.9 1.2-1.8 2.4-3.1 2.4-1.3 0-1.7-.7-3.2-.7-1.5 0-1.9.7-3.1.8-1.3 0-2.3-1.3-3.2-2.5-1.8-2.6-3.2-7.3-1.3-10.5.9-1.6 2.6-2.6 4.4-2.6 1.3 0 2.5.8 3.2.8.7 0 2.2-1 3.7-.9.6 0 2.4.3 3.6 1.9z"/></svg>`;

  res.set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'public, max-age=300')
    .send(`<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ملصق ${esc(name)} — iQ Mobile</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;700&display=swap">
<style>
  @page { size: A5 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #6B6660; font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif;
         display: flex; flex-direction: column; align-items: center; gap: 6mm; padding: 8mm 0; }
  .sheet { width: 148mm; height: 210mm; background: #FAF8F5; display: flex; flex-direction: column;
           overflow: hidden; box-shadow: 0 2mm 8mm rgba(0,0,0,.35); }
  .band { height: 25mm; background: #B23F25; padding: 0 11mm; display: flex; align-items: center; gap: 4mm; }
  .logo { width: 14mm; height: 14mm; border-radius: 4mm; background: #fff; color: #B23F25;
          font: 700 15pt/1 Helvetica, Arial, sans-serif; display: flex; align-items: center;
          justify-content: center; direction: ltr; }
  .mid { flex: 1; padding: 9mm 11mm; display: flex; flex-direction: column; align-items: center; }
  .scan { font-size: 40pt; font-weight: 700; color: #1B1A18; line-height: 1.1; margin: 0; }
  .sub { font-size: 13pt; color: #3A352D; margin: 1mm 0 0; }
  .qr { margin-top: 6mm; background: #fff; border: .7mm solid #1B1A18; border-radius: 4mm; padding: 4mm; }
  .qr svg { width: 62mm; height: 62mm; display: block; }
  .name { margin: 6mm 0 0; font-size: 19pt; font-weight: 700; color: #1B1A18; text-align: center; line-height: 1.25; }
  .where { font-size: 11pt; color: #3A352D; margin: 1mm 0 0; }
  .foot { height: 26mm; background: #F2EEE8; border-top: .3mm solid rgba(27,26,24,.25);
          padding: 0 9mm; display: flex; align-items: center; gap: 3mm; }
  .foot p { flex: 1; margin: 0; font-size: 10.5pt; font-weight: 700; color: #3A352D; line-height: 1.35; }
  .bar { width: 148mm; display: flex; gap: 3mm; align-items: center; justify-content: center; }
  .bar button, .bar a { font: 600 14px/1 'IBM Plex Sans Arabic', system-ui, sans-serif; color: #1B1A18;
    background: #FAF8F5; border: 1px solid rgba(255,255,255,.4); border-radius: 10px; padding: 10px 16px;
    cursor: pointer; text-decoration: none; }
  @media print { body { background: #fff; padding: 0; gap: 0; } .sheet { box-shadow: none; } .bar { display: none; } }
</style></head>
<body>
<div class="bar"><button onclick="window.print()">اطبع الملصق</button><a href="${esc(plain)}">صفحة المتجر</a></div>
<div class="sheet">
  <div class="band">
    <div class="logo">iQ</div>
    <div style="flex:1">
      <div style="font-size:13pt;font-weight:700;color:#fff">متجرنا على تطبيق iQ موبايل</div>
      <div style="font-size:9.5pt;color:#FBE7E0;margin-top:.5mm">أجهزة وأسعار محدّثة يومياً</div>
    </div>
  </div>
  <div class="mid">
    <h1 class="scan">امسح الكود</h1>
    <p class="sub">وشوف كل أجهزتنا وأسعارنا</p>
    <div class="qr">${qr}</div>
    <p class="name">${esc(name)}</p>
    ${where ? `<p class="where">${esc(where)}</p>` : ''}
  </div>
  <div class="foot">
    <p>ما عندك<br>التطبيق؟ نزّله:</p>
    ${badge(playGlyph, 'GET IT ON', 'Google Play')}
    ${badge(appleGlyph, 'Download on the', 'App Store')}
  </div>
</div>
</body></html>`);
});

r.get('/shop/:id(\\d+)', (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=? AND seller_type='shop'").get(req.params.id);
  // A hit that came off the printed sticker. Logged before the 404 check is
  // pointless, so it sits here — a scan of a sticker for a deleted shop is
  // not a scan anyone can act on.
  if (u && req.query.src === 'sticker') logEvent({ type: 'shop.sticker_scan', shop_id: u.id });
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
  const pageUrl = `${SITE_URL}/shop/${u.id}`;

  const cards = listings.map((l) => {
    const im = imgFor.get(l.id);
    const src = im ? PUBLIC_BASE + im.image_path : '';
    const badge = l.status === 'sold' ? '<span class="badge sold">مباع</span>'
      : l.status === 'reserved' ? '<span class="badge res">محجوز</span>'
      : l.status === 'expired' ? '<span class="badge exp">منتهي</span>' : '';
    // data-q is the pre-lowercased haystack the search box matches against, so
    // the filter never has to read text out of the DOM on every keystroke.
    const hay = `${l.brand || ''} ${l.model || ''} ${l.storage || ''}`.toLowerCase();
    return `<a class="card" data-brand="${esc(l.brand || '')}" data-q="${esc(hay)}" href="${SITE_URL}/l/${l.id}">
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
  // A text box plus a brand dropdown, rather than a row of chips. Chips wrapped
  // onto three lines with nine brands, and as a single scrolling row the later
  // ones were off-screen with nothing to suggest they existed.
  const filterBar = `<div class="filters">
    <div class="sbox">
      <input id="q" type="search" placeholder="ابحث في إعلانات المتجر…" autocomplete="off">
    </div>
    ${brandCounts.length > 1 ? `<select id="brand">
      <option value="">كل الماركات (${listings.length})</option>
      ${brandCounts.map(([b, n]) => `<option value="${esc(b)}">${esc(b)} (${n})</option>`).join('')}
    </select>` : ''}
    <div class="count" id="count" hidden></div>
  </div>`;

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
  .filters{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 12px;align-items:center}
  .sbox{flex:1 1 180px;display:flex}
  #q{flex:1;font:inherit;font-size:14px;padding:10px 12px;border-radius:12px;
     border:1px solid var(--line);background:#fff;color:var(--ink);min-width:0}
  #brand{font:inherit;font-size:14px;font-weight:700;padding:10px 12px;border-radius:12px;
         border:1px solid var(--line);background:#fff;color:var(--ink)}
  .count{flex-basis:100%;font-size:12.5px;color:#6b7280}
  .empty{padding:28px 16px;text-align:center;color:#6b7280;font-size:14px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px 16px}
  .card{display:block;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
  /* Must beat .card's display:block — a class selector outranks the UA
     stylesheet's [hidden]{display:none}, so without this the brand filter
     sets .hidden on the cards and nothing visually changes. */
  .card[hidden],[hidden]{display:none!important}
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
${jsonLd(shopJsonLd(u, { logo: cover || null, listingCount: listings.length }))}
${jsonLd(breadcrumbJsonLd([
  { name: 'iQ Mobile', url: `${SITE_URL}/` },
  { name: u.shop_name || u.display_name, url: pageUrl },
]))}
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
  <div class="empty" id="empty" hidden>لا توجد نتائج مطابقة.</div>
  <div class="cta">
    <p>لتصفّح المتجر كاملاً والتواصل، حمّل تطبيق iQ Mobile</p>
    <div class="stores">
      <a class="btn primary" href="${PLAY_URL}&referrer=shop_${u.id}">Google Play</a>
      <a class="btn dark" href="${APPSTORE_URL}">App Store</a>
    </div>
  </div>
</div>
<script>
// Client-side so typing is instant and costs no round trip. Every card is
// already in the DOM; this only toggles display and never refetches.
(function () {
  var grid  = document.getElementById('grid');
  var empty = document.getElementById('empty');
  var q     = document.getElementById('q');
  var brand = document.getElementById('brand');
  var count = document.getElementById('count');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.children);

  function apply() {
    var term = (q && q.value || '').trim().toLowerCase();
    var want = (brand && brand.value) || '';
    var shown = 0;
    cards.forEach(function (card) {
      var hit = (!want || card.getAttribute('data-brand') === want)
             && (!term || (card.getAttribute('data-q') || '').indexOf(term) !== -1);
      card.hidden = !hit;
      if (hit) shown++;
    });
    empty.hidden = shown > 0;
    if (count) {
      var filtering = !!term || !!want;
      count.hidden = !filtering;
      count.textContent = filtering ? (shown + ' من ' + cards.length) : '';
    }
  }
  if (q) q.addEventListener('input', apply);
  if (brand) brand.addEventListener('change', apply);
})();
</script>
</body></html>`;

  res.set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'public, max-age=300')
    .send(html);
});

export default r;
