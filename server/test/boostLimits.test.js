import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { boostAllowance, boostConfig, boostStreak, baghdadDay, BOOST_DEFAULTS } from '../src/boostLimits.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
// A fixed clock. Every assertion below is about a boundary, and a boundary
// tested against Date.now() is a test that passes at 09:00 and fails at 23:59.
const NOW = Date.parse('2026-09-10T12:00:00+03:00');
const USER = 1;

const CFG = { ...BOOST_DEFAULTS, enabled: true };

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE listing_boosts(
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, listing_id INTEGER,
    nonce TEXT, ad_transaction_id TEXT, status TEXT, boost_type TEXT,
    rank_at_request INTEGER, requested_at INTEGER, reward_earned_at INTEGER,
    granted_at INTEGER, failure_reason TEXT)`);
  const grant = (at, o = {}) =>
    db.prepare(
      `INSERT INTO listing_boosts(user_id, listing_id, nonce, status, requested_at, granted_at)
       VALUES(@user_id,@listing_id,@nonce,@status,@at,@at)`,
    ).run({ user_id: USER, listing_id: 10, nonce: String(Math.random()), status: 'boosted', at, ...o });
  return { db, grant };
}

test('a seller with no history may boost', () => {
  const { db } = fixture();
  const a = boostAllowance(db, USER, CFG, NOW);
  assert.equal(a.allowed, true);
  assert.equal(a.used, 0);
  assert.equal(a.remaining, 2);
  assert.equal(a.nextAvailableAt, null, 'nothing to count down to');
});

test('the four-hour gap blocks a second boost', () => {
  const { db, grant } = fixture();
  grant(NOW - 1 * HOUR);
  const a = boostAllowance(db, USER, CFG, NOW);
  assert.equal(a.allowed, false);
  assert.equal(a.reason, 'cooldown');
  assert.equal(a.remaining, 1, 'the boost is available, just not yet');
  assert.equal(a.nextAvailableAt, NOW - 1 * HOUR + 4 * HOUR);
});

test('two boosts exhaust the day, and the countdown is to the WINDOW, not the gap', () => {
  // The bug this guards: reporting the 4-hour cooldown to a seller who has
  // used both boosts tells them to come back in four hours, which is false.
  const { db, grant } = fixture();
  const first = NOW - 20 * HOUR;
  grant(first);
  grant(NOW - 5 * HOUR);
  const a = boostAllowance(db, USER, CFG, NOW);
  assert.equal(a.allowed, false);
  assert.equal(a.reason, 'daily_limit');
  assert.equal(a.remaining, 0);
  assert.equal(a.nextAvailableAt, first + DAY, 'when the oldest falls out of the window');
});

test('the window rolls — it does not reset at midnight', () => {
  const { db, grant } = fixture();
  grant(NOW - 24 * HOUR - 1);   // one millisecond too old to count
  grant(NOW - 23 * HOUR);
  const a = boostAllowance(db, USER, CFG, NOW);
  assert.equal(a.used, 1, 'the older grant has aged out');
  assert.equal(a.remaining, 1);
  assert.equal(a.allowed, true, 'and the 4h gap is long past');
});

test('only grants that landed count against the allowance', () => {
  // A seller who opened an ad and closed it early must not be charged.
  const { db, grant } = fixture();
  grant(NOW - HOUR, { status: 'pending' });
  grant(NOW - HOUR, { status: 'failed' });
  const a = boostAllowance(db, USER, CFG, NOW);
  assert.equal(a.used, 0);
  assert.equal(a.allowed, true);
});

test('a scheduled boost counts — the reward was delivered', () => {
  const { db, grant } = fixture();
  grant(NOW - 5 * HOUR, { status: 'scheduled' });
  assert.equal(boostAllowance(db, USER, CFG, NOW).used, 1);
});

test('the feature switch beats every other answer', () => {
  const { db } = fixture();
  const a = boostAllowance(db, USER, { ...CFG, enabled: false }, NOW);
  assert.equal(a.allowed, false);
  assert.equal(a.reason, 'disabled');
});

test('boostConfig falls back to the defaults when nothing is set', () => {
  const c = boostConfig(() => undefined);
  assert.equal(c.enabled, false, 'off unless an operator says otherwise');
  assert.equal(c.maxPer24h, 2);
  assert.equal(c.minIntervalHours, 4);
  assert.equal(c.topThreshold, 20);
  assert.equal(c.adUnitAndroid, '', 'empty means use the test unit');
});

// ─── streaks ─────────────────────────────────────────────────────────

test('Baghdad days, not UTC ones', () => {
  // 23:30 UTC on the 9th is already the 10th in Baghdad (UTC+3).
  assert.equal(baghdadDay(Date.parse('2026-09-09T23:30:00Z')), baghdadDay(Date.parse('2026-09-10T09:00:00Z')));
  assert.notEqual(baghdadDay(Date.parse('2026-09-09T20:30:00Z')), baghdadDay(Date.parse('2026-09-10T09:00:00Z')));
});

test('consecutive days count once each, however many boosts fell in them', () => {
  const { db, grant } = fixture();
  grant(NOW);                 // today, twice
  grant(NOW - 2 * HOUR);
  grant(NOW - 1 * DAY);
  grant(NOW - 2 * DAY);
  const s = boostStreak(db, USER, NOW);
  assert.equal(s.streak, 3);
  assert.equal(s.usedToday, true);
});

test('a streak survives a today with nothing in it yet', () => {
  // Telling someone at 09:00 that their streak is zero, when they have
  // fourteen hours left to save it, is both wrong and the fastest way to
  // make them stop caring.
  const { db, grant } = fixture();
  grant(NOW - 1 * DAY);
  grant(NOW - 2 * DAY);
  const s = boostStreak(db, USER, NOW);
  assert.equal(s.streak, 2);
  assert.equal(s.usedToday, false);
});

test('a whole missed day breaks it', () => {
  const { db, grant } = fixture();
  grant(NOW - 2 * DAY);
  grant(NOW - 3 * DAY);
  assert.equal(boostStreak(db, USER, NOW).streak, 0);
});

test('dayEndsAt is the next Baghdad midnight', () => {
  const s = boostStreak(fixture().db, USER, NOW);
  assert.equal(new Date(s.dayEndsAt).toISOString(), '2026-09-10T21:00:00.000Z', 'midnight Baghdad = 21:00Z');
  assert.ok(s.dayEndsAt > NOW);
});
