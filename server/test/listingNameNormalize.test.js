// Turning what a seller typed into a catalogue device — and, mostly, the
// cases where it must refuse. Every guard here is a rename that once went
// wrong on production: iPad → iPhone, MacBook → iPhone, "7 Plus" → "7".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-names-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const {
  resolveListingName, stripLeadingBrand, resetCatalogCache, matchObjection,
} = await import('../src/listingNameNormalize.js');

// A small catalogue of the shapes that matter, replacing the seeded one.
db.prepare('DELETE FROM device_catalog').run();
const ins = db.prepare(
  "INSERT INTO device_catalog(brand, device_type, model, source, created_at) VALUES(?,?,?,'gsmarena',1)",
);
for (const [b, t, m] of [
  ['Apple', 'phone', 'iPhone 7'], ['Apple', 'phone', 'iPhone 7 Plus'], ['Apple', 'phone', 'iPhone 11 Pro'],
  ['Apple', 'phone', 'iPhone 13'], ['Apple', 'phone', 'iPhone 13 Pro Max'], ['Apple', 'phone', 'iPhone Air'],
  ['Apple', 'phone', 'iPhone 14'], ['Apple', 'tablet', 'iPad Pro 11 (2025)'], ['Apple', 'watch', 'Watch Ultra 3'],
  ['Samsung', 'phone', 'Galaxy S21 Ultra 5G'], ['Samsung', 'phone', 'Galaxy A26'],
  ['Redmi', 'phone', 'Note 14 Pro 4G'], ['Redmi', 'phone', 'Note 14 Pro 5G'], ['Redmi', 'phone', 'Note 14 Pro+ 5G'],
  ['Huawei', 'tablet', 'MatePad 11.5'], ['Huawei', 'tablet', 'MatePad 11.5 (2025)'],
  ['Honor', 'tablet', 'Pad X8b'], ['Honor', 'phone', 'X7e Plus'], ['Honor', 'phone', 'X7e Plus 4G'],
  ['Infinix', 'phone', 'Hot 60 Pro+'], ['Infinix', 'phone', 'Note 50 4G'],
  ['Motorola', 'phone', 'Moto G15'], ['POCO', 'phone', 'X7 Pro'], ['Tecno', 'phone', 'Camon 40'],
]) ins.run(b, t, m);
resetCatalogCache();

const AVAILABLE = new Set(['Apple', 'Samsung', 'Xiaomi', 'Redmi', 'POCO', 'Honor', 'Huawei',
  'Infinix', 'Tecno', 'Nubia', 'Other']);

// ─── stripLeadingBrand ─────────────────────────────────────────────────

test('a leading brand word becomes the brand and leaves the name', () => {
  assert.deepEqual(stripLeadingBrand('Poco X4 5G', AVAILABLE), { brand: 'POCO', model: 'X4 5G' });
  assert.deepEqual(stripLeadingBrand('Redmi  A5', AVAILABLE), { brand: 'Redmi', model: 'A5' });
  assert.deepEqual(stripLeadingBrand('تكنو بوفا 7', AVAILABLE), { brand: 'Tecno', model: 'بوفا 7' });
});

test('stacked brands keep the last one the app offers', () => {
  assert.deepEqual(stripLeadingBrand('ZTE Nubia Neo 5G', AVAILABLE), { brand: 'Nubia', model: 'Neo 5G' });
});

test('a brand the app does not offer is left in the name', () => {
  // "Sony" is all a buyer has when the brand field says Other.
  assert.deepEqual(stripLeadingBrand('Sony Xperia 1 IV', AVAILABLE), { brand: null, model: 'Sony Xperia 1 IV' });
});

test('a brand on its own is not a device', () => {
  assert.deepEqual(stripLeadingBrand('Poco', AVAILABLE), { brand: null, model: 'Poco' });
});

test('line words are not brands', () => {
  assert.deepEqual(stripLeadingBrand('Galaxy Z Fold 7', AVAILABLE), { brand: null, model: 'Galaxy Z Fold 7' });
  assert.deepEqual(stripLeadingBrand('iPhone 13', AVAILABLE), { brand: null, model: 'iPhone 13' });
});

// ─── resolveListingName ────────────────────────────────────────────────

test('Arabic is transliterated and the longest run wins', () => {
  const r = resolveListingName('Apple', 'ايفون 13 برو ماكس ذاكره 256');
  assert.equal(r.model, 'iPhone 13 Pro Max');
  assert.equal(r.confidence, 'exact');
});

test('a seller who wrote Plus is not demoted to the plain model', () => {
  // The catalogue has both, but a seller with a 7 Plus typed the plus.
  assert.equal(resolveListingName('Apple', 'ايفون 7 بلس').model, 'iPhone 7 Plus');
  // No iPhone 13 Plus exists: refuse rather than hand back iPhone 13.
  const r = resolveListingName('Apple', 'iPhone 13 plus');
  assert.equal(r.model, null);
  assert.equal(r.objection, 'demotion:plus');
  assert.equal(r.refused, 'iPhone 13');
});

test('an iPad never lands on an iPhone', () => {
  const r = resolveListingName('Apple', 'ipad 11 pro');
  assert.equal(r.model, null);
  assert.equal(r.objection, 'family:ipad');
});

test('a MacBook never lands on anything', () => {
  assert.equal(resolveListingName('Apple', 'MacBook Air 13-inch (M5)').model, null);
  assert.equal(resolveListingName('Apple', 'MacBook Pro 14-inch (M5 10CPU/10GPU)').model, null);
});

test('a watch resolves to a watch', () => {
  assert.equal(resolveListingName('Apple', 'Apple WATCH ULTRA 3 (49mm)').model, 'Watch Ultra 3');
});

test('the 5G suffix the catalogue carries and the seller dropped is bridged', () => {
  assert.equal(resolveListingName('Samsung', 'Galaxy S21 Ultra').model, 'Galaxy S21 Ultra 5G');
  assert.equal(resolveListingName('Infinix', 'Note 50').model, 'Note 50 4G');
});

test('but not when two catalogue rows shave to the same name', () => {
  // Note 14 Pro 4G and Note 14 Pro 5G are different phones.
  assert.equal(resolveListingName('Redmi', 'Note 14 Pro').model, null);
  // The exact spelling still resolves.
  assert.equal(resolveListingName('Redmi', 'Note 14 Pro +5G').model, 'Note 14 Pro+ 5G');
});

test('a seller writing 5G where the catalogue has none is bridged too', () => {
  assert.equal(resolveListingName('Samsung', 'Galaxy A26 5G').model, 'Galaxy A26');
  assert.equal(resolveListingName('Honor', 'X7e Plus 5G').model, 'X7e Plus');
});

test('an exact spelling beats a shaved one', () => {
  assert.equal(resolveListingName('Honor', 'X7e Plus 4G').model, 'X7e Plus 4G');
});

test('decimal sizes survive tokenisation', () => {
  assert.equal(resolveListingName('Huawei', 'Huawei MatePad 11.5').model, 'MatePad 11.5');
  assert.equal(resolveListingName('Huawei', 'MatePad 11.5 (2025) PaperMatte').model, 'MatePad 11.5 (2025)');
});

test('an edition word is not a different device', () => {
  assert.equal(resolveListingName('Honor', 'HONOR Pad X8b Kids').model, 'Pad X8b');
});

test('Plus and + are the same spelling', () => {
  assert.equal(resolveListingName('Infinix', 'HOT 60 Pro Plus').model, 'Hot 60 Pro+');
});

test('the line word can be dropped by the seller', () => {
  assert.equal(resolveListingName('Motorola', 'G15').model, 'Moto G15');
  assert.equal(resolveListingName('Apple', '13 pro max').model, 'iPhone 13 Pro Max');
});

test('a brand named in the text overrides the dropdown', () => {
  const r = resolveListingName('Apple', 'Poco X7 Pro');
  assert.equal(r.brand, 'POCO');
  assert.equal(r.model, 'X7 Pro');
  assert.equal(r.confidence, 'brand-fixed');
});

test('a modifier the catalogue model lacks blocks the match', () => {
  assert.equal(resolveListingName('Tecno', 'Camon 40 Pro 5G').model, null);
  assert.equal(matchObjection(['camon', '40', 'pro'], 'Camon 40'), 'demotion:pro');
  assert.equal(matchObjection(['camon', '40'], 'Camon 40'), null);
});

test('ad text with no device in it resolves to nothing', () => {
  assert.equal(resolveListingName('Honor', 'جديد ما مستعمل').model, null);
  assert.equal(resolveListingName('Apple', '').model, null);
});
