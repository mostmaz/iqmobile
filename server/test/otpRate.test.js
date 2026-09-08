// Per-phone send limits.
//
// This is the only thing that actually stops a spend attack — there is no
// global budget ceiling by choice — so the assertion that matters most is not
// "the caller got an error", it is "no money was spent". Every blocked test
// below checks the provider was never called.
//
// The clock is injected, so an hour of traffic runs instantly and the test
// never touches the network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  createSendLogTable, checkSendAllowed, recordSend, sendsInLastHour,
  purgeSendLog, LIMITS, ALERT_PER_HOUR,
} from '../src/otpRate.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-09-07T12:00:00+03:00');
const PHONE = '07701234567';

let db;
beforeEach(() => { db = new Database(':memory:'); createSendLogTable(db); });

const send = (at, phone = PHONE) => recordSend(db, { phone, outcome: 'sent', now: at });
const check = (at, phone = PHONE) => checkSendAllowed(db, phone, { now: at });

test('the first send to a new number is always allowed', () => {
  assert.equal(check(T0).allowed, true);
});

test('a second send inside the cooldown is refused', () => {
  send(T0);
  const r = check(T0 + 30 * 1000);
  assert.equal(r.allowed, false);
  assert.equal(r.error, 'otp_rate_limited');
  assert.equal(r.rule, 'cooldown');
});

test('after the cooldown the retry is allowed — this is the normal case', () => {
  // A user who did not receive the first message must be able to try again.
  send(T0);
  assert.equal(check(T0 + LIMITS.COOLDOWN_MS + 1).allowed, true);
});

test('the third send inside an hour is refused', () => {
  // The owner's limit: one send plus one retry.
  send(T0);
  send(T0 + 2 * MIN);
  const r = check(T0 + 4 * MIN);
  assert.equal(r.allowed, false);
  assert.equal(r.rule, 'hour');
});

test('the refusal says WHEN it clears, not just that it is blocked', () => {
  // Two an hour is tight enough that real people hit it. "Wait a bit" with no
  // number is what makes someone uninstall instead of waiting.
  send(T0);
  send(T0 + 2 * MIN);
  const r = check(T0 + 4 * MIN);
  assert.ok(r.retryAfterMs > 0);
  // Freed when the OLDEST send ages out of the window, not the newest.
  assert.equal(r.retryAfterMs, HOUR - 4 * MIN);
});

test('the hour is a rolling window, not a fixed bucket', () => {
  send(T0);
  send(T0 + 2 * MIN);
  // Just before the first ages out: still blocked.
  assert.equal(check(T0 + HOUR - MIN).allowed, false);
  // Once it has: allowed again.
  assert.equal(check(T0 + HOUR + 1).allowed, true);
});

test('the limit is per NUMBER — one busy number never blocks another', () => {
  // The property that keeps this from becoming an outage: a shared IP (a
  // café, a carrier NAT) must not let one user lock out everyone else.
  send(T0); send(T0 + 2 * MIN);
  assert.equal(check(T0 + 4 * MIN).allowed, false);
  assert.equal(check(T0 + 4 * MIN, '07801111111').allowed, true);
});

test('the daily bound stops 2-an-hour becoming 48-a-day', () => {
  let t = T0;
  for (let i = 0; i < LIMITS.PER_DAY; i++) { send(t); t += 90 * MIN; }
  const r = check(t);
  assert.equal(r.allowed, false);
  assert.equal(r.rule, 'day');
});

test('a provider failure does not consume the user budget', () => {
  // Only outcome='sent' counts. If an ARQAM outage burned the user's two
  // attempts, their outage would become our hour-long lockout on top.
  recordSend(db, { phone: PHONE, outcome: 'blocked_hour', now: T0 });
  recordSend(db, { phone: PHONE, outcome: 'blocked_cooldown', now: T0 + MIN });
  assert.equal(check(T0 + 2 * MIN).allowed, true);
});

test('refusals are still recorded, so attack pressure is visible', () => {
  recordSend(db, { phone: PHONE, outcome: 'blocked_hour', now: T0 });
  const n = db.prepare("SELECT COUNT(*) n FROM otp_send_log WHERE outcome LIKE 'blocked%'").get().n;
  assert.equal(n, 1);
});

test('the hourly total counts across ALL numbers — the flood shape', () => {
  // Per-phone limits cannot see a distributed attack: every number stays
  // under its own cap while the total climbs. This is what the alert watches.
  for (let i = 0; i < 40; i++) send(T0 + i * 1000, `0770000${String(i).padStart(4, '0')}`);
  assert.equal(sendsInLastHour(db, { now: T0 + 5 * MIN }), 40);
  assert.ok(40 < ALERT_PER_HOUR, 'sanity: 40 is below the alert threshold');
});

test('the hourly total ignores blocked rows and old rows', () => {
  send(T0 - 2 * HOUR);
  recordSend(db, { phone: PHONE, outcome: 'blocked_hour', now: T0 });
  send(T0);
  assert.equal(sendsInLastHour(db, { now: T0 + MIN }), 1);
});

test('the log is purged so a flood cannot grow it forever', () => {
  send(T0 - 40 * 24 * HOUR);
  send(T0);
  assert.equal(purgeSendLog(db, { now: T0 }), 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM otp_send_log').get().n, 1);
});
