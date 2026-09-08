// The request funnel's "top 10 devices" — grouping and labelling rules.
//
// `model_key` arrives from SQL already folded; these tests hand it in so
// they exercise the choices this module actually owns: which spelling is
// the label, what counts as a price, and the order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTopModels } from '../src/topModels.js';

const T = Date.parse('2026-09-08T12:00:00+03:00');
const row = (o = {}) => ({
  model: 'Galaxy S25 Ultra', model_key: 'galaxys25ultra', asking_price: 900000,
  price_on_request: 0, created_at: T, image_path: '/uploads/a.webp', ...o,
});

test('spellings that fold to one key are one device', () => {
  const out = groupTopModels([
    row({ model: 'Galaxy S25 Ultra' }),
    row({ model: 'galaxy s25 ultra' }),
    row({ model: 'GALAXY S25  ULTRA' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 3);
});

test('the label is the spelling sellers use most', () => {
  // Not whichever row SQLite emits for a bare GROUP BY column — that is
  // arbitrary, and a chip whose wording changes on refresh looks broken.
  const out = groupTopModels([
    row({ model: 'galaxy s25 ultra' }),
    row({ model: 'Galaxy S25 Ultra' }),
    row({ model: 'Galaxy S25 Ultra' }),
  ]);
  assert.equal(out[0].model, 'Galaxy S25 Ultra');
});

test('ordered by count, then by the newest listing', () => {
  const out = groupTopModels([
    row({ model_key: 'a', created_at: T - 5 }),
    row({ model_key: 'b', created_at: T }),
    row({ model_key: 'b', created_at: T - 9 }),
    row({ model_key: 'c', created_at: T - 1 }),
  ]);
  assert.deepEqual(out.map((g) => g.model_key), ['b', 'c', 'a']);
});

test('a call-for-price row never becomes the minimum price', () => {
  // asking_price=1 is the sentinel. "from 1 د.ع" on a chip is the bug #9
  // removed from the cards, and it must not come back here.
  const out = groupTopModels([
    row({ asking_price: 1, price_on_request: 1 }),
    row({ asking_price: 850000 }),
  ]);
  assert.equal(out[0].min_price, 850000);
  const only = groupTopModels([row({ asking_price: 1, price_on_request: 1 })]);
  assert.equal(only[0].min_price, null, 'no real price means no price, not 1');
});

test('the thumbnail follows the newest listing in the group', () => {
  const out = groupTopModels([
    row({ created_at: T - 100, image_path: '/old.webp' }),
    row({ created_at: T, image_path: '/new.webp' }),
    row({ created_at: T - 50, image_path: '/mid.webp' }),
  ]);
  assert.equal(out[0].image_path, '/new.webp');
});

test('the cap holds and the internal ordering field does not leak', () => {
  const rows = [];
  for (let i = 0; i < 25; i++) rows.push(row({ model_key: `k${i}`, model: `M${i}` }));
  const out = groupTopModels(rows, { limit: 10 });
  assert.equal(out.length, 10);
  assert.deepEqual(Object.keys(out[0]).sort(), ['count', 'image_path', 'min_price', 'model', 'model_key']);
});

test('rows with no key are skipped rather than merged into one bucket', () => {
  const out = groupTopModels([row({ model_key: '' }), row({ model_key: null }), row()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 1);
});

test('empty and junk input produce an empty list, never a throw', () => {
  assert.deepEqual(groupTopModels([]), []);
  assert.deepEqual(groupTopModels(null), []);
  assert.deepEqual(groupTopModels([null, undefined, {}]), []);
});
