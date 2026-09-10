// «ينتهي بعد 5 ساعات» — the deadline badge on a request card.
//
// The interesting part is not the arithmetic, it is the two silences: a
// deadline far enough away that saying it is noise, and one already passed.
// Both used to be the caller's problem, and a caller that forgets either
// puts a badge on every card in the feed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeLeftAr, ltrNum } from '../src/lib/format.ts';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const HOUR = 3_600_000;
const left = (ms: number, within?: number) => timeLeftAr(NOW + ms, within ?? 24, NOW);
// Numerals arrive wrapped in LRM marks — without them an Arabic line puts
// «5 ساعات» on screen as «ساعات 5». Writing the expectations through ltrNum
// keeps that invisible detail asserted rather than accidentally deleted.
const n = (x: number) => ltrNum(x);

test('hours are inflected, not just counted', () => {
  assert.equal(left(5 * HOUR), `ينتهي بعد ${n(5)} ساعات`);
  assert.equal(left(1 * HOUR), 'ينتهي بعد ساعة');
  assert.equal(left(2 * HOUR), 'ينتهي بعد ساعتين');
  // 11+ goes back to the singular. Correct Arabic, wrong-looking in English.
  assert.equal(left(11 * HOUR), `ينتهي بعد ${n(11)} ساعة`);
});

test('under an hour it counts minutes', () => {
  assert.equal(left(20 * 60_000), `ينتهي بعد ${n(20)} دقيقة`);
  assert.equal(left(2 * 60_000), 'ينتهي بعد دقيقتين');
});

test('a far-off deadline says nothing', () => {
  // A request lives 21 days. «ينتهي بعد 19 يوماً» on every card is a badge
  // that has stopped meaning "hurry".
  assert.equal(left(19 * 24 * HOUR), null);
  assert.equal(left(25 * HOUR), null);
  assert.equal(left(23 * HOUR), `ينتهي بعد ${n(23)} ساعة`, 'just inside the window still speaks');
});

test('a passed deadline says nothing either', () => {
  // Expired is a STATUS, and a card cannot be both counting down and over.
  assert.equal(left(-HOUR), null);
  assert.equal(left(0), null);
});

test('the last minute still counts as a minute, not zero', () => {
  // Math.floor of 30 seconds is 0, and «ينتهي بعد 0 دقيقة» is worse than
  // both the truth and silence.
  assert.equal(left(30_000), 'ينتهي بعد دقيقة');
});

test('the window is caller-set, because urgency is context', () => {
  assert.equal(left(5 * HOUR, 3), null);
  assert.equal(left(2 * HOUR, 3), 'ينتهي بعد ساعتين');
});
