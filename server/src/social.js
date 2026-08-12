// Server-side branded share image + captions, for the operator app.
//
// The dashboard composes its share image on an HTML canvas, which a React
// Native app does not have. This is that composition ported to sharp so any
// client can ask the server for the finished image. Same layout: the photo
// at its own aspect ratio (clamped to feed-safe bounds), an accent scrim,
// the iQ badge, a للبيع ribbon, brand/model/price bottom-right, governorate
// pill bottom-left, accent frame.
//
// Two rendering rules that keep Arabic correct with no system fonts:
//  - Shapes are drawn with an SVG overlay (no text in it — SVG text goes
//    through fontconfig and renders tofu on a bare droplet).
//  - Text is rendered by sharp's pango text input with an explicit
//    `fontfile` pointing at the IBM Plex Sans Arabic TTFs committed under
//    assets/fonts — the same face the app itself uses, shaped by harfbuzz,
//    no fontconfig involved.
//
// One fidelity trade against the canvas version: no emoji in the IMAGE
// (the droplet has no emoji font, and tofu boxes are worse than absence).
// The governorate pill gets a drawn dot instead of 📍. Captions keep their
// emoji — those are plain text rendered by Facebook, not by us.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_BOLD = path.join(HERE, '../assets/fonts/IBMPlexSansArabic_700Bold.ttf');
const FONT_MED = path.join(HERE, '../assets/fonts/IBMPlexSansArabic_500Medium.ttf');

const ACCENT = '#D9583A';
const CREAM = '#ECE6DA';
const INK = '#1B1A18';
const PUBLIC_SITE = 'https://api.iqmobile.org';

const BRAND_AR = {
  Apple: 'ايفون', Samsung: 'سامسونج', Xiaomi: 'شاومي', Realme: 'ريلمي',
  Tecno: 'تكنو', Huawei: 'هواوي', OPPO: 'اوبو', Vivo: 'فيفو',
  OnePlus: 'ون بلس', Google: 'كوكل', Nokia: 'نوكيا', Motorola: 'موتورولا',
  Honor: 'هونر', Infinix: 'انفنكس', POCO: 'بوكو', Nubia: 'نوبيا',
  Oukitel: 'اوكيتل',
};
const GOV_AR = {
  Baghdad: 'بغداد', Basra: 'البصرة', Erbil: 'اربيل', Sulaymaniyah: 'السليمانية',
  Duhok: 'دهوك', Kirkuk: 'كركوك', Najaf: 'النجف', Karbala: 'كربلاء',
  Mosul: 'الموصل', Anbar: 'الأنبار', Babil: 'بابل', Diyala: 'ديالى',
  Diwaniyah: 'الديوانية', 'Dhi Qar': 'ذي قار', Maysan: 'ميسان',
  Muthanna: 'المثنى', Salahuddin: 'صلاح الدين', Wasit: 'واسط',
};
const govAr = (g) => GOV_AR[g] || g || '';
const brandAr = (b) => BRAND_AR[b] || b || '';
const fmtPrice = (n) => Number(n || 0).toLocaleString('en-US');

// "Oukitel Oukitel C62" in a marketing post is worse than in a feed card —
// this is the most public text the system produces. Same rule as the app's
// deviceTitle(): drop the brand when the model already names it, and never
// print the catch-all bucket "Other" as if it were a manufacturer.
function deviceTitle(brand, model) {
  const b = String(brand || '').trim();
  const mo = String(model || '').trim();
  if (!mo) return b === 'Other' ? '' : b;
  if (!b || b === 'Other') return mo;
  if (mo.toLowerCase().startsWith(b.toLowerCase())) return mo;
  return `${b} ${mo}`;
}

function conditionPhrase(l, { emoji = true } = {}) {
  const c = String(l.condition || 'used').toLowerCase();
  const bat = Number(l.battery_health);
  const e = (s) => (emoji ? s : s.replace(/^[^؀-ۿ\w]+\s*/, ''));
  if (c === 'new') return e('🆕 جديد بالكرتون — غير مفتوح');
  if (c === 'refurbished') return e('♻️ مجدّد بحالة الوكالة');
  if (c === 'repaired') return e('🔧 مصلّح ويعمل بكفاءة تامة');
  if (Number.isFinite(bat) && bat >= 90) return e(`✨ كالجديد — بطارية ${bat}٪`);
  if (Number.isFinite(bat) && bat >= 80) return e(`👍 بحالة ممتازة — بطارية ${bat}٪`);
  return e('👍 مستعمل بحالة جيدة');
}

function hashtags(l, extra = []) {
  const tags = [
    `#${brandAr(l.brand)}`,
    `#${String(l.brand || '').replace(/\s+/g, '')}`,
    `#${govAr(l.governorate)}`,
    '#موبايل', '#موبايلات', '#تلفون', '#العراق', '#للبيع', '#عروض',
    ...extra,
  ];
  return [...new Set(tags)].join(' ');
}

/** The Facebook caption — a straight port of the dashboard's generator. */
export function facebookCaption(l) {
  const lines = [];
  lines.push(`🔥 ${deviceTitle(l.brand, l.model)} للبيع`);
  lines.push('');
  lines.push(conditionPhrase(l));
  if (l.storage) lines.push(`📦 السعة: ${l.storage}`);
  if (l.color) lines.push(`🎨 اللون: ${l.color}`);
  if (l.warranty_status) lines.push(`🛡️ ${l.warranty_status}`);
  lines.push(`💰 السعر: ${fmtPrice(l.asking_price)} د.ع`);
  lines.push(`📍 ${govAr(l.governorate)}${l.city ? ` - ${l.city}` : ''}`);
  lines.push('');
  lines.push(`🔗 التفاصيل والصور: ${PUBLIC_SITE}/l/${l.id}`);
  lines.push('📱 للتواصل مع البائع، حمّل تطبيق iQ Mobile — سوق الموبايلات في العراق');
  lines.push('');
  lines.push(hashtags(l));
  return lines.join('\n');
}

/** One positioned pango-text layer for sharp.composite(). */
async function textLayer(text, { font, size, color, rtl = false }) {
  const buf = await sharp({
    text: {
      text: `<span foreground="${color}">${text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`,
      fontfile: font,
      font: `IBM Plex Sans Arabic ${size}px`,
      rgba: true,
      dpi: 72, // with dpi=72, pango pt ≈ px, so `size` behaves like the canvas font size
    },
  }).png().toBuffer({ resolveWithObject: true });
  void rtl; // pango shapes RTL runs automatically; kept for call-site clarity
  return buf; // { data, info: { width, height } }
}

/**
 * Compose the branded share image.
 * @param l listing row (needs brand, model, storage, condition,
 *          battery_health, asking_price, governorate)
 * @param photoPath absolute path of the source photo on disk
 * @returns JPEG buffer
 */
export async function composeShareImage(l, photoPath) {
  const meta = await sharp(photoPath).metadata();
  const rawAr = (meta.width || 1) / (meta.height || 1);
  // Clamp to what FB/IG feeds show uncropped: ~3:4 … 16:9.
  const ar = Math.min(1.78, Math.max(0.75, rawAr));
  let W, H;
  if (ar >= 1) { W = 1080; H = Math.round(1080 / ar); }
  else { H = 1080; W = Math.round(1080 * ar); }
  const s = W / 1080;

  const photo = await sharp(photoPath)
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .toBuffer();

  const m = Math.round(34 * s);
  const badge = Math.round(116 * s);
  const rW = Math.round(180 * s);
  const rH = Math.round(74 * s);
  const scrimTop = Math.round(H * 0.52);

  // Shapes only — the scrim gradient, rounded rects, the frame. No text
  // here: SVG text goes through fontconfig and renders tofu on a bare
  // droplet, but shapes and gradients render fine. (Verified by pixel
  // sampling — the bottom-centre of a composed image reads ~147,53,53,
  // i.e. the accent blended over the photo at the expected opacity.)
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1B1A18" stop-opacity="0"/>
        <stop offset="0.55" stop-color="#B23F25" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#B23F25" stop-opacity="0.92"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${scrimTop}" width="${W}" height="${H - scrimTop}" fill="url(#scrim)"/>
    <rect x="${m}" y="${m}" width="${badge}" height="${badge}" rx="${Math.round(26 * s)}" fill="${ACCENT}"/>
    <rect x="${W - m - rW}" y="${m + Math.round(6 * s)}" width="${rW}" height="${rH}" rx="${Math.round(rH / 2)}" fill="${ACCENT}"/>
    <rect x="${Math.round(10 * s)}" y="${Math.round(10 * s)}"
          width="${W - Math.round(20 * s)}" height="${H - Math.round(20 * s)}"
          fill="none" stroke="${ACCENT}" stroke-width="${Math.round(20 * s)}"/>
  </svg>`;

  // Text layers, composited at canvas-equivalent positions.
  const logo = await textLayer('iQ', { font: FONT_BOLD, size: Math.round(56 * s), color: '#ffffff' });
  const ribbon = await textLayer('للبيع', { font: FONT_BOLD, size: Math.round(36 * s), color: '#ffffff', rtl: true });
  const price = await textLayer(`${fmtPrice(l.asking_price)} د.ع`, { font: FONT_BOLD, size: Math.round(64 * s), color: CREAM, rtl: true });
  const subBits = [conditionPhrase(l, { emoji: false }), l.storage].filter(Boolean).join(' · ');
  const sub = await textLayer(subBits.slice(0, 46), { font: FONT_MED, size: Math.round(30 * s), color: '#ffffff', rtl: true });
  const title = await textLayer(deviceTitle(l.brand, l.model).slice(0, 34), { font: FONT_BOLD, size: Math.round(44 * s), color: '#ffffff', rtl: true });
  const gov = await textLayer(govAr(l.governorate), { font: FONT_MED, size: Math.round(28 * s), color: '#ffffff', rtl: true });

  const RM = Math.round(44 * s);
  // The governorate pill sizes itself to its text, so it needs a second,
  // measured SVG pass.
  const pillH = Math.round(54 * s);
  const pillW = gov.info.width + Math.round(64 * s);
  const pillX = m;
  const pillY = H - Math.round(40 * s) - pillH;
  const pillSvg = `<svg width="${pillW}" height="${pillH}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" fill="rgba(0,0,0,0.32)"/>
    <circle cx="${Math.round(24 * s)}" cy="${Math.round(pillH / 2)}" r="${Math.round(7 * s)}" fill="${ACCENT}"/>
  </svg>`;

  return sharp(photo)
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      // iQ logo, centred in its badge
      {
        input: logo.data,
        left: Math.round(m + badge / 2 - logo.info.width / 2),
        top: Math.round(m + badge / 2 - logo.info.height / 2),
      },
      // للبيع ribbon text, centred in its capsule
      {
        input: ribbon.data,
        left: Math.round(W - m - rW / 2 - ribbon.info.width / 2),
        top: Math.round(m + 6 * s + rH / 2 - ribbon.info.height / 2),
      },
      // bottom-right stack: title above sub above price (right-aligned)
      { input: title.data, left: Math.max(0, W - RM - title.info.width), top: Math.round(H - 168 * s - title.info.height) },
      { input: sub.data, left: Math.max(0, W - RM - sub.info.width), top: Math.round(H - 122 * s - sub.info.height) },
      { input: price.data, left: Math.max(0, W - RM - price.info.width), top: Math.round(H - 40 * s - price.info.height) },
      // governorate pill + its text
      { input: Buffer.from(pillSvg), left: pillX, top: pillY },
      { input: gov.data, left: pillX + Math.round(42 * s), top: Math.round(pillY + pillH / 2 - gov.info.height / 2) },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}
