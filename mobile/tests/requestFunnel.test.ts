import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderBrandsForFunnel, HEAD_BRANDS, brandLabel } from '../src/lib/requestFunnel.ts';

// The live /brands order, deliberately NOT in the owner's order, with counts.
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

test("the head is the owner's six, in the owner's order, not the server's", () => {
  const { head } = orderBrandsForFunnel(LIVE);
  assert.deepEqual(head.map((b) => b.name), ['Apple', 'Samsung', 'Honor', 'Realme', 'Xiaomi', 'Infinix']);
});

test('the rest is ordered by what is actually for sale', () => {
  const { rest } = orderBrandsForFunnel(LIVE);
  assert.deepEqual(rest.map((b) => b.name), ['Tecno', 'POCO', 'Huawei', 'Other']);
});

test('a head brand the server does not have is skipped, never invented', () => {
  // A pill for a brand the server does not know would filter on a name it
  // ignores and silently return everything.
  const { head } = orderBrandsForFunnel(LIVE.filter((b) => b.name !== 'Honor'));
  assert.deepEqual(head.map((b) => b.name), ['Apple', 'Samsung', 'Realme', 'Xiaomi', 'Infinix']);
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
  assert.equal(HEAD_BRANDS.length, 6);
});
