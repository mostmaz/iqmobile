import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boostUiState, boostPillLabel, boostSlots, clockCountdown, longCountdownAr, arDigits,
  type BoostServerState,
} from '../src/lib/boostState.ts';

const NOW = Date.parse('2026-09-10T12:00:00+03:00');
const HOUR = 3600000;

const base: BoostServerState = {
  enabled: true, max_per_24h: 2, used: 0, remaining: 2, allowed: true, reason: null,
  next_available_at: null, streak: 0, streak_used_today: false,
  day_ends_at: NOW + 9 * HOUR, eligible: true, ineligible_reason: null, listing: null,
};

test('a server that has never heard of boosts renders nothing', () => {
  // An old build talking to a new server, or a new build talking to an old
  // one. Both must show no boost UI at all rather than an empty card.
  assert.deepEqual(boostUiState(null, NOW), { kind: 'hidden' });
  assert.deepEqual(boostUiState(undefined, NOW), { kind: 'hidden' });
  assert.deepEqual(boostUiState({ ...base, enabled: false }, NOW), { kind: 'hidden' });
});

test('a sold listing is told why, not hidden', () => {
  // Distinct from `hidden`: this listing COULD be boosted if it were still
  // for sale, and a seller who marked it sold mid-flow deserves the reason.
  const s = boostUiState({ ...base, eligible: false, ineligible_reason: 'listing_not_active' }, NOW);
  assert.equal(s.kind, 'ineligible');
});

test('two left and nothing pending is the plain available state', () => {
  assert.deepEqual(boostUiState(base, NOW), { kind: 'available', remaining: 2 });
});

test('one used, still inside the gap, counts down without claiming to be spent', () => {
  const s = boostUiState(
    { ...base, used: 1, remaining: 1, allowed: false, reason: 'cooldown', next_available_at: NOW + 3 * HOUR },
    NOW,
  );
  assert.equal(s.kind, 'cooldown');
  assert.equal(s.kind === 'cooldown' && s.remaining, 1, 'the boost exists, it is just not yet');
  assert.equal(s.kind === 'cooldown' && s.msLeft, 3 * HOUR);
});

test('both used is exhausted, and counts to the window not the gap', () => {
  const s = boostUiState(
    { ...base, used: 2, remaining: 0, allowed: false, reason: 'daily_limit', next_available_at: NOW + 19 * HOUR },
    NOW,
  );
  assert.equal(s.kind, 'exhausted');
  assert.equal(s.kind === 'exhausted' && s.msLeft, 19 * HOUR);
});

test('a countdown that has run out becomes available, not a frozen zero', () => {
  // Between polls the clock is all the screen has. Sitting on «بعد ٠د ٠ث»
  // until the next fetch looks broken.
  const s = boostUiState(
    { ...base, used: 1, remaining: 1, allowed: false, reason: 'cooldown', next_available_at: NOW - 1 },
    NOW,
  );
  assert.deepEqual(s, { kind: 'available', remaining: 1 });
});

test('the pill says what is left, or how long until it is', () => {
  assert.equal(boostPillLabel({ kind: 'available', remaining: 2 }), '٢ متبقية اليوم');
  assert.ok(boostPillLabel({ kind: 'exhausted', msLeft: 7 * HOUR + 12 * 60000 }).includes('ترجع بعد'));
  assert.equal(boostPillLabel({ kind: 'hidden' }), '');
});

test('Arabic-Indic digits for counts inside Arabic copy', () => {
  assert.equal(arDigits(0), '٠');
  assert.equal(arDigits(2), '٢');
  assert.equal(arDigits(12), '١٢');
});

test('the long countdown reads as a sentence, with Latin digits', () => {
  // Two numeral systems on purpose, and the design uses both: a COUNT inside
  // Arabic copy is Arabic-Indic («٢ متبقية»), a ticking DURATION is Latin
  // («7:12 ساعة»). The Latin ones are wrapped in Left-to-Right Marks so iOS
  // does not render them as Arabic-Indic glyphs where they touch a letter.
  const out = longCountdownAr(3 * HOUR + 27 * 60000);
  assert.equal(out.replace(/\u200e/g, ''), '3 ساعة و27 دقيقة');
  assert.ok(out.includes('\u200e'), 'digits are LRM-wrapped');
  assert.equal(longCountdownAr(45 * 60000).includes('دقيقة'), true);
  assert.equal(longCountdownAr(30 * 1000), 'أقل من دقيقة', 'never "0 minutes"');
  assert.equal(longCountdownAr(-5), 'أقل من دقيقة', 'never negative');
});

test('the clock readout is zero-padded and never runs backwards', () => {
  assert.equal(clockCountdown(7 * HOUR + 12 * 60000 + 44 * 1000), '07:12:44');
  assert.equal(clockCountdown(0), '00:00:00');
  assert.equal(clockCountdown(-1000), '00:00:00');
});

test('slots mirror the server max, not a hardcoded two', () => {
  assert.deepEqual(boostSlots({ ...base, max_per_24h: 2, used: 0 }), [false, false]);
  assert.deepEqual(boostSlots({ ...base, max_per_24h: 2, used: 1 }), [true, false]);
  assert.deepEqual(boostSlots({ ...base, max_per_24h: 3, used: 3 }), [true, true, true]);
  assert.deepEqual(boostSlots(null), [false, false], 'a sane default when the server said nothing');
});
