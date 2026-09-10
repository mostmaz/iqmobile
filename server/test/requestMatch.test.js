// Which open requests a freshly-posted listing answers.
//
// One rule, two callers: the push a seller gets, and the list the app shows
// them on the post-publish screen. The reason it is shared is the failure
// when it is not — a notification saying "a buyer wants this" that opens
// onto an empty screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-match-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const { requestsAnsweredBy, CEILING_SLACK } = await import('../src/requestMatch.js');
const { norm } = await import('../src/routes/savedSearches.js');

const NOW = Date.parse('2026-09-10T12:00:00+03:00');
const DAY = 86400000;

const SELLER = 1;
const BUYER = 2;
for (const [id, gov] of [[SELLER, 'Baghdad'], [BUYER, 'Baghdad']]) {
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
              VALUES(?, ?, 'x', ?, ?, ?)`).run(id, `077000000${id}`, `u${id}`, gov, NOW);
}

// One table, many tests. Without a reset each test inherits the previous
// one's requests and every "exactly these ids" assertion drifts — which is
// how the first run of this file failed.
test.beforeEach(() => { db.prepare('DELETE FROM phone_requests').run(); });

let rid = 0;
function request({ brand = 'Apple', model = 'iPhone 13', max = 600000,
  gov = 'Baghdad', buyer = BUYER, status = 'open', expires = NOW + 7 * DAY } = {}) {
  const id = ++rid;
  db.prepare(`INSERT INTO phone_requests
    (id, buyer_id, brand, model, max_price, governorate, status, offer_count, created_at, expires_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, buyer, brand, model, max, gov, status, NOW - id, expires);
  return id;
}

const listing = (o = {}) => ({
  id: 900, seller_id: SELLER, brand: 'Apple', model: 'iPhone 13',
  asking_price: 500000, governorate: 'Baghdad', status: 'active', is_draft: 0, ...o,
});

const match = (l, opts) => requestsAnsweredBy(db, l, norm, { now: NOW, ...opts }).map((r) => r.id);

test('a request under the ceiling, same phone, is answered', () => {
  const id = request();
  assert.deepEqual(match(listing()), [id]);
});

test('a different model is not a match, however close the name', () => {
  // "iPhone 13 Pro Max" costs about twice what "iPhone 13" does. Answering
  // one with the other is how a board fills with offers nobody wanted.
  request({ model: 'iPhone 13 Pro Max' });
  const only = request({ model: 'iPhone 13' });
  assert.deepEqual(match(listing()), [only]);
});

test('orthography and spacing fold together', () => {
  // The same fold saved searches and /top-models use: case, spaces, and
  // Arabic-Indic digits all collapse.
  const id = request({ model: 'ايفون ١٣' });
  assert.deepEqual(match(listing({ model: 'أيفون13' })), [id]);
});

test('KNOWN GAP: the two scripts do not fold into each other', () => {
  // norm('iPhone 13') is "iphone13" and norm('ايفون ١٣') is "ايفون13", so a
  // buyer who wrote the model in Arabic is never matched with a seller who
  // wrote it in Latin. This is pinned as a fact, not endorsed: the same gap
  // exists in saved searches and the wishlist, because they share this
  // normalizer, and closing it is a transliteration table rather than a
  // change to this module. The test exists so that whoever adds one sees
  // this line go red and knows to delete it.
  request({ model: 'ايفون ١٣' });
  assert.deepEqual(match(listing({ model: 'iPhone 13' })), []);
});

test('a price a little over the ceiling still matches, and says so', () => {
  // A stated budget is an opening position, not a wall. What must not
  // happen is presenting it as a clean match.
  const id = request({ max: 500000 });
  const rows = requestsAnsweredBy(db, listing({ asking_price: 560000 }), norm, { now: NOW });
  assert.deepEqual(rows.map((r) => r.id), [id]);
  assert.equal(rows[0].above_budget, true);
  assert.ok(560000 <= 500000 * CEILING_SLACK, 'inside the slack, by construction');
});

test('a price far over the ceiling is not a match at all', () => {
  request({ max: 500000 });
  assert.deepEqual(match(listing({ asking_price: 900000 })), []);
});

test('closed and expired requests are never answered', () => {
  request({ status: 'fulfilled' });
  request({ expires: NOW - DAY });
  assert.deepEqual(match(listing()), []);
});

test('a seller is never shown their own request', () => {
  request({ buyer: SELLER });
  assert.deepEqual(match(listing()), []);
});

test('a call-for-price listing matches nothing', () => {
  // asking_price = 1 is the sentinel. Compared against a ceiling it
  // satisfies every request ever written, which would hand the seller the
  // entire board as "matches".
  request({ max: 600000 });
  assert.deepEqual(match(listing({ asking_price: 1 })), []);
});

test('a draft or inactive listing answers nothing', () => {
  request();
  assert.deepEqual(match(listing({ is_draft: 1 })), []);
  assert.deepEqual(match(listing({ status: 'sold' })), []);
});

test('the governorate filter is opt-in, and it is what the screen uses', () => {
  // The push takes every match — a notification costs the buyer nothing.
  // The post-publish screen takes only the ones the seller could meet.
  const near = request({ gov: 'Baghdad' });
  const far = request({ gov: 'Basra' });
  assert.deepEqual(match(listing()).sort(), [near, far].sort());
  assert.deepEqual(match(listing(), { sameGovernorateOnly: true }), [near]);
});

test('newest first, and the limit is respected', () => {
  // The fixture stamps created_at = NOW - id, so the FIRST request made is
  // the newest. A seller reading a capped list should see the freshest
  // demand, not whatever happens to sort first.
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(request());
  const got = match(listing(), { limit: 3 });
  assert.deepEqual(got, ids.slice(0, 3));
});
