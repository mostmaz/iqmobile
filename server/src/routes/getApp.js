// "Get the app" smart link — the one URL to put in an Instagram/Facebook bio.
//
//   iqmobile.org/get        → iPhone lands on the App Store, Android on Play,
//                             anything else gets a landing page with both.
//   iqmobile.org/get?ref=ig → the ref rides along to Play's install referrer,
//                             so the dashboard can tell which channel drove
//                             the install. (iOS has no equivalent; Apple
//                             gives no install-referrer API.)
//
// Why User-Agent sniffing is right here: the whole job of this URL is "send
// me to MY store", and the UA is the only signal available before any JS
// runs. Social apps (Instagram, Facebook, WhatsApp) open links in their own
// in-app webview, but those still report the real OS in the UA, so detection
// holds. Anything we can't classify falls through to the page, which never
// guesses — it just shows both buttons.

import { Router } from 'express';

const r = Router();

const PLAY_URL = 'https://play.google.com/store/apps/details?id=org.iqmobile.app';
const APPSTORE_URL = 'https://apps.apple.com/app/id6776442942';

// Play accepts an arbitrary `referrer` string and hands it to the app on
// first launch (see mobile/src/lib/installReferrer.ts). Keep it short and
// alphanumeric so it survives the round trip intact.
function playUrlWithRef(ref) {
  if (!ref) return PLAY_URL;
  const clean = String(ref).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return clean ? `${PLAY_URL}&referrer=${encodeURIComponent(clean)}` : PLAY_URL;
}

export function detect(ua = '') {
  const s = ua.toLowerCase();
  // iPadOS 13+ reports as Macintosh, so check for touch support markers too.
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (/android/.test(s)) return 'android';
  return 'other';
}

// The desktop / unknown-platform fallback. Deliberately tiny and
// self-contained: no external fonts or scripts, so it renders instantly on a
// slow Iraqi mobile connection and can't be broken by a blocked CDN.
function landingPage(playHref) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>iQ Mobile — سوق الموبايلات بالعراق</title>
<meta property="og:title" content="iQ Mobile — سوق الموبايلات بالعراق">
<meta property="og:description" content="بيع واشترِ الموبايلات بمحافظتك — مجاناً.">
<meta property="og:image" content="https://api.iqmobile.org/app-icon.png">
<meta property="og:type" content="website">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#ECE6DA;color:#1B1A18;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Arabic",sans-serif;
       padding:24px}
  .card{width:100%;max-width:380px;text-align:center}
  .icon{width:104px;height:104px;border-radius:24px;box-shadow:0 8px 28px rgba(27,26,24,.18);margin-bottom:20px}
  h1{font-size:26px;margin:0 0 6px;font-weight:800;letter-spacing:-.01em}
  p{margin:0 0 26px;color:#6E6A62;font-size:15px;line-height:1.6}
  a.btn{display:flex;align-items:center;justify-content:center;gap:8px;
        padding:15px 18px;border-radius:14px;text-decoration:none;font-weight:700;font-size:15.5px;
        margin-bottom:11px}
  .play{background:#D9583A;color:#fff}
  .ios{background:#1B1A18;color:#fff}
  .foot{margin-top:22px;font-size:12.5px;color:#6E6A62}
  .foot a{color:#B23F25}
  @media(prefers-color-scheme:dark){
    body{background:#161513;color:#ECE6DA}
    p,.foot{color:#9A948A}
    .ios{background:#2E2B27}
  }
</style>
</head>
<body>
  <div class="card">
    <img class="icon" src="/app-icon.png" alt="iQ Mobile">
    <h1>iQ Mobile</h1>
    <p>سوق الموبايلات بالعراق — بيع واشترِ بمحافظتك مجاناً.</p>
    <a class="btn play" href="${playHref}">تحميل من Google Play</a>
    <a class="btn ios" href="${APPSTORE_URL}">تحميل من App Store</a>
    <div class="foot"><a href="/privacy">سياسة الخصوصية</a> · <a href="/terms">شروط الاستخدام</a></div>
  </div>
</body>
</html>`;
}

r.get('/get', (req, res) => {
  const platform = detect(req.get('user-agent'));
  const playHref = playUrlWithRef(req.query.ref);

  // 302, not 301: a permanent redirect would be cached by the browser and
  // by Instagram's link handler, so a user who first opened this on Android
  // would keep landing on Play even after switching to an iPhone.
  if (platform === 'ios') return res.redirect(302, APPSTORE_URL);
  if (platform === 'android') return res.redirect(302, playHref);

  res.type('html').send(landingPage(playHref));
});

// Explicit escape hatches — useful when you want to link one store directly
// (e.g. a Facebook ad targeted at Android only).
r.get('/get/ios', (_req, res) => res.redirect(302, APPSTORE_URL));
r.get('/get/android', (req, res) => res.redirect(302, playUrlWithRef(req.query.ref)));

export default r;
