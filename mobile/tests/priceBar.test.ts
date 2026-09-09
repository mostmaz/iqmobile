import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barPoints } from '../src/lib/priceBar.ts';

test('the median sits where it falls between the ends', () => {
  const b = barPoints(100, 300, 200, null);
  assert.equal(b.median, 0.5);
  assert.equal(b.price, null);
});

test('a price outside the observed range is pinned and flagged', () => {
  // The marker must stay on the track — a fraction above 1 would push it out
  // of the bar and off the card — but the seller still has to be told.
  const above = barPoints(100, 300, 200, 900);
  assert.equal(above.price, 1);
  assert.equal(above.priceOutside, 'above');

  const below = barPoints(100, 300, 200, 10);
  assert.equal(below.price, 0);
  assert.equal(below.priceOutside, 'below');
});

test('a range with no width centres instead of dividing by zero', () => {
  // Every comparable listing asks the same number. NaN in a style prop
  // collapses the bar silently rather than throwing, so it never reaches it.
  const b = barPoints(500, 500, 500, 500);
  assert.equal(b.median, 0.5);
  assert.equal(b.price, 0.5);
  assert.equal(b.priceOutside, null);
});

test('a missing or nonsense price places no marker', () => {
  for (const v of [null, undefined, 0, NaN, -5]) {
    assert.equal(barPoints(100, 300, 200, v as any).price, null, String(v));
  }
});
