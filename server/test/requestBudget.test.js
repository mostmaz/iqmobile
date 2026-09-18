// Is this budget going to get any offers?

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetVerdict, LOW_BUDGET_SHARE } from '../src/requestBudget.js';

test('50,000 for a phone with a 500,000 median is flagged', () => {
  // The actual shape of the five unfillable requests on the board.
  const v = budgetVerdict({ maxPrice: 50000, median: 500000 });
  assert.equal(v.low, true);
  assert.match(v.message, /الوسيط 500,000/);
  assert.match(v.message, /قد لا تصلك عروض/);
});

test('the threshold is a share of the median, and it is not tight', () => {
  // Used phones legitimately spread; this catches a missing digit, not a
  // hard bargain.
  const median = 500000;
  assert.equal(budgetVerdict({ maxPrice: median * LOW_BUDGET_SHARE, median }).low, false);
  assert.equal(budgetVerdict({ maxPrice: median * LOW_BUDGET_SHARE - 1, median }).low, true);
});

test('a generous budget says nothing at all', () => {
  const v = budgetVerdict({ maxPrice: 600000, median: 500000 });
  assert.equal(v.low, false);
  assert.equal(v.message, null);
  assert.equal(v.median, 500000, 'the median is still reported');
});

test('no median means no opinion', () => {
  // A thinly-stocked device must not have its buyers warned off on the
  // strength of two listings.
  for (const median of [null, undefined, 0, NaN]) {
    const v = budgetVerdict({ maxPrice: 1000, median });
    assert.equal(v.low, false, `median=${String(median)}`);
    assert.equal(v.message, null);
  }
});

test('a missing or nonsense ceiling is not warned about', () => {
  // The route validates max_price separately; this must not double-report.
  for (const maxPrice of [0, -1, NaN, null, undefined, 'abc']) {
    assert.equal(budgetVerdict({ maxPrice, median: 500000 }).low, false);
  }
});

test('the suggestion is a range, rounded to something sayable', () => {
  // Quoting the median alone reads as a price the buyer must meet.
  const v = budgetVerdict({ maxPrice: 50000, median: 537000 });
  assert.equal(v.suggested_max, 535000);
  assert.equal(v.suggested_min, 375000);
  assert.ok(v.suggested_min < v.suggested_max);
  assert.equal(v.suggested_min % 5000, 0);
  assert.equal(v.suggested_max % 5000, 0);
});

test('the verdict shape is stable whether it fires or not', () => {
  const keys = ['low', 'median', 'message', 'suggested_max', 'suggested_min'];
  assert.deepEqual(Object.keys(budgetVerdict({ maxPrice: 50000, median: 500000 })).sort(), keys);
  assert.deepEqual(Object.keys(budgetVerdict({ maxPrice: 600000, median: 500000 })).sort(), keys);
  assert.deepEqual(Object.keys(budgetVerdict({})).sort(), keys);
});
