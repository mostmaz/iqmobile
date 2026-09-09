import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDITIONS, SELLABLE, CONDITION_AR, isCondition, toCondition } from '../src/conditions.js';

test('a retired condition stays valid even after it stops being offered', () => {
  // The whole reason there are two lists. «مجدد» left the sell form; if it
  // left validation too, the listings already carrying it would fail every
  // filter — the same bug that once made مصلح devices unfindable.
  assert.ok(!SELLABLE.includes('refurbished'), 'not offered');
  assert.ok(CONDITIONS.includes('refurbished'), 'still valid');
  assert.ok(isCondition('refurbished'));
});

test('everything sellable is valid', () => {
  for (const c of SELLABLE) assert.ok(CONDITIONS.includes(c), c);
});

test('«كالجديد» sits directly after «جديد» in the sell form', () => {
  assert.deepEqual(SELLABLE.slice(0, 2), ['new', 'like_new']);
});

test('every valid condition has an Arabic label', () => {
  // A missing label renders the raw key to a buyer, in Latin, mid-sentence.
  for (const c of CONDITIONS) {
    assert.equal(typeof CONDITION_AR[c], 'string', c);
    assert.ok(CONDITION_AR[c].length > 0, c);
  }
});

test('toCondition falls back rather than throwing', () => {
  // Importers feed it untrusted spreadsheet cells.
  assert.equal(toCondition('used'), 'used');
  assert.equal(toCondition('like_new'), 'like_new');
  assert.equal(toCondition('nonsense'), 'new');
  assert.equal(toCondition(undefined, 'used'), 'used');
});
