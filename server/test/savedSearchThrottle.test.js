// How often a saved search may interrupt someone.
//
// The numbers this was written against, measured on production over 14 days:
// 547 active searches, 14,055 alerts, 335 recipients, 495 listings posted.
// Four people were told about 83% of everything on the marketplace and
// opened none of it. Every test below names the specific failure it pins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideAlert, isAlertable,
  PUSH_COOLDOWN_MS, MAX_PUSH_PER_DAY, UNOPENED_LIMIT,
} from '../src/savedSearchThrottle.js';

const NOW = Date.parse('2026-09-13T12:00:00+03:00');
const HOUR = 3600000;
const decide = (o = {}) => decideAlert({ criteria: { brand: 'Apple' }, now: NOW, ...o });

// ── what counts as a search ────────────────────────────────────────────

test('a search with no narrowing is not a search', () => {
  // 124 of the 547 live searches carry no brand, model or text. They match
  // every listing posted, which is the browse feed with extra steps.
  assert.equal(isAlertable({}), false);
  assert.equal(isAlertable({ governorate: 'Baghdad' }), false);
  assert.equal(isAlertable({ condition: 'used', max_price: 500000 }), false);
});

test('a brand alone IS a search', () => {
  // «tell me about new Samsungs» is a real request, and at ~500 listings a
  // fortnight it is a survivable volume.
  assert.equal(isAlertable({ brand: 'Samsung' }), true);
  assert.equal(isAlertable({ model: 'iPhone 13' }), true);
  assert.equal(isAlertable({ q: 'ايفون' }), true);
});

test('empty strings and whitespace do not count as narrowing', () => {
  // A cleared field must not keep a search alive as if it were set.
  assert.equal(isAlertable({ brand: '', model: '  ', q: null }), false);
  assert.equal(isAlertable({ brand: '   Apple ' }), true);
});

test('a too-broad search is dropped, not filed', () => {
  // Not merely un-pushed: writing 400 unread rows a fortnight per person is
  // storage, not a feature.
  const d = decide({ criteria: { governorate: 'Baghdad' } });
  assert.deepEqual(d, { record: false, push: false, reason: 'search_too_broad' });
});

// ── the limits, which are per PERSON ───────────────────────────────────

test('an ordinary first match pushes', () => {
  assert.deepEqual(decide(), { record: true, push: true, reason: 'ok' });
});

test('the cooldown belongs to the person, not the search', () => {
  // It used to be per search, so saving eight searches bought eight times
  // the interruptions — and one of the worst-hit users had eight.
  const d = decide({ lastPushAt: NOW - PUSH_COOLDOWN_MS / 2 });
  assert.equal(d.push, false);
  assert.equal(d.reason, 'cooldown');
  assert.equal(d.record, true, 'still lands in the inbox to be found later');
});

test('the cooldown expires', () => {
  assert.equal(decide({ lastPushAt: NOW - PUSH_COOLDOWN_MS - 1 }).push, true);
});

test('a daily ceiling, however many searches matched', () => {
  assert.equal(decide({ pushesToday: MAX_PUSH_PER_DAY - 1 }).push, true);
  const capped = decide({ pushesToday: MAX_PUSH_PER_DAY });
  assert.equal(capped.push, false);
  assert.equal(capped.reason, 'daily_cap');
  assert.equal(capped.record, true);
});

test('409 alerts in a fortnight is no longer reachable', () => {
  // The actual worst case observed. At the cap it is 5 a day, 70 a
  // fortnight, and that is only for someone who keeps opening them.
  assert.ok(MAX_PUSH_PER_DAY * 14 < 409);
});

// ── taking the hint ────────────────────────────────────────────────────

test('we stop pushing someone who has stopped reading', () => {
  // 409 alerts and zero opens is the app failing to notice.
  const d = decide({ unopenedStreak: UNOPENED_LIMIT });
  assert.equal(d.push, false);
  assert.equal(d.reason, 'not_reading');
  assert.equal(d.record, true, 'the matches are still there when they look');
});

test('one open resets the streak and the pushes resume', () => {
  // The caller counts CONSECUTIVE unopened, so reading one zeroes it — the
  // feature must be able to come back for someone who re-engages.
  assert.equal(decide({ unopenedStreak: UNOPENED_LIMIT - 1 }).push, true);
  assert.equal(decide({ unopenedStreak: 0 }).push, true);
});

test('silence beats noise when several limits bite at once', () => {
  const d = decide({ unopenedStreak: 99, pushesToday: 99, lastPushAt: NOW });
  assert.equal(d.push, false);
  assert.equal(d.reason, 'not_reading', 'reports the most informative reason');
});

// ── shape ──────────────────────────────────────────────────────────────

test('a missing or malformed criteria object never throws', () => {
  // criteria_json is parsed from user-writable storage.
  for (const c of [undefined, null, 'not an object', 42, []]) {
    assert.equal(decideAlert({ criteria: c }).record, false);
  }
  assert.equal(decideAlert().record, false, 'no arguments at all');
});

test('the defaults are the permissive ones', () => {
  // A caller that forgets to pass the counts must not silently mute
  // everybody; it should behave like a fresh, engaged user.
  assert.deepEqual(decideAlert({ criteria: { brand: 'Apple' }, now: NOW }),
    { record: true, push: true, reason: 'ok' });
});
