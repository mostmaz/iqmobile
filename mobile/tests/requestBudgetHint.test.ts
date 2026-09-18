// The line under the budget stepper, and its agreement with the server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetHint, LOW_BUDGET_SHARE } from '../src/lib/requestBudgetHint.ts';

test('a ceiling far under the market warns', () => {
  const h = budgetHint(50000, 500000);
  assert.ok(h);
  assert.match(h!.title, /الوسيط 500,000/);
  assert.match(h!.body, /تقدر تنشر الطلب/, 'says it is still allowed');
});

test('nothing worth saying returns null, not an empty verdict', () => {
  assert.equal(budgetHint(600000, 500000), null);
  assert.equal(budgetHint(500000 * LOW_BUDGET_SHARE, 500000), null, 'the threshold itself is fine');
});

test('no median, no opinion', () => {
  // Under four live listings the server sends null; a thinly-stocked device
  // must not have its buyers warned off on two prices.
  assert.equal(budgetHint(1000, null), null);
  assert.equal(budgetHint(1000, undefined), null);
  assert.equal(budgetHint(1000, 0), null);
});

test('a nonsense ceiling is not warned about', () => {
  for (const cap of [0, -1, NaN]) assert.equal(budgetHint(cap, 500000), null);
});

test('the threshold matches the server constant exactly', () => {
  // Two copies of one rule; if they drift the app warns about prices the
  // server accepts silently, or the reverse.
  assert.equal(LOW_BUDGET_SHARE, 0.4);
});

test('the suggested range is rounded to something sayable', () => {
  const h = budgetHint(50000, 537000);
  assert.match(h!.body, /375,000/);
  assert.match(h!.body, /535,000/);
});
