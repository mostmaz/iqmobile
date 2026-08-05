// iqmobile.org — the marketplace on the web.
//
// Behaviour splits by device, because the two audiences want opposite things:
//   phone   → straight to the store. Someone on a phone who lands here came
//             from an ad, a bio link or a share; the app is the product and a
//             web browse would be a worse version of it.
//   desktop → the actual marketplace. There is no desktop app, so sending a
//             laptop visitor to a Play Store page is a dead end.
//
// Until now this URL answered "Cannot GET /" — and it is the URL printed on
// both store listings.
//
// Server-rendered on purpose: no build step, no client framework, no external
// fonts or scripts. It renders instantly on a slow Iraqi connection and
// cannot be broken by a blocked CDN.

import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { detect } from './getApp.js';

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
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const govAr = (g) => GOV_AR[g] || g || '';

r.get('/', (req, res) => {
  // 302, never 301: a permanent redirect gets cached by the browser and by
  // link handlers, so someone who first opened this on Android would keep
  // landing on Play even after switching phones — the same reasoning as /get.
  const platform = detect(req.get('user-agent'));
  if (platform === 'ios') return res.redirect(302, APPSTORE_URL);
  if (platform === 'android') return res.redirect(302, `${PLAY_URL}&referrer=web_home`);

  // ── desktop: the marketplace itself ──
  const neverExpire = getSetting('listings_never_expire') !== '0';
  const statusClause = neverExpire
    ? "l.status IN ('active','reserved')"
    : "l.status IN ('active','reserved') AND l.expires_at > " + Date.now();

  const q = String(req.query.q || '').trim().slice(0, 60);
  const brand = String(req.query.brand || '').trim().slice(0, 40);
  const gov = String(req.query.gov || '').trim().slice(0, 40);

  const conds = [statusClause, "COALESCE(u.shop_hidden,0) = 0"];
  const params = [];
  if (brand) { conds.push('l.brand = ?'); params.push(brand); }
  if (gov) { conds.push('l.governorate = ?'); params.push(gov); }
  if (q) {
    conds.push('(l.model LIKE ? OR l.brand LIKE ? OR l.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.join(' AND ');

  // Paginated rather than a bare LIMIT: the header states the true total, and
  // a page that claims 366 listings while rendering 60 with no way forward is
  // just a truncation pretending to be a catalogue.
  const PER_PAGE = 60;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const listings = db.prepare(
    `SELECT l.id, l.brand, l.model, l.storage, l.condition, l.asking_price,
            l.governorate, l.city, l.status
       FROM phone_listings l JOIN users u ON u.id = l.seller_id
      WHERE ${where}
      ORDER BY (CASE WHEN l.featured_until > ? THEN 1 ELSE 0 END) DESC, l.created_at DESC
      LIMIT ? OFFSET ?`,
  ).all(...params, Date.now(), PER_PAGE, offset);

  const imgFor = db.prepare(
    'SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC LIMIT 1',
  );

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM phone_listings l JOIN users u ON u.id = l.seller_id WHERE ${where}`,
  ).get(...params).n;

  // Facets come from live inventory, so a filter can never lead to an empty
  // page — the same rule the app's shop page follows.
  const brands = db.prepare(
    `SELECT l.brand AS name, COUNT(*) AS n FROM phone_listings l JOIN users u ON u.id = l.seller_id
      WHERE ${statusClause} AND COALESCE(u.shop_hidden,0)=0
      GROUP BY l.brand ORDER BY n DESC LIMIT 14`,
  ).all();
  const govs = db.prepare(
    `SELECT l.governorate AS name, COUNT(*) AS n FROM phone_listings l JOIN users u ON u.id = l.seller_id
      WHERE ${statusClause} AND COALESCE(u.shop_hidden,0)=0
      GROUP BY l.governorate ORDER BY n DESC LIMIT 12`,
  ).all();

  // Changing a facet resets to page 1 — staying on page 4 of a filter that now
  // has two results would land the reader on an empty page.
  const qs = (over) => {
    const o = { q, brand, gov, page: 1, ...over };
    const p = new URLSearchParams();
    if (o.q) p.set('q', o.q);
    if (o.brand) p.set('brand', o.brand);
    if (o.gov) p.set('gov', o.gov);
    if (o.page && o.page > 1) p.set('page', String(o.page));
    const s = p.toString();
    return s ? `/?${s}` : '/';
  };
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));

  const cards = listings.map((l) => {
    const im = imgFor.get(l.id);
    const src = im ? PUBLIC_BASE + im.image_path : '';
    const badge = l.status === 'reserved' ? '<span class="badge res">محجوز</span>' : '';
    return `<a class="card" href="${PUBLIC_BASE}/l/${l.id}">
      <div class="thumb">${src
        ? `<img src="${esc(src)}" alt="${esc(l.brand)} ${esc(l.model)}" loading="lazy">`
        : `<span class="ph">${esc(l.brand)}</span>`}</div>
      <div class="meta">
        <div class="t">${esc(l.brand)} ${esc(l.model)}${badge}</div>
        <div class="p">${fmt(l.asking_price)} <span>د.ع</span></div>
        <div class="s">${esc(COND_AR[l.condition] || l.condition || '')}${l.storage ? ' · ' + esc(l.storage) : ''} · ${esc(govAr(l.governorate))}</div>
      </div>
    </a>`;
  }).join('');

  const chip = (label, n, href, on) =>
    `<a class="chip${on ? ' on' : ''}" href="${href}">${esc(label)}${n != null ? ` <i>${n}</i>` : ''}</a>`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iQ Mobile — سوق الموبايلات في العراق</title>
<meta name="description" content="بيع واشترِ الموبايلات في العراق. ${fmt(total)} إعلان من بائعين ومتاجر بمحافظتك.">
<link rel="canonical" href="https://iqmobile.org/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="iQ Mobile">
<meta property="og:title" content="iQ Mobile — سوق الموبايلات في العراق">
<meta property="og:description" content="بيع واشترِ الموبايلات في العراق — مجاناً، بمحافظتك.">
<meta property="og:url" content="https://iqmobile.org/">
<style>
  :root{--accent:#D9583A;--deep:#B23F25;--cream:#ECE6DA;--ink:#1B1A18;--line:#e5ddd0;--sub:#6b7280}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--cream);color:var(--ink)}
  a{text-decoration:none;color:inherit}
  .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
  header{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
  .bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0}
  .logo{display:flex;align-items:center;gap:9px;font-weight:800;font-size:17px}
  .mark{width:32px;height:32px;border-radius:9px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:800}
  .stores{display:flex;gap:8px}
  .btn{padding:9px 14px;border-radius:10px;font-weight:700;font-size:13.5px}
  .btn.play{background:var(--accent);color:#fff}
  .btn.ios{background:var(--ink);color:#fff}

  .hero{padding:34px 0 20px}
  .hero h1{font-size:30px;margin:0 0 8px;line-height:1.25}
  .hero p{margin:0;color:var(--sub);font-size:15px}
  .count{color:var(--deep);font-weight:800}

  form.search{display:flex;gap:8px;margin:18px 0 12px}
  form.search input{flex:1;font:inherit;font-size:15px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:#fff;min-width:0}
  form.search button{font:inherit;font-weight:700;padding:12px 22px;border:0;border-radius:12px;background:var(--ink);color:#fff;cursor:pointer}

  .facets{margin-bottom:6px}
  .facet-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--sub);font-weight:700;margin:10px 0 6px}
  .chips{display:flex;flex-wrap:wrap;gap:7px}
  .chip{background:#fff;border:1px solid var(--line);border-radius:999px;padding:7px 13px;font-size:13px;font-weight:600}
  .chip i{font-style:normal;font-size:11px;color:#9ca3af;font-weight:600}
  .chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .chip.on i{color:rgba(255,255,255,.6)}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;padding:18px 0 40px}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;display:block;transition:transform .12s ease,box-shadow .12s ease}
  .card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08)}
  .thumb{aspect-ratio:1/1;background:var(--cream);display:flex;align-items:center;justify-content:center;overflow:hidden}
  .thumb img{width:100%;height:100%;object-fit:contain}
  .ph{font-size:13px;color:#9ca3af;letter-spacing:.12em;text-transform:uppercase}
  .meta{padding:10px 12px 12px}
  .t{font-size:13.5px;font-weight:700;line-height:1.4;min-height:2.7em}
  .p{font-size:17px;font-weight:800;color:var(--deep);margin-top:4px}
  .p span{font-size:11px;font-weight:600}
  .s{font-size:11.5px;color:var(--sub);margin-top:3px}
  .badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;margin-inline-start:5px;color:#fff;vertical-align:middle}
  .res{background:#f59e0b}
  .none{padding:60px 0;text-align:center;color:var(--sub)}
  .pager{display:flex;align-items:center;justify-content:center;gap:14px;padding:0 0 40px}
  .pager a,.pager .off,.pager .pos{font-size:14px;font-weight:600}
  .pager a{background:#fff;border:1px solid var(--line);border-radius:10px;padding:9px 18px}
  .pager a:hover{border-color:var(--accent);color:var(--deep)}
  .pager .off{color:#c9c2b6;padding:9px 18px}
  .pager .pos{color:var(--sub);font-weight:500}

  .cta{background:#fff;border-top:1px solid var(--line);padding:26px 0;margin-top:10px}
  .cta-in{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .cta h3{margin:0 0 4px;font-size:17px}
  .cta p{margin:0;color:var(--sub);font-size:14px}
  footer{padding:20px 0 34px;color:var(--sub);font-size:13px;text-align:center}
</style>
</head>
<body>
<header>
  <div class="wrap bar">
    <a class="logo" href="/"><span class="mark">iQ</span> iQ Mobile</a>
    <div class="stores">
      <a class="btn play" href="${PLAY_URL}&referrer=web_header">Google Play</a>
      <a class="btn ios" href="${APPSTORE_URL}">App Store</a>
    </div>
  </div>
</header>

<div class="wrap">
  <section class="hero">
    <h1>سوق الموبايلات في العراق</h1>
    <p><span class="count">${fmt(total)}</span> إعلان — بيع واشترِ بمحافظتك، مجاناً.</p>

    <form class="search" method="get" action="/">
      ${brand ? `<input type="hidden" name="brand" value="${esc(brand)}">` : ''}
      ${gov ? `<input type="hidden" name="gov" value="${esc(gov)}">` : ''}
      <input name="q" value="${esc(q)}" placeholder="ابحث عن جهاز… مثلاً iPhone 15" autocomplete="off">
      <button type="submit">بحث</button>
    </form>

    <div class="facets">
      <div class="facet-label">الماركة</div>
      <div class="chips">
        ${chip('الكل', null, qs({ brand: '' }), !brand)}
        ${brands.map((b) => chip(b.name, b.n, qs({ brand: b.name }), brand === b.name)).join('')}
      </div>
      <div class="facet-label">المحافظة</div>
      <div class="chips">
        ${chip('كل العراق', null, qs({ gov: '' }), !gov)}
        ${govs.map((g) => chip(govAr(g.name), g.n, qs({ gov: g.name }), gov === g.name)).join('')}
      </div>
    </div>
  </section>

  ${listings.length
    ? `<div class="grid">${cards}</div>
       ${lastPage > 1 ? `<nav class="pager">
         ${page > 1 ? `<a href="${qs({ page: page - 1 })}">السابق</a>` : '<span class="off">السابق</span>'}
         <span class="pos">صفحة ${page} من ${lastPage}</span>
         ${page < lastPage ? `<a href="${qs({ page: page + 1 })}">التالي</a>` : '<span class="off">التالي</span>'}
       </nav>` : ''}`
    : `<div class="none">لا توجد إعلانات مطابقة. جرّب بحثاً آخر أو <a href="/" style="color:var(--deep)">اعرض الكل</a>.</div>`}
</div>

<div class="cta">
  <div class="wrap cta-in">
    <div>
      <h3>حمّل التطبيق للبيع والتواصل</h3>
      <p>النشر والمحادثة والاتصال بالبائع تتم من داخل التطبيق.</p>
    </div>
    <div class="stores">
      <a class="btn play" href="${PLAY_URL}&referrer=web_footer">Google Play</a>
      <a class="btn ios" href="${APPSTORE_URL}">App Store</a>
    </div>
  </div>
</div>

<footer class="wrap">
  <a href="/privacy">سياسة الخصوصية</a> · © ${new Date().getFullYear()} iQ Mobile
</footer>
</body></html>`;

  res.set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'public, max-age=120')
    .send(html);
});

export default r;
