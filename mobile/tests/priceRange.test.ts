import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPriceRange } from '../src/lib/priceRange.ts';

test('the unit is a separate word, never glued to the numeral', () => {
  // «450ألف» sticks a Latin numeral to an Arabic word and reads as one
  // broken token. «450 ألف» is how the price is said out loud.
  assert.equal(formatPriceRange(750000, null), '750 ألف');
  assert.equal(formatPriceRange(1500000, 1500000), '1.5 مليون');
});

test('both ends in one unit share it', () => {
  // Half a card is ~146pt, and repeating the word was the difference between
  // one line and two.
  assert.equal(formatPriceRange(450000, 900000), '450 – 900 ألف');
  assert.equal(formatPriceRange(1070000, 1300000), '1.07 – 1.3 مليون');
});

test('ends in different units each keep their own', () => {
  assert.equal(formatPriceRange(770000, 1200000), '770 ألف – 1.2 مليون');
});

test('equal ends print once, not twice', () => {
  // "900ألف – 900ألف" reads as a rendering bug, not as one price.
  assert.equal(formatPriceRange(900000, 900000), '900 ألف');
});

test('no real price is no line at all', () => {
  // Every listing call-for-price. The endpoint sends null for both ends, and
  // a "0" or an empty dash on the card would be worse than showing nothing.
  assert.equal(formatPriceRange(null, null), null);
  assert.equal(formatPriceRange(undefined, undefined), null);
  assert.equal(formatPriceRange(0, 0), null);
});

test('one end missing prints the end there is', () => {
  assert.equal(formatPriceRange(750000, null), '750 ألف');
  assert.equal(formatPriceRange(null, 750000), '750 ألف');
});

test('millions keep two decimals below ten and round above', () => {
  assert.equal(formatPriceRange(1500000, 1500000), '1.5 مليون');
  assert.equal(formatPriceRange(12400000, 12400000), '12 مليون');
});

test('sub-thousand prices are not rounded away to zero', () => {
  assert.equal(formatPriceRange(400, 400), '400');
});
