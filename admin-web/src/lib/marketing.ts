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
