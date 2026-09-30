// One pass over the device catalogue, the suggestion queue and every live
// listing's name, in that order — because each step is only as safe as the
// one before it.
//
//   A. device_catalog — rows approved from the suggestion queue over the
//      months: duplicates of seeded devices in another spelling ("POCO X7
//      PRO" beside "X7 Pro"), devices filed under the wrong brand ("Apple /
//      Infinix gt 30 pro"), accessories, Arabic, and plain junk ("Redmi /
//      30"). Deleted or renamed. Nothing references device_catalog by id.
//   B. device_suggestions — the pending queue, decided: approved into the
//      catalogue under its real name, or rejected with a note. No push is
//      sent; the seller's listing was never blocked by this queue.
//   C. phone_listings — names rewritten to the catalogue spelling. Three
//      rules, in order: a hand-checked table for what no rule can derive
//      (a listing called "2026" whose text says Tecno Spark 40 Pro), the
//      leading-brand strip the daily job already does, then the catalogue
//      resolver with its family and demotion guards. Accessories and
//      size-variant names ("Galaxy Watch8 (44mm)") keep their words.
//
// Dry run by default and prints the whole plan. --apply writes, inside one
// transaction, after saving a JSON backup of every row it changes. The
// listing watermark the daily job reads is moved to the end, since this
// pass has read everything.
//
//   node scripts/cleanDeviceNames.js            # plan only
//   node scripts/cleanDeviceNames.js --apply    # write
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db.js';
import {
  resolveListingName, stripLeadingBrand, resetCatalogCache, primeCatalog,
} from '../src/listingNameNormalize.js';

const APPLY = process.argv.includes('--apply');
const now = Date.now();
const ARABIC = /[؀-ۿ]/;
const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+.]/g, '');
const k2 = (brand, model) => `${brand}|${String(model).trim().toLowerCase()}`;
const AVAILABLE = new Set(db.prepare('SELECT name FROM brands').all().map((r) => r.name));

// ─── A. catalogue decisions ────────────────────────────────────────────
// Keyed "Brand|model" exactly as stored. Rows not named here fall to the
// generic rules below (wrong brand, duplicate of a seeded row, Arabic).

/** Rows that are not a device, or not one anyone can name. */
const CATALOG_DELETE = new Set([
  'Apple|17 Pro Max', 'Apple|Apple pencil', 'Apple|ipad', 'Apple|ipad 9', 'Apple|iPad 10',
  'Honor|HONOR Pad 10 Papermatte', 'Honor|X9C HONOR',
  'Huawei|Mate Pad 11. 5',
  'Infinix|Note 15 pro', 'Infinix|Note 50pro +5g', 'Infinix|Zero 40  5G',
  'Itel|L231',
  'Other|Anker Soundcore Sport X20', 'Other|Realme 13 Pro+ 512GB 12GB RAM',
  'Other|Realme 13 Pro+ 5G', 'Other|Sony experia Mark ii', 'Other|Xperia',
  'Realme|A3', 'Realme|GT 20 pro', 'Realme|Realme 50', 'Realme|Realme GT Master Edition',
  'Redmi|30', 'Redmi|C53',
  'Samsung|Samsung Tab A', 'Samsung|S26 Ultra', 'Samsung|Galaxy Tab A7',
  'Tecno|Tecno Spark 4C', 'Tecno|Tecno 30 Pro 5G',
  'Xiaomi|A10', 'Xiaomi|Mi pad', 'Xiaomi|Redmi c13', 'Xiaomi|Redmi Note 14',
  'Xiaomi|Redmi Note14',
]);

/** Rows that name a real device in the wrong spelling, brand or type.
 *  Applies to seeded rows too — GSMArena writes "X9b", the seed had "X9B". */
const CATALOG_RENAME = {
  'Honor|X9B': { brand: 'Honor', model: 'X9b', device_type: 'phone' },
  'Honor|X9C': { brand: 'Honor', model: 'X9c', device_type: 'phone' },
  'Huawei|ساعة هواوي gt runner': { brand: 'Huawei', model: 'Watch GT Runner', device_type: 'watch' },
  'Infinix|Infinix NOTE 30': { brand: 'Infinix', model: 'Note 30', device_type: 'phone' },
  'Infinix|Infinix XPAD edge': { brand: 'Infinix', model: 'Xpad Edge', device_type: 'tablet' },
  'Motorola|Moto edge 30 pro': { brand: 'Motorola', model: 'Edge 30 Pro', device_type: 'phone' },
  'Other|LG v50': { brand: 'Other', model: 'LG V50 ThinQ 5G', device_type: 'phone' },
  'Other|LG velvet': { brand: 'Other', model: 'LG Velvet', device_type: 'phone' },
  'Other|Nothing 2': { brand: 'Other', model: 'Nothing Phone (2)', device_type: 'phone' },
  'Other|Nothing 3a': { brand: 'Other', model: 'Nothing Phone (3a)', device_type: 'phone' },
  'Other|TCL 10 plos': { brand: 'Other', model: 'TCL 10 Plus', device_type: 'phone' },
  'Other|سوني اكس بيريه 1 مارك 4': { brand: 'Other', model: 'Sony Xperia 1 IV', device_type: 'phone' },
  'Realme|Realme C53': { brand: 'Realme', model: 'C53', device_type: 'phone' },
  'Realme|Realme Q3 pro سبيشل': { brand: 'Realme', model: 'Q3 Pro', device_type: 'phone' },
  'Realme|Realme x2 pro': { brand: 'Realme', model: 'X2 Pro', device_type: 'phone' },
  'Redmi|Redmi 17': { brand: 'Redmi', model: '17', device_type: 'phone' },
};

/** Devices the seed never had that live listings name. Added as 'manual'. */
const CATALOG_INSERT = [
  ['Apple', 'iPhone 5s', 'phone'],
  ['Infinix', 'Xpad 30E', 'tablet'],
  ['Lenovo', 'Tab P11', 'tablet'],
  ['Other', 'Asus ROG Phone 5', 'phone'],
  ['Other', 'LG V60 ThinQ 5G', 'phone'],
  ['Other', 'LG G6', 'phone'],
  ['Other', 'Meizu Note 21', 'phone'],
  ['Other', 'Sony Xperia 1 V', 'phone'],
  ['Other', 'Sony Xperia 1 VI', 'phone'],
  ['Other', 'ZTE Blade V80 Max', 'phone'],
  ['Other', 'ZTE Blade A36', 'phone'],
  ['Other', 'KXD A07 Pro', 'phone'],
  ['Other', 'Razer Edge 5G', 'phone'],
  ['Oukitel', 'C21 Pro', 'phone'],
];

// ─── B. suggestion decisions ───────────────────────────────────────────
// id → approve {brand, model, type} | reject note. Approving a device the
// catalogue already holds just records where it landed.
const SUGGEST = {
  344: { reject: 'ما فيه اسم جهاز' },
  343: { brand: 'Other', model: 'LG V60 ThinQ 5G', type: 'phone' },
  342: { brand: 'POCO', model: 'X6 Pro', type: 'phone' },
  341: { brand: 'Honor', model: 'X9d', type: 'phone' },
  340: { brand: 'Other', model: 'Asus ROG Phone 5', type: 'phone' },
  339: { brand: 'POCO', model: 'X7 Pro', type: 'phone' },
  338: { reject: 'اسم ماركة بس' },
  337: { reject: 'ماركة غير معروفة' },
  336: { brand: 'Samsung', model: 'Galaxy Tab S8 Ultra', type: 'tablet' },
  335: { brand: 'POCO', model: 'X7 Pro', type: 'phone' },
  334: { reject: 'اسم ماركة بس' },
  333: { brand: 'POCO', model: 'X7 Pro', type: 'phone' },
  332: { brand: 'Apple', model: 'Watch Series 9', type: 'watch' },
  331: { reject: 'ما فيه رقم الجيل' },
  330: { brand: 'Lenovo', model: 'Tab P11', type: 'tablet' },
  329: { reject: 'ما فيه اسم جهاز' },
  328: { reject: 'موجود: iPad Pro 11 حسب السنة' },
  327: { reject: 'ما فيه اسم جهاز' },
  326: { brand: 'Redmi', model: '10', type: 'phone' },
  325: { brand: 'POCO', model: 'X6', type: 'phone' },
  324: { reject: 'ما فيه اسم جهاز' },
  323: { brand: 'Apple', model: 'iPhone 5s', type: 'phone' },
  322: { reject: 'ما فيه اسم جهاز' },
  321: { reject: 'ما فيه رقم الجيل' },
  320: { reject: 'موجود: iPad Pro 11 حسب السنة' },
  319: { brand: 'Honor', model: 'X6b', type: 'phone' },
  318: { reject: 'اسم غير واضح' },
  317: { reject: 'جهاز غير معروف' },
  316: { reject: 'Redmi ما عندها C65 — الموجود POCO C65' },
  315: { reject: 'ما فيه اسم جهاز' },
  314: { reject: 'اسم ماركة بس' },
  313: { brand: 'POCO', model: 'F6', type: 'phone' },
  312: { reject: 'جهاز غير معروف' },
  311: { brand: 'Realme', model: 'C11', type: 'phone' },
  310: { reject: 'ما فيه اسم جهاز' },
  290: { brand: 'Xiaomi', model: 'Pad 7 Pro', type: 'tablet' },
  289: { reject: 'ما فيه رقم الجيل' },
  288: { brand: 'POCO', model: 'X6 Pro', type: 'phone' },
  287: { brand: 'POCO', model: 'X5 Pro', type: 'phone' },
  286: { reject: 'اسم ماركة بس' },
  285: { brand: 'POCO', model: 'F6', type: 'phone' },
};

// ─── C. listing renames no rule can derive ─────────────────────────────
// Keyed "Brand|model" with the model lower-cased. Each one was read against
// the listing's own text or photos; a wrong guess here is a wrong device on
// a real ad, so an entry is only present when the text left no doubt.
const MANUAL = {
  // iPads: Apple sells generations, the catalogue (GSMArena) model years.
  // Chip → year mappings match tools/gsmarena/aliases.json.
  'Apple|ipad 11': 'iPad (2025)',
  'Apple|ipad 11 (a16)': 'iPad (2025)',
  'Apple|ipad 11 a16': 'iPad (2025)',
  'Apple|ipad 11 pro': 'iPad Pro 11',
  'Apple|ipad air  4': 'iPad Air (2020)',
  'Apple|ipad air 5th': 'iPad Air (2022)',
  'Apple|ipad air 11 m4': 'iPad Air 11 (2026)',
  'Apple|ipad air 11-inch m4': 'iPad Air 11 (2026)',
  'Apple|ipad air m4 11': 'iPad Air 11 (2026)',
  'Apple|ipad air 2026 wifi m4': 'iPad Air 11 (2026)',
  'Apple|ipad air 13-inch m4': 'iPad Air 13 (2026)',
  'Apple|ipad air m4 13': 'iPad Air 13 (2026)',
  'Apple|ipad m5 11': 'iPad Pro 11 (2025)',
  'Apple|ipad pro 11 m5': 'iPad Pro 11 (2025)',
  'Apple|ipad pro 11-inch m5': 'iPad Pro 11 (2025)',
  'Apple|ipad pro 13 m5': 'iPad Pro 13 (2025)',
  'Apple|ipad pro 13-inch m5': 'iPad Pro 13 (2025)',
  'Apple|ipad pro 13-inch m4': 'iPad Pro 13 (2024)',
  'Apple|ipad mini 5': 'iPad mini (2019)',
  'Apple|ipad mini 7': 'iPad mini (2024)',
  'Apple|ipad 10': 'iPad (2022)',
  'Apple|ipad 9': 'iPad 10.2 (2021)',
  'Apple|iphon 12': 'iPhone 12',
  'Apple|x': 'iPhone X',
  'Apple|watch 10 46mm': 'Watch Series 10',
  'Apple|watch 11': 'Watch Series 11',
  'Apple|watch ultra 1': 'Watch Ultra',
  'Apple|ايفون اس اي الجيل ال3': 'iPhone SE (2022)',
  // Wrong brand, right words in the text.
  'Apple|2026': ['Tecno', 'Spark 40 Pro'],
  'Apple|honorx9b': ['Honor', 'X9b'],
  'Apple|tab 60 pro': ['Blackview', 'Tab 60 Pro'],
  'Apple|teclast': ['Other', 'Teclast'],
  'Apple|nothing 3a': ['Other', 'Microsoft Surface RT'],
  'Apple|كاميرا  نيكون': ['Other', 'كاميرا نيكون'],
  'Apple|اس ٢٦ الترا': ['Samsung', 'Galaxy S26 Ultra'],
  'Apple|انفنكس': ['Infinix', 'Hot 12'],
  'Blackview|asus rog': ['Other', 'Asus ROG Phone 5'],
  'Blackview|tab 60 wi-fi': 'Tab 60 WiFi',
  'Google|lg v60': ['Other', 'LG V60 ThinQ 5G'],
  'Google|xperia': ['Other', 'Nextbook Flexx 11A'],
  'Huawei|gt runner': 'Watch GT Runner',
  'Huawei|pure 80 ultra': 'Pura 80 Ultra',
  'Huawei|huawei pure 80 ultra': 'Pura 80 Ultra',
  'Huawei|huawei pure 80': 'Pura 80',
  'Huawei|x9d': ['Honor', 'X9d'],
  'Infinix|x pad 30e': 'Xpad 30E',
  'Infinix|xpad 30e': 'Xpad 30E',
  'Infinix|xpad30e': 'Xpad 30E',
  'Infinix|infinix x pad 30e': 'Xpad 30E',
  'Infinix|note 50 5g pro plus': 'Note 50 Pro+',
  'Itel|a07 pro': ['Other', 'KXD A07 Pro'],
  'Lenovo|tablet lenovo p11': 'Tab P11',
  'Nubia|v80 max': ['Other', 'ZTE Blade V80 Max'],
  'OPPO|boko': ['POCO', 'F7'],
  'OPPO|reeno 13 5g': 'Reno13',
  'OPPO|reno 8t 5g pro': 'Reno8 T 5G',
  'Other|11s pro': ['Nubia', 'RedMagic 11S Pro'],
  'Other|redmagic 11s pro': ['Nubia', 'RedMagic 11S Pro'],
  'Other|14pro مراوس s26ultra': ['Apple', 'iPhone 14 Pro'],
  'Other|hot 60 pro': ['Infinix', 'Hot 60 Pro'],
  'Other|hot 60 pro plus': ['Infinix', 'Hot 60 Pro+'],
  'Other|hot 60i': ['Infinix', 'Hot 60i'],
  'Other|kxd': 'KXD A07 Pro',
  'Other|legion y700': ['Lenovo', 'Legion Y700'],
  'Other|lg g6 ذاكره 32': 'LG G6',
  'Other|note 21': 'Meizu Note 21',
  'Other|note 50 pro': ['Infinix', 'Note 50 Pro 4G'],
  'Other|note 50 pro+ 5g': ['Infinix', 'Note 50 Pro+'],
  'Other|note 60 pro 5g': ['Infinix', 'Note 60 Pro'],
  'Other|note edge 5g': ['Infinix', 'Note Edge'],
  'Other|pova slim 5g': ['Tecno', 'Pova Slim'],
  'Other|reno a6 pro 5g': ['OPPO', 'A6 Pro'],
  'Other|reno14f 5g': ['OPPO', 'Reno14 F'],
  'Other|smart 10 plus': ['Infinix', 'Smart 10 Plus'],
  'Other|smart 20': ['Infinix', 'Smart 20'],
  'Other|tab 60 wifi': ['Blackview', 'Tab 60 WiFi'],
  'Other|nothing 2': 'Nothing Phone (2)',
  'Other|nothing 3a': 'Nothing Phone (3a)',
  'Other|tcl 10 plos': 'TCL 10 Plus',
  'Other|zte v80 max': 'ZTE Blade V80 Max',
  'Other|black shark tablet': ['Xiaomi', 'Black Shark Gaming Tablet'],
  'Other|ريد ماجك 9  برو                redmagic 9 pro': ['Nubia', 'RedMagic 9 Pro'],
  'Other|ريد ماجيك 10s برو': ['Nubia', 'RedMagic 10S Pro'],
  'Other|ريد ماجيك 11 برو': ['Nubia', 'RedMagic 11 Pro'],
  'Other|سوني 1مارك5': 'Sony Xperia 1 V',
  'Other|سوني اكس بيريه 1 مارك 6': 'Sony Xperia 1 VI',
  'Other|موبايل اوكيتيل c21 pro جديد غير مستخدم': ['Oukitel', 'C21 Pro'],
  'POCO|a38': ['OPPO', 'A38'],
  'Realme|13+5g': '13+',
  'Redmi|not': 'Note 15 Pro',
  'Redmi|razer edge 5g': ['Other', 'Razer Edge 5G'],
  'Samsung|21sa': 'Galaxy A21s',
  'Samsung|galaxy 06': 'Galaxy A06',
  'Samsung|galaxy tab a8': 'Galaxy Tab A8 10.5 (2021)',
  'Samsung|galaxy tab a7': 'Galaxy Tab A7 10.4 (2020)',
  'Samsung|asus vivobook s16 flip': ['Other', 'ASUS Vivobook S16 Flip'],
  'Tecno|30 pro 5g': 'Camon 30 Pro',
  'Tecno|bofa slim 5g': 'Pova Slim',
  'Tecno|pova 7 slim': 'Pova Slim',
  'Tecno|camon 40 pro5g': 'Camon 40 Pro',
  'Xiaomi|c85': ['POCO', 'C85'],
  'Xiaomi|f7 ultra': ['POCO', 'F7 Ultra'],
  'Xiaomi|f8 ultra': ['POCO', 'F8 Ultra'],
  'Xiaomi|mi 17': '17',
  'Xiaomi|mi 17 ultra': '17 Ultra',
  'Xiaomi|mix flio': 'Mix Flip',
  'Xiaomi|note 15': ['Redmi', 'Note 15'],
  'Xiaomi|note 15 pro 5g': ['Redmi', 'Note 15 Pro'],
  'Xiaomi|note 15 pro+ 5g': ['Redmi', 'Note 15 Pro+'],
  'Xiaomi|pad 2 4g': ['Redmi', 'Pad 2'],
  'Xiaomi|pad 2 9.7': ['Redmi', 'Pad 2 9.7'],
  'Xiaomi|pad 2 pro (inbox keyboard )': ['Redmi', 'Pad 2 Pro'],
  'Xiaomi|pad 2 wifi': ['Redmi', 'Pad 2'],
  'Xiaomi|pad 6spro': 'Pad 6S Pro 12.4',
  'Xiaomi|pad m1': ['POCO', 'Pad M1'],
  'Xiaomi|plak shark 5 pro': 'Black Shark 5 Pro',
  'Xiaomi|pocof6': ['POCO', 'F6'],
  'Xiaomi|redmi': ['Redmi', 'A7 Pro'],
  'Xiaomi|x8 pro max': ['POCO', 'X8 Pro Max'],
};

// Things that are not phones/tablets/watches keep their seller's words.
const ACCESSORY = /(pencil|earbud|freebud|freeclip|freelace|freearc|buds|airpod|earpod|headphone|سماعة|keyboard|كيبورد|case|cover|غطاء|charger|شاحن|cable|كيبل|power ?bank|hair dryer|cleaner|photography kit|kit pro|smart ?pen|focus pen|stylus|قلم|adapter|محول|stand|حامل|band \d|m-pencil|macbook|laptop|vivobook|katana|loq |surface|e-reader|boox|اکسسوارات|كاميرا|tips)/i;
// A size in the name is a variant the seller meant to keep.
const SIZE = /\b\d{2}\s?mm\b/i;

// ─── helpers ───────────────────────────────────────────────────────────
const plan = {
  catalogDelete: [], catalogRename: [], catalogInsert: [],
  suggestApprove: [], suggestReject: [],
  listing: { manual: [], brand: [], catalog: [] },
  unresolved: [],
};
const catalogRow = db.prepare(
  'SELECT id, brand, device_type, model, source, is_active FROM device_catalog WHERE brand=? AND model=? COLLATE NOCASE',
);
const catalogExists = (brand, model) => !!catalogRow.get(brand, model);

// Seeded rows, indexed by every spelling the resolver would accept, so a
// suggestion row that is the same device in another spelling is found.
const seeded = new Map();
for (const r of db.prepare("SELECT brand, model FROM device_catalog WHERE source='gsmarena'").all()) {
  const set = seeded.get(r.brand) || new Set();
  seeded.set(r.brand, set);
  const k = keyOf(r.model);
  set.add(k);
  set.add(k.replace(/\+/g, 'plus'));
  set.add(k.replace(/\./g, ''));
  const sh = /^(.+?)(5g|4g)$/.exec(k);
  if (sh) set.add(sh[1]);
}
function seededHas(brand, model) {
  const set = seeded.get(brand);
  if (!set) return false;
  const k = keyOf(model);
  const variants = [k, k.replace(/\+/g, 'plus'), k.replace(/plus/g, '+'), k.replace(/\./g, '')];
  const sh = /^(.+?)(5g|4g)$/.exec(k);
  if (sh) variants.push(sh[1]);
  // "Galaxy A21s" is seeded; "Samsung Galaxy A21s" strips to it.
  const parts = String(model).trim().split(/\s+/);
  if (parts.length > 1) variants.push(keyOf(parts.slice(1).join(' ')));
  return variants.some((v) => v && set.has(v));
}

// ─── A. catalogue ──────────────────────────────────────────────────────
const decidedCatalog = new Set();
for (const [key, to] of Object.entries(CATALOG_RENAME)) {
  const [brand, model] = key.split('|');
  const row = db.prepare('SELECT * FROM device_catalog WHERE brand=? AND model=?').get(brand, model);
  if (!row) continue;
  decidedCatalog.add(row.id);
  // Renaming onto a row that already exists is a delete — unless that row
  // is this one under a different case ("X9B" → "X9b").
  const other = catalogRow.get(to.brand, to.model);
  if (other && other.id !== row.id) plan.catalogDelete.push({ ...row, why: 'exists as ' + to.model });
  else plan.catalogRename.push({ ...row, to });
}
for (const row of db.prepare("SELECT * FROM device_catalog WHERE source <> 'gsmarena' ORDER BY brand, model").all()) {
  if (decidedCatalog.has(row.id)) continue;
  const key = `${row.brand}|${row.model}`;
  if (CATALOG_DELETE.has(key)) { plan.catalogDelete.push({ ...row, why: 'listed' }); continue; }
  if (ARABIC.test(row.model)) { plan.catalogDelete.push({ ...row, why: 'arabic' }); continue; }
  const s = stripLeadingBrand(row.model, AVAILABLE);
  if (s.brand && s.brand !== row.brand) { plan.catalogDelete.push({ ...row, why: `belongs to ${s.brand}` }); continue; }
  const bare = s.brand ? s.model : row.model;
  if (seededHas(row.brand, bare)) { plan.catalogDelete.push({ ...row, why: 'duplicate of seeded row' }); continue; }
  if (s.brand && bare !== row.model) {
    if (catalogExists(row.brand, bare)) plan.catalogDelete.push({ ...row, why: 'exists as ' + bare });
    else plan.catalogRename.push({ ...row, to: { brand: row.brand, model: bare, device_type: row.device_type } });
    continue;
  }
  // Unlisted and not caught by a rule: kept, and reported.
  plan.catalogKept = plan.catalogKept || [];
  plan.catalogKept.push(row);
}
for (const [brand, model, type] of CATALOG_INSERT) {
  if (!catalogExists(brand, model)) plan.catalogInsert.push({ brand, model, device_type: type });
}

// ─── A2. devices the seed predates ─────────────────────────────────────
// The catalogue was seeded from a GSMArena snapshot; phones announced since
// ("Pova 8 Pro", "Play20A") are missing, so listings of them can never
// resolve. tools/gsmarena/gsm_index.json is the refreshed index. A device
// from it is added only when a live listing names it — the whole index
// would bury the picker under a decade of Samsungs.
const INDEX_BRAND = {
  apple: 'Apple', samsung: 'Samsung', honor: 'Honor', huawei: 'Huawei', infinix: 'Infinix',
  tecno: 'Tecno', realme: 'Realme', oppo: 'OPPO', vivo: 'Vivo', google: 'Google',
  motorola: 'Motorola', oneplus: 'OnePlus', itel: 'Itel', oukitel: 'Oukitel',
  blackview: 'Blackview', nokia: 'Nokia', lenovo: 'Lenovo',
};
const typeOf = (m) => (/pad|\btab\b|tablet/i.test(m) ? 'tablet' : /watch|\bband\b|\bfit\b/i.test(m) ? 'watch' : 'phone');
const gsmIndex = new Map(); // "Brand|key" → model
{
  const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../tools/gsmarena/gsm_index.json');
  const idx = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const put = (brand, model) => {
    const k = keyOf(model);
    for (const v of new Set([k, k.replace(/\+/g, 'plus'), k.replace(/\./g, ''), (/^(.+?)(5g|4g)$/.exec(k) || [])[1]])) {
      if (v && !gsmIndex.has(`${brand}|${v}`)) gsmIndex.set(`${brand}|${v}`, model);
    }
  };
  for (const [gb, devices] of Object.entries(idx)) {
    for (const name of Object.keys(devices)) {
      let brand = INDEX_BRAND[gb];
      let model = name;
      if (gb === 'xiaomi') {
        const m = /^(Poco|Redmi)\s+(.+)$/i.exec(name);
        if (m) { brand = m[1].toLowerCase() === 'poco' ? 'POCO' : 'Redmi'; model = m[2]; } else brand = 'Xiaomi';
      } else if (gb === 'zte') {
        const m = /^nubia\s+(.+)$/i.exec(name);
        if (!m) continue;
        brand = 'Nubia'; model = m[1];
      }
      if (!brand) continue;
      put(brand, model);
      // Sellers drop the line word ("Moto G15" → "G15", "Galaxy A07" → "A07").
      const parts = model.split(/\s+/);
      if (parts.length > 1 && /^(galaxy|iphone|ipad|moto|pixel)$/i.test(parts[0])) put(brand, parts.slice(1).join(' '));
    }
  }
}
const inIndex = (brand, model) => gsmIndex.get(`${brand}|${keyOf(model)}`) || null;

// ─── B. suggestions ────────────────────────────────────────────────────
for (const s of db.prepare("SELECT * FROM device_suggestions WHERE status='pending' ORDER BY id DESC").all()) {
  const d = SUGGEST[s.id];
  if (!d) { plan.suggestUndecided = plan.suggestUndecided || []; plan.suggestUndecided.push(s); continue; }
  if (d.reject) plan.suggestReject.push({ ...s, note: d.reject });
  else plan.suggestApprove.push({ ...s, to: d, insert: !catalogExists(d.brand, d.model) });
}

// ─── C. listings ───────────────────────────────────────────────────────
// What the catalogue will look like after A and B, so C resolves against
// the cleaned version even in a dry run. Built by id, not name: a junk row
// can share its exact name with a seeded one ("Pad X8b" as a phone beside
// the seeded tablet), and dropping by name would take both.
const deletedIds = new Set(plan.catalogDelete.map((d) => d.id));
const renamedById = new Map(plan.catalogRename.map((r) => [r.id, r.to]));
const afterRows = [];
for (const r of db.prepare('SELECT id, brand, model, device_type FROM device_catalog WHERE is_active=1').all()) {
  if (deletedIds.has(r.id)) continue;
  const to = renamedById.get(r.id);
  afterRows.push(to ? { brand: to.brand, model: to.model, device_type: to.device_type } : r);
}
for (const i of plan.catalogInsert) afterRows.push({ brand: i.brand, model: i.model, device_type: i.device_type });
for (const a of plan.suggestApprove) if (a.insert) afterRows.push({ brand: a.to.brand, model: a.to.model, device_type: a.to.type });
const afterCatalog = new Map(afterRows.map((r) => [`${r.brand}|${r.model}`, r.device_type]));
const inAfter = (brand, model) => afterCatalog.has(`${brand}|${model}`);
const inAfterCI = (brand, model) => {
  const want = String(model).toLowerCase();
  for (const k of afterCatalog.keys()) if (k.startsWith(brand + '|') && k.slice(brand.length + 1).toLowerCase() === want) return true;
  return false;
};
primeCatalog(afterRows);

function decide(l) {
  const raw = String(l.model || '').trim();
  const m = MANUAL[k2(l.brand, raw)];
  if (m) {
    const [brand, model] = Array.isArray(m) ? m : [l.brand, m];
    return { brand, model, rule: 'manual' };
  }
  const s = stripLeadingBrand(raw, AVAILABLE);
  let brand = s.brand || l.brand;
  let model = s.model;
  let rule = model !== raw || brand !== l.brand ? 'brand' : null;

  const skip = l.product_type === 'accessory' || ACCESSORY.test(model) || SIZE.test(model);
  if (!skip && !inAfter(brand, model)) {
    const r = resolveListingName(brand, model);
    if (r.model && inAfter(r.brand, r.model) && (r.model !== model || r.brand !== brand)) {
      brand = r.brand; model = r.model; rule = 'catalog';
    }
  }
  return rule ? { brand, model, rule } : null;
}

const listings = db.prepare(
  `SELECT id, seller_id, brand, model, product_type, status FROM phone_listings
    WHERE status IN ('active','reserved') ORDER BY id`,
).all();

// A2 continued: which index devices do live listings name that the
// catalogue lacks? Added before the listing pass so that pass finds them.
plan.catalogTopup = [];
{
  const seen = new Set();
  for (const l of listings) {
    const raw = String(l.model || '').trim();
    if (MANUAL[k2(l.brand, raw)] || l.product_type === 'accessory' || ACCESSORY.test(raw) || SIZE.test(raw)) continue;
    const st = stripLeadingBrand(raw, AVAILABLE);
    const brand = st.brand || l.brand;
    const model = st.model;
    if (inAfter(brand, model) || resolveListingName(brand, model).model) continue;
    const hit = inIndex(brand, model);
    if (!hit || inAfterCI(brand, hit) || seen.has(`${brand}|${hit}`)) continue;
    // "Y6" when the catalogue holds "Y6 (2018)" and "Y6 (2019)": the bare
    // name is GSMArena's 2015 model, not what the seller has.
    if ([...afterCatalog.keys()].some((k) => k.startsWith(`${brand}|${hit} (`))) continue;
    seen.add(`${brand}|${hit}`);
    plan.catalogTopup.push({ brand, model: hit, device_type: typeOf(hit), because: `${l.brand} / ${raw}` });
  }
  for (const t of plan.catalogTopup) {
    afterRows.push({ brand: t.brand, model: t.model, device_type: t.device_type });
    afterCatalog.set(`${t.brand}|${t.model}`, t.device_type);
  }
  primeCatalog(afterRows);
}

function planListings() {
  plan.listing = { manual: [], brand: [], catalog: [] };
  plan.unresolved = [];
  for (const l of listings) {
    const d = decide(l);
    if (d) {
      plan.listing[d.rule].push({ ...l, to_brand: d.brand, to_model: d.model });
      if (!inAfter(d.brand, d.model)) plan.unresolved.push({ ...l, after: `${d.brand} / ${d.model}` });
    } else if (!inAfter(l.brand, String(l.model || '').trim())) {
      plan.unresolved.push(l);
    }
  }
}
planListings();

// ─── report ────────────────────────────────────────────────────────────
const show = (label, list, fmt, n = 400) => {
  console.log(`\n${label} (${list.length})`);
  for (const x of list.slice(0, n)) console.log('  ' + fmt(x));
  if (list.length > n) console.log(`  … ${list.length - n} more`);
};
show('A. catalogue DELETE', plan.catalogDelete, (r) => `${String(r.id).padStart(5)}  ${r.brand} / ${r.model}`.padEnd(60) + `— ${r.why}`);
show('A. catalogue RENAME', plan.catalogRename, (r) => `${String(r.id).padStart(5)}  ${r.brand} / ${r.model}`.padEnd(60) + `→ ${r.to.brand} / ${r.to.model} (${r.to.device_type})`);
show('A. catalogue INSERT', plan.catalogInsert, (r) => `${r.brand} / ${r.model} (${r.device_type})`);
show('A2. catalogue TOP-UP from GSMArena index', plan.catalogTopup, (r) => `${r.brand} / ${r.model} (${r.device_type})`.padEnd(50) + `← ${r.because}`);
if (plan.catalogKept) show('A. catalogue kept, unreviewed', plan.catalogKept, (r) => `${String(r.id).padStart(5)}  ${r.brand} / ${r.model} (${r.device_type})`);
show('B. suggestions APPROVE', plan.suggestApprove, (s) => `${String(s.id).padStart(4)}  ${s.brand} / ${s.model}`.padEnd(50) + `→ ${s.to.brand} / ${s.to.model}${s.insert ? '  (new row)' : ''}`);
show('B. suggestions REJECT', plan.suggestReject, (s) => `${String(s.id).padStart(4)}  ${s.brand} / ${s.model}`.padEnd(50) + `— ${s.note}`);
if (plan.suggestUndecided) show('B. suggestions UNDECIDED (left pending)', plan.suggestUndecided, (s) => `${s.id}  ${s.brand} / ${s.model}`);
const fmtL = (l) => `${String(l.id).padStart(5)}  ${l.brand} / ${l.model}`.padEnd(62) + `→ ${l.to_brand} / ${l.to_model}`;
show('C. listings — hand table', plan.listing.manual, fmtL);
show('C. listings — brand out of the name', plan.listing.brand, fmtL);
show('C. listings — catalogue spelling', plan.listing.catalog, fmtL);
show('C. still not a catalogue device after this', plan.unresolved, (l) => `${String(l.id).padStart(5)}  ${l.brand} / ${l.model}${l.after ? '  (→ ' + l.after + ')' : ''}`, 600);

const writes = [...plan.listing.manual, ...plan.listing.brand, ...plan.listing.catalog];
console.log(`\ncatalogue: -${plan.catalogDelete.length} ~${plan.catalogRename.length} +${plan.catalogInsert.length + plan.catalogTopup.length}`
  + ` · suggestions: ✓${plan.suggestApprove.length} ✗${plan.suggestReject.length}`
  + ` · listings: ${writes.length} renames of ${listings.length}, ${plan.unresolved.length} still free-text`);

if (!APPLY) { console.log('\ndry run — nothing written. Re-run with --apply.'); process.exit(0); }

// ─── apply ─────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(process.cwd(), 'data', `backup-devicefix-${stamp}.json`);
fs.writeFileSync(backup, JSON.stringify({
  catalogDelete: plan.catalogDelete, catalogRename: plan.catalogRename,
  catalogInsert: plan.catalogInsert, catalogTopup: plan.catalogTopup,
  suggestApprove: plan.suggestApprove, suggestReject: plan.suggestReject,
  listings: writes,
}, null, 1));

const delCat = db.prepare('DELETE FROM device_catalog WHERE id=?');
const renCat = db.prepare('UPDATE device_catalog SET brand=?, model=?, device_type=? WHERE id=?');
const insCat = db.prepare(`INSERT OR IGNORE INTO device_catalog(brand, device_type, model, source, created_at) VALUES(?,?,?,?,?)`);
const approve = db.prepare('UPDATE device_suggestions SET status=?, reviewed_at=?, brand=?, model=?, device_type=? WHERE id=?');
const reject = db.prepare('UPDATE device_suggestions SET status=?, reviewed_at=?, note=? WHERE id=?');
const updL = db.prepare('UPDATE phone_listings SET brand=?, model=?, updated_at=? WHERE id=?');
const setType = db.prepare("UPDATE phone_listings SET product_type='tablet' WHERE id=? AND product_type IS NULL");
const setSetting = db.prepare(
  'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
);

db.transaction(() => {
  for (const d of plan.catalogDelete) delCat.run(d.id);
  for (const r of plan.catalogRename) renCat.run(r.to.brand, r.to.model, r.to.device_type, r.id);
  for (const i of plan.catalogInsert) insCat.run(i.brand, i.device_type, i.model, 'manual', now);
  for (const t of plan.catalogTopup) insCat.run(t.brand, t.device_type, t.model, 'gsmarena', now);
  for (const s of plan.suggestApprove) {
    insCat.run(s.to.brand, s.to.type, s.to.model, 'suggestion', now);
    approve.run('approved', now, s.to.brand, s.to.model, s.to.type, s.id);
  }
  for (const s of plan.suggestReject) reject.run('rejected', now, s.note, s.id);

  // Re-plan against the catalogue as it now is — which must equal what
  // was primed above; the reset is the check that it does.
  resetCatalogCache();
  planListings();
  const finalWrites = [...plan.listing.manual, ...plan.listing.brand, ...plan.listing.catalog];
  for (const w of finalWrites) {
    updL.run(w.to_brand, w.to_model, now, w.id);
    if (afterCatalog.get(`${w.to_brand}|${w.to_model}`) === 'tablet') setType.run(w.id);
  }
  const maxId = db.prepare('SELECT MAX(id) m FROM phone_listings').get().m;
  setSetting.run('listing_namefix_watermark_id', String(maxId));
  console.log(`\nwrote: catalogue -${plan.catalogDelete.length} ~${plan.catalogRename.length} +${plan.catalogInsert.length + plan.suggestApprove.filter((s) => s.insert).length},`
    + ` suggestions ${plan.suggestApprove.length + plan.suggestReject.length}, listings ${finalWrites.length}. Watermark → ${maxId}.`);
})();
console.log(`backup: ${backup}`);
