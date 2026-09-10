import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderBrandsForFunnel, HEAD_BRANDS, brandLabel } from '../src/lib/requestFunnel.ts';

// The live /brands order, deliberately NOT in supply order, with counts.
const LIVE = [
  { name: 'Apple', display_ar: 'آبل', position: 1, count: 120 },
  { name: 'Samsung', display_ar: 'سامسونج', position: 2, count: 95 },
  { name: 'Xiaomi', display_ar: 'شاومي', position: 3, count: 40 },
  { name: 'Realme', display_ar: 'ريلمي', position: 4, count: 30 },
  { name: 'Tecno', display_ar: 'تكنو', position: 5, count: 25 },
  { name: 'Huawei', display_ar: 'هواوي', position: 6, count: 10 },
  { name: 'Other', display_ar: 'أخرى', position: 13, count: 8 },
  { name: 'Honor', display_ar: 'هونر', position: 14, count: 20 },
  { name: 'Infinix', display_ar: 'انفنكس', position: 15, count: 15 },
  { name: 'POCO', display_ar: 'بوكو', position: 16, count: 12 },
];

test("the head is the owner's list, ordered by what is for sale", () => {
  // Membership comes from HEAD_BRANDS; the order comes from supply, so the
  // grid reorders itself as the marketplace changes rather than freezing a
  // ranking that was true the day it was typed.
  const { head } = orderBrandsForFunnel(LIVE);
  assert.deepEqual(head.map((b) => b.name),
    ['Apple', 'Samsung', 'Xiaomi', 'Realme', 'Tecno', 'Honor', 'Infinix']);
  const counts = head.map((b) => b.count ?? 0);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'descending');
});

test('the biggest brand is the first entry, which RTL puts top-right', () => {
  // The grid renders row-reverse, so entry 0 is the top-RIGHT card — where an
  // Arabic reader's eye starts.
  const { head } = orderBrandsForFunnel(LIVE);
  assert.equal(head[0].name, 'Apple');
});

test('brands tied on count fall back to the owner list, not to chance', () => {
  // Array.prototype.sort is only stable within one engine's implementation
  // for a given input; an explicit tie-break keeps an empty marketplace
  // rendering the same grid every time.
  const tied = HEAD_BRANDS.map((k) => ({ name: k, count: 0 }));
  const { head } = orderBrandsForFunnel([...tied].reverse());
  assert.deepEqual(head.map((b) => b.name), HEAD_BRANDS);
});

test('Tecno is a head brand, not one of the rest', () => {
  // It outsells three of the brands above it on the server's own count and
  // was still behind «أخرى» — the owner added it to the head list.
  const { head, rest } = orderBrandsForFunnel(LIVE);
  assert.ok(head.some((b) => b.name === 'Tecno'));
  assert.ok(!rest.some((b) => b.name === 'Tecno'));
});

test('the rest is ordered by what is actually for sale', () => {
  const { rest } = orderBrandsForFunnel(LIVE);
  assert.deepEqual(rest.map((b) => b.name), ['POCO', 'Huawei', 'Other']);
});

test('a head brand the server does not have is skipped, never invented', () => {
  // A pill for a brand the server does not know would filter on a name it
  // ignores and silently return everything.
  const { head } = orderBrandsForFunnel(LIVE.filter((b) => b.name !== 'Honor'));
  assert.ok(!head.some((b) => b.name === 'Honor'));
  assert.deepEqual(head.map((b) => b.name), ['Apple', 'Samsung', 'Xiaomi', 'Realme', 'Tecno', 'Infinix']);
});

test('the literal "Other" brand is a row in the rest, not the «أخرى» pill', () => {
  const { head, rest } = orderBrandsForFunnel(LIVE);
  assert.ok(!head.some((b) => b.name === 'Other'));
  assert.ok(rest.some((b) => b.name === 'Other'));
});

test('no brand appears in both lists', () => {
  const { head, rest } = orderBrandsForFunnel(LIVE);
  const names = [...head, ...rest].map((b) => b.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, LIVE.length);
});

test('matching is case-insensitive and tolerant of stray whitespace', () => {
  const { head } = orderBrandsForFunnel([{ name: ' apple ' }, { name: 'SAMSUNG' }]);
  assert.deepEqual(head.map((b) => b.name), [' apple ', 'SAMSUNG']);
});

test('ties in count fall back to the server position', () => {
  const { rest } = orderBrandsForFunnel([
    { name: 'Zeta', position: 9, count: 5 }, { name: 'Alpha', position: 2, count: 5 },
  ]);
  assert.deepEqual(rest.map((b) => b.name), ['Alpha', 'Zeta']);
});

test('junk input is an empty funnel, not a throw', () => {
  assert.deepEqual(orderBrandsForFunnel(null), { head: [], rest: [] });
  assert.deepEqual(orderBrandsForFunnel([null as any, { name: '' }]), { head: [], rest: [] });
});

test('the label prefers Arabic and falls back to the name', () => {
  assert.equal(brandLabel({ name: 'Apple', display_ar: 'آبل' }), 'آبل');
  assert.equal(brandLabel({ name: 'POCO', display_ar: '  ' }), 'POCO');
  assert.equal(HEAD_BRANDS.length, 7);
});

// ── the fold that decides whether "this device is available" appears ──────
import { foldModelKey } from '../src/lib/requestFunnel.ts';

test('spelling differences between catalogue and sellers fold together', () => {
  // A chip's label is the spelling sellers use most; the model a buyer picks
  // comes from the catalogue. Raw-string matching would show no availability
  // for a device with twenty listings.
  const k = foldModelKey('Galaxy S24 Ultra');
  for (const v of ['galaxy s24 ultra', 'GALAXY  S24ULTRA', 'Galaxy S24 Ultra ']) {
    assert.equal(foldModelKey(v), k, v);
  }
});

test('Arabic orthography and digits fold the same way the SQL does', () => {
  assert.equal(foldModelKey('ايفون ١٣'), foldModelKey('أيفون 13'));
  assert.equal(foldModelKey('إيفون١٣'), foldModelKey('ايفون 13'));
});

test('a real difference is still a difference', () => {
  assert.notEqual(foldModelKey('Galaxy S24 Ultra'), foldModelKey('Galaxy S24'));
  assert.notEqual(foldModelKey('iPhone 13'), foldModelKey('iPhone 13 Pro'));
});

test('junk folds to an empty string rather than throwing', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(foldModelKey(v as any), '');
});

// ─── the compose sheet's rail ──────────────────────────────────────────
//
// Its brands come from the CATALOGUE, whose `count` is models-we-know-of,
// not listings-for-sale. These pin that the two are not confused again.
import { orderComposeBrands } from '../src/lib/requestFunnel.ts';

// A catalogue that disagrees with the market on purpose: Huawei has the
// most known models and nothing for sale, Apple the reverse.
const CATALOG = [
  { brand: 'Huawei', count: 400 },
  { brand: 'Xiaomi', count: 300 },
  { brand: 'Apple', count: 90 },
  { brand: 'Tecno', count: 60 },
];
const SUPPLY = [
  { name: 'Apple', count: 120 },
  { name: 'Xiaomi', count: 40 },
  { name: 'Tecno', count: 25 },
  { name: 'Huawei', count: 0 },
];

test('the rail is ordered by listings for sale, not catalogue size', () => {
  const out = orderComposeBrands(CATALOG, SUPPLY).map((b) => b.brand);
  assert.deepEqual(out, ['Apple', 'Xiaomi', 'Tecno', 'Huawei']);
});

test('a brand nobody has listed keeps its place rather than disappearing', () => {
  // The catalogue is what the model picker queries, so dropping a brand
  // here would remove a device a buyer can legitimately ask for.
  const out = orderComposeBrands([...CATALOG, { brand: 'Nokia', count: 12 }], SUPPLY);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((b) => b.brand).slice(-2), ['Huawei', 'Nokia'],
    'unsold brands fall to the end, ordered by catalogue size');
});

test('brand names are matched case-insensitively across the two sources', () => {
  // /brands says "Apple"; the catalogue could say "apple". A miss here
  // silently scores a top brand as zero.
  const out = orderComposeBrands([{ brand: 'apple', count: 1 }, { brand: 'Xiaomi', count: 900 }], SUPPLY);
  assert.deepEqual(out.map((b) => b.brand), ['apple', 'Xiaomi']);
});

test('ties keep the catalogue order instead of reshuffling', () => {
  const cat = [{ brand: 'A', count: 5 }, { brand: 'B', count: 5 }, { brand: 'C', count: 5 }];
  const supply = [{ name: 'A', count: 3 }, { name: 'B', count: 3 }, { name: 'C', count: 3 }];
  assert.deepEqual(orderComposeBrands(cat, supply).map((b) => b.brand), ['A', 'B', 'C']);
});

test('missing inputs are an empty rail, not a crash', () => {
  assert.deepEqual(orderComposeBrands(null, null), []);
  assert.deepEqual(orderComposeBrands(CATALOG, null).map((b) => b.brand),
    ['Huawei', 'Xiaomi', 'Apple', 'Tecno'], 'no supply data falls back to catalogue order');
});
