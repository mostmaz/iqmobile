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
  const img = await loadImage(imageUrl);

  // Match the uploaded photo's aspect ratio instead of forcing a square, so
  // portraits stay portrait and landscapes stay landscape. Clamp to the
  // range Facebook/Instagram feeds display without their own cropping
  // (~3:4 portrait … 16:9 landscape); a photo inside that range fills the
  // canvas exactly (no crop), and only genuinely extreme ratios get a slight
  // cover-crop. The branding + price sit as an overlay on the photo so the
  // final image keeps the photo's shape.
  const rawAr = img.width / img.height;
  const ar = Math.min(1.78, Math.max(0.75, rawAr));
  let W: number, H: number;
  if (ar >= 1) { W = 1080; H = Math.round(1080 / ar); }
  else { H = 1080; W = Math.round(1080 * ar); }
  const s = W / 1080; // element scale keyed to canvas width

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // photo — cover-fit (fills exactly when ar == rawAr, gently crops when clamped)
  ctx.fillStyle = BRAND_INK;
  ctx.fillRect(0, 0, W, H);
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  // bottom scrim (transparent → accent) so the price text stays legible on
  // any photo without hiding the product
  const scrimTop = H * 0.52;
  const grad = ctx.createLinearGradient(0, scrimTop, 0, H);
  grad.addColorStop(0, 'rgba(27,26,24,0)');
  grad.addColorStop(0.55, 'rgba(178,63,37,0.55)');
  grad.addColorStop(1, 'rgba(178,63,37,0.92)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, scrimTop, W, H - scrimTop);

  const m = 34 * s;

  // ── iQ logo badge (top-left) ──
  const badge = 116 * s;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 18 * s; ctx.shadowOffsetY = 4 * s;
  ctx.fillStyle = BRAND_ACCENT;
  roundRect(ctx, m, m, badge, badge, 26 * s); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${62 * s}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('iQ', m + badge / 2, m + badge / 2 + 2 * s);

  // ── "للبيع" ribbon (top-right) ──
  const rW = 180 * s, rH = 74 * s;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 14 * s; ctx.shadowOffsetY = 3 * s;
  ctx.fillStyle = BRAND_ACCENT;
  roundRect(ctx, W - m - rW, m + 6 * s, rW, rH, rH / 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${40 * s}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('للبيع', W - m - rW / 2, m + 6 * s + rH / 2 + 2 * s);

  // ── overlaid price/detail block (bottom, RTL right-aligned) ──
  const RM = 44 * s;
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  (ctx as any).direction = 'rtl';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8 * s; ctx.shadowOffsetY = 2 * s;

  // price (bottom-most, biggest)
  ctx.fillStyle = BRAND_CREAM;
  ctx.font = `800 ${74 * s}px system-ui, sans-serif`;
  ctx.fillText(`${fmtPrice(l.asking_price)} د.ع`, W - RM, H - 40 * s);

  // condition · storage
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `400 ${33 * s}px system-ui, sans-serif`;
  const sub = [conditionPhrase(l).replace(/^[^ ]+ /, ''), l.storage].filter(Boolean).join(' · ');
  ctx.fillText(sub.slice(0, 46), W - RM, H - 122 * s);

  // brand · model
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${50 * s}px system-ui, sans-serif`;
  ctx.fillText(`${l.brand} ${l.model}`.slice(0, 34), W - RM, H - 168 * s);
  ctx.restore();

  // governorate pill (bottom-left)
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const govText = `📍 ${govAr(l.governorate)}`;
  ctx.font = `600 ${31 * s}px system-ui, sans-serif`;
  const pillH = 54 * s;
  const pillW = ctx.measureText(govText).width + 42 * s;
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  roundRect(ctx, m, H - 40 * s - pillH, pillW, pillH, pillH / 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(govText, m + 21 * s, H - 40 * s - pillH / 2 + 2 * s);
  ctx.restore();

  // ── outer frame ──
  ctx.strokeStyle = BRAND_ACCENT;
  ctx.lineWidth = 20 * s;
  ctx.strokeRect(10 * s, 10 * s, W - 20 * s, H - 20 * s);

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
  lines.push('');
  lines.push('📱 للتفاصيل والتواصل مع البائع، حمّل تطبيق iQ Mobile — سوق الموبايلات في العراق');
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
  lines.push('');
  lines.push('📱 للتواصل مع البائع، حمّل تطبيق iQ Mobile');
  lines.push('');
  lines.push(hashtags(l, ['#phones', '#iraq', '#mobile', '#للبيع_موبايلات']));
  return lines.join('\n');
}
