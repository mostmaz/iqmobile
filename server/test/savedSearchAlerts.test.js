// The saved-search alert path, against a real database.
//
// savedSearchThrottle.test.js pins the RULE; this pins the WIRING, which is
// where this particular change could fail silently. alertOnNewListing wraps
// its whole body in try/catch and only console.errors, so a mistyped column
// in the throttle's state query would stop every saved-search alert in
// production and look exactly like "nobody matched".
//
// It is also the first test of this function at all — it was previously
// uncovered, which is how a 14,055-alert fanout went unnoticed for a while.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-ssalert-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const { alertOnNewListing } = await import('../src/routes/savedSearches.js');
const { MAX_PUSH_PER_DAY, UNOPENED_LIMIT } = await import('../src/savedSearchThrottle.js');

const NOW = Date.now();
const DAY = 86400000;

let uid = 200;
function user() {
  const id = uid++;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
              VALUES(?, ?, 'x', ?, 'Baghdad', ?)`).run(id, `07711${String(id).padStart(5, '0')}`, `u${id}`, NOW);
  return id;
}
const SELLER = user();

let sid = 0;
function search(userId, criteria) {
  const id = ++sid;
  db.prepare(`INSERT INTO saved_searches(id, user_id, criteria_json, alerts_enabled, created_at)
              VALUES(?, ?, ?, 1, ?)`).run(id, userId, JSON.stringify(criteria), NOW);
  return id;
}

let lid = 3000;
function listing({ brand = 'Apple', model = 'iPhone 13', price = 500000 } = {}) {
  const id = lid++;
  db.prepare(`INSERT INTO phone_listings
    (id, seller_id, brand, model, condition, asking_price, governorate, status,
     created_at, updated_at, expires_at)
    VALUES(?, ?, ?, ?, 'used', ?, 'Baghdad', 'active', ?, ?, ?)`)
    .run(id, SELLER, brand, model, price, NOW, NOW, NOW + 30 * DAY);
  return db.prepare('SELECT * FROM phone_listings WHERE id=?').get(id);
}

const rowsFor = (u) => db.prepare(
  `SELECT * FROM notifications WHERE user_id=? AND kind='saved_search.match' ORDER BY id`).all(u);

test.beforeEach(() => {
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM saved_searches').run();
  db.prepare('DELETE FROM phone_listings').run();
  db.prepare('DELETE FROM users WHERE id <> ?').run(SELLER);
  sid = 0;
});

test('a matching search is alerted, and the alert is a push', () => {
  // The happy path — and proof the throttle's state query actually runs.
  // Before this test existed, a bad column name here was invisible.
  const u = user();
  search(u, { brand: 'Apple' });
  alertOnNewListing(listing());
  const rows = rowsFor(u);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pushed, 1);
});

test('a search with no narrowing gets NOTHING, not even an inbox row', () => {
  // 124 live searches look like this. They matched every listing posted.
  const u = user();
  search(u, { governorate: 'Baghdad' });
  alertOnNewListing(listing());
  assert.equal(rowsFor(u).length, 0);
});

test('the seller is never alerted about their own listing', () => {
  search(SELLER, { brand: 'Apple' });
  alertOnNewListing(listing());
  assert.equal(rowsFor(SELLER).length, 0);
});

test('a non-matching search stays quiet', () => {
  const u = user();
  search(u, { brand: 'Samsung' });
  alertOnNewListing(listing({ brand: 'Apple' }));
  assert.equal(rowsFor(u).length, 0);
});

test('several searches of the same person produce ONE alert per listing', () => {
  // The per-user guard that already existed; kept under test because the
  // throttle now shares state across those same searches.
  const u = user();
  search(u, { brand: 'Apple' });
  search(u, { model: 'iPhone 13' });
  search(u, { q: 'ايفون' });
  alertOnNewListing(listing());
  assert.equal(rowsFor(u).length, 1);
});

test('the daily cap holds across many listings, and the inbox keeps filling', () => {
  // The heart of it: past the cap the person stops being interrupted but
  // the matches are still there when they go looking.
  const u = user();
  search(u, { brand: 'Apple' });
  for (let i = 0; i < MAX_PUSH_PER_DAY + 4; i++) alertOnNewListing(listing({ price: 400000 + i }));
  const rows = rowsFor(u);
  const pushed = rows.filter((r) => r.pushed).length;
  assert.ok(rows.length > MAX_PUSH_PER_DAY, 'every match is still recorded');
  assert.ok(pushed <= MAX_PUSH_PER_DAY, `pushed ${pushed}, cap ${MAX_PUSH_PER_DAY}`);
});

test('someone who never opens them stops being pushed', () => {
  // Seed a run of unread alerts, as the four worst-hit users have.
  const u = user();
  search(u, { brand: 'Apple' });
  // Dated DAYS back on purpose: today's push count is a different limit, and
  // seeding them as recent would make this test pass for the wrong reason.
  const ins = db.prepare(`INSERT INTO notifications(user_id, kind, payload_json, read, pushed, created_at)
                          VALUES(?, 'saved_search.match', '{}', 0, 1, ?)`);
  for (let i = 0; i < UNOPENED_LIMIT; i++) ins.run(u, NOW - (i + 2) * DAY);
  alertOnNewListing(listing());
  const latest = rowsFor(u).at(-1);
  assert.equal(latest.pushed, 0, 'recorded but not an interruption');
});

test('reading one brings the pushes back', () => {
  const u = user();
  search(u, { brand: 'Apple' });
  const ins = db.prepare(`INSERT INTO notifications(user_id, kind, payload_json, read, pushed, created_at)
                          VALUES(?, 'saved_search.match', '{}', ?, 1, ?)`);
  for (let i = 0; i < UNOPENED_LIMIT; i++) ins.run(u, 0, NOW - (i + 3) * DAY);
  ins.run(u, 1, NOW - 2 * DAY);   // …then they opened the most recent one
  alertOnNewListing(listing());
  assert.equal(rowsFor(u).at(-1).pushed, 1);
});

test('a corrupt criteria_json is skipped, not thrown', () => {
  // The column is written from user input and parsed back with JSON.parse.
  const u = user();
  db.prepare(`INSERT INTO saved_searches(user_id, criteria_json, alerts_enabled, created_at)
              VALUES(?, '{not json', 1, ?)`).run(u, NOW);
  const ok = user();
  search(ok, { brand: 'Apple' });
  alertOnNewListing(listing());
  assert.equal(rowsFor(u).length, 0);
  assert.equal(rowsFor(ok).length, 1, 'one bad row does not stop the rest');
});

test('a draft or inactive listing alerts nobody', () => {
  const u = user();
  search(u, { brand: 'Apple' });
  const l = listing();
  alertOnNewListing({ ...l, status: 'sold' });
  assert.equal(rowsFor(u).length, 0);
});
