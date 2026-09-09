import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPriceRange } from '../src/lib/priceRange.ts';

test('a range abbreviates both ends so it fits on one line', () => {
  assert.equal(formatPriceRange(1070000, 1300000), '1.07م – 1.3م');
  assert.equal(formatPriceRange(450000, 900000), '450ألف – 900ألف');
});

test('equal ends print once, not twice', () => {
  // "900ألف – 900ألف" reads as a rendering bug, not as one price.
  assert.equal(formatPriceRange(900000, 900000), '900ألف');
});

test('no real price is no line at all', () => {
  // Every listing call-for-price. The endpoint sends null for both ends, and
  // a "0" or an empty dash on the card would be worse than showing nothing.
  assert.equal(formatPriceRange(null, null), null);
  assert.equal(formatPriceRange(undefined, undefined), null);
  assert.equal(formatPriceRange(0, 0), null);
});

test('one end missing prints the end there is', () => {
  assert.equal(formatPriceRange(750000, null), '750ألف');
  assert.equal(formatPriceRange(null, 750000), '750ألف');
});

test('millions keep two decimals below ten and round above', () => {
  assert.equal(formatPriceRange(1500000, 1500000), '1.5م');
  assert.equal(formatPriceRange(12400000, 12400000), '12م');
});

test('sub-thousand prices are not rounded away to zero', () => {
  assert.equal(formatPriceRange(400, 400), '400');
});
