// Marketing-copy generator for Facebook / Instagram posts, built entirely
// from a listing's own fields (the admin list endpoint returns SELECT l.*,
// so everything we need is already on the row — no extra fetch, no server
// round-trip). Output is Arabic, RTL-friendly, and condition-aware: a
// used phone with a healthy battery reads as "كالجديد", a sealed one as
// "جديد بالكرتون", etc. — which is exactly the "near-new / like-new"
// framing the marketing posts want.

export interface MarketingListing {
  id: number;
  brand: string;
  model: string;
  storage?: string | null;
  color?: string | null;
  condition?: string | null;
  battery_health?: number | null;
  warranty_status?: string | null;
  asking_price: number;
  governorate: string;
  city?: string | null;
  contact_phone?: string | null;
  contact_whatsapp?: string | null;
}

// English brand → Arabic label for hashtags + headline flavour. Falls back
// to the raw brand when we don't have a mapping (keeps new brands working).
const BRAND_AR: Record<string, string> = {
  Apple: 'ايفون', Samsung: 'سامسونج', Xiaomi: 'شاومي', Realme: 'ريلمي',
  Tecno: 'تكنو', Huawei: 'هواوي', OPPO: 'اوبو', Vivo: 'فيفو',
  OnePlus: 'ون بلس', Google: 'كوكل', Nokia: 'نوكيا', Motorola: 'موتورولا',
  Honor: 'هونر', Infinix: 'انفنكس', POCO: 'بوكو', Nubia: 'نوبيا',
  Oukitel: 'اوكيتل',
};

const GOV_AR: Record<string, string> = {
  Baghdad: 'بغداد', Basra: 'البصرة', Erbil: 'اربيل', Sulaymaniyah: 'السليمانية',
  Duhok: 'دهوك', Kirkuk: 'كركوك', Najaf: 'النجف', Karbala: 'كربلاء',
  Mosul: 'الموصل', Anbar: 'الأنبار', Babil: 'بابل', Diyala: 'ديالى',
  Diwaniyah: 'الديوانية', 'Dhi Qar': 'ذي قار', Maysan: 'ميسان',
  Muthanna: 'المثنى', Salahuddin: 'صلاح الدين', Wasit: 'واسط',
};

function govAr(g: string) { return GOV_AR[g] || g; }
function brandAr(b: string) { return BRAND_AR[b] || b; }
function fmtPrice(n: number) { return Number(n || 0).toLocaleString('en-US'); }

// ─── Branded share image ─────────────────────────────────────────────
// Compose a ready-to-post 1080×1080 image: the listing photo, an iQ Mobile
// frame + logo badge, a "للبيع" ribbon, and a price/condition banner. The
// listing images are same-origin (served from the same host that serves the
// dashboard — api.iqmobile.org in prod, proxied under localhost in dev), so
// the canvas isn't tainted and toDataURL/toBlob works.

const BRAND_ACCENT = '#D9583A';
const BRAND_CREAM = '#ECE6DA';
const BRAND_INK = '#1B1A18';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Same-origin, but set anonymous defensively so an accidental
    // cross-origin src still yields an exportable canvas when the server
    // sends CORS headers.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export interface ComposeResult { dataUrl: string; }

export async function composeListingImage(l: MarketingListing, imageUrl: string): Promise<ComposeResult> {
  const S = 1080;
  const BANNER = 268;           // bottom price banner height
  const photoH = S - BANNER;    // photo occupies the top

  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // background
  ctx.fillStyle = BRAND_CREAM;
  ctx.fillRect(0, 0, S, S);

  // ── photo (object-fit: cover into the top region) ──
  const img = await loadImage(imageUrl);
  const scale = Math.max(S / img.width, photoH / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  const dx = (S - dw) / 2, dy = (photoH - dh) / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, S, photoH); ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  // subtle gradient at the photo's bottom so the banner seam reads clean
  const grad = ctx.createLinearGradient(0, photoH - 120, 0, photoH);
  grad.addColorStop(0, 'rgba(27,26,24,0)');
  grad.addColorStop(1, 'rgba(27,26,24,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, photoH - 120, S, 120);

  // ── iQ logo badge (top-left) ──
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  ctx.fillStyle = BRAND_ACCENT;
  roundRect(ctx, 34, 34, 116, 116, 26); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = '700 62px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('iQ', 34 + 58, 34 + 60);

  // ── "للبيع" ribbon (top-right) ──
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
  ctx.fillStyle = BRAND_ACCENT;
  const ribbonW = 180, ribbonH = 74;
  roundRect(ctx, S - 34 - ribbonW, 40, ribbonW, ribbonH, 37); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = '700 40px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('للبيع', S - 34 - ribbonW / 2, 40 + ribbonH / 2 + 2);

  // ── bottom banner ──
  ctx.fillStyle = BRAND_ACCENT;
  ctx.fillRect(0, photoH, S, BANNER);

  const RM = 54; // right margin (RTL text anchors here)
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  (ctx as any).direction = 'rtl';

  // brand + model
  ctx.fillStyle = '#fff';
  ctx.font = '700 52px system-ui, sans-serif';
  ctx.fillText(`${l.brand} ${l.model}`.slice(0, 34), S - RM, photoH + 74);

  // condition · storage
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '400 34px system-ui, sans-serif';
  const sub = [conditionPhrase(l).replace(/^[^ ]+ /, ''), l.storage].filter(Boolean).join(' · ');
  ctx.fillText(sub.slice(0, 46), S - RM, photoH + 124);

  // price (big, cream) + governorate chip (left)
  ctx.fillStyle = BRAND_CREAM;
  ctx.font = '800 76px system-ui, sans-serif';
  ctx.fillText(`${fmtPrice(l.asking_price)} د.ع`, S - RM, photoH + 214);

  // governorate pill bottom-left
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const govText = `📍 ${govAr(l.governorate)}`;
  ctx.font = '600 32px system-ui, sans-serif';
  const pillW = ctx.measureText(govText).width + 44;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  roundRect(ctx, 40, photoH + 168, pillW, 56, 28); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(govText, 62, photoH + 168 + 30);
  ctx.restore();

  // ── outer frame ──
  ctx.strokeStyle = BRAND_ACCENT;
  ctx.lineWidth = 20;
  ctx.strokeRect(10, 10, S - 20, S - 20);

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.92) };
}

// Condition → catchy Arabic phrase. Battery health nuances the "used"
// case so a strong battery earns the "كالجديد" framing.
function conditionPhrase(l: MarketingListing): string {
  const c = (l.condition || 'used').toLowerCase();
  const bat = Number(l.battery_health);
  if (c === 'new') return '🆕 جديد بالكرتون — غير مفتوح';
  if (c === 'refurbished') return '♻️ مجدّد بحالة الوكالة';
  if (c === 'repaired') return '🔧 مصلّح ويعمل بكفاءة تامة';
  // used
  if (Number.isFinite(bat) && bat >= 90) return `✨ كالجديد — بطارية ${bat}٪`;
  if (Number.isFinite(bat) && bat >= 80) return `👍 بحالة ممتازة — بطارية ${bat}٪`;
  return '👍 مستعمل بحالة جيدة';
}

function contactLine(l: MarketingListing): string | null {
  const wa = l.contact_whatsapp;
  const ph = l.contact_phone;
  if (wa && ph && wa !== ph) return `📞 ${ph}  ·  💬 واتساب ${wa}`;
  if (wa) return `💬 واتساب: ${wa}`;
  if (ph) return `📞 للتواصل: ${ph}`;
  return null;
}

function hashtags(l: MarketingListing, extra: string[] = []): string {
  const tags = [
    `#${brandAr(l.brand)}`,
    `#${l.brand.replace(/\s+/g, '')}`,
    `#${govAr(l.governorate)}`,
    '#موبايل', '#موبايلات', '#تلفون', '#العراق', '#للبيع', '#عروض',
    ...extra,
  ];
  // de-dupe while preserving order
  return [...new Set(tags)].join(' ');
}

// Facebook: longer, more descriptive — FB rewards readable copy over a
// wall of hashtags.
export function facebookPost(l: MarketingListing): string {
  const lines: string[] = [];
  lines.push(`🔥 ${l.brand} ${l.model} للبيع`);
  lines.push('');
  lines.push(conditionPhrase(l));
  if (l.storage) lines.push(`📦 السعة: ${l.storage}`);
  if (l.color) lines.push(`🎨 اللون: ${l.color}`);
  if (l.warranty_status) lines.push(`🛡️ ${l.warranty_status}`);
  lines.push(`💰 السعر: ${fmtPrice(l.asking_price)} د.ع`);
  lines.push(`📍 ${govAr(l.governorate)}${l.city ? ` - ${l.city}` : ''}`);
  const contact = contactLine(l);
  if (contact) lines.push(contact);
  lines.push('');
  lines.push('📱 متوفّر على تطبيق iQ Mobile — سوق الموبايلات في العراق');
  lines.push('');
  lines.push(hashtags(l));
  return lines.join('\n');
}

// Instagram: shorter caption, hashtag-heavy (IG discovery is tag-driven).
export function instagramPost(l: MarketingListing): string {
  const lines: string[] = [];
  lines.push(`🔥 ${l.brand} ${l.model}`);
  lines.push(`${conditionPhrase(l)}${l.storage ? ` · ${l.storage}` : ''}`);
  lines.push(`💰 ${fmtPrice(l.asking_price)} د.ع · 📍 ${govAr(l.governorate)}`);
  const contact = contactLine(l);
  if (contact) lines.push(contact);
  lines.push('');
  lines.push('📱 iQ Mobile');
  lines.push('');
  lines.push(hashtags(l, ['#phones', '#iraq', '#mobile', '#للبيع_موبايلات']));
  return lines.join('\n');
}
