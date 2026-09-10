// The one number the request feature shows about itself.
//
// Worth its own file because three surfaces read it — a tab badge, a feed
// subtitle and an invite card — and the failure mode is not a crash but a
// quiet disagreement: a badge saying 18 over a feed listing 12. Every test
// here is really "do these two numbers stay reconcilable".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-pulse-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const { requestPulse, PULSE_WINDOW_MS } = await import('../src/requestPulse.js');

const NOW = Date.parse('2026-09-10T12:00:00+03:00');
const HOUR = 3600000;

// A plain INSERT, never INSERT OR IGNORE: a swallowed NOT NULL failure here
// surfaces later as a foreign-key error on the requests, three steps away.
db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
            VALUES(1, '07700000001', 'x', 'Buyer', 'Baghdad', ?)`).run(NOW);

let uid = 10;
function shop({ gov = 'Baghdad', extra = {} } = {}) {
  const id = uid++;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
              VALUES(?, ?, 'x', ?, ?, 'shop', ?)`)
    .run(id, `0770001${String(id).padStart(4, '0')}`, `s${id}`, gov, NOW);
  for (const [k, v] of Object.entries(extra)) db.prepare(`UPDATE users SET ${k}=? WHERE id=?`).run(v, id);
  return id;
}

let rid = 0;
function request({ gov = 'Baghdad', ageHours = 1, expiresIn = 7 * 24 * HOUR, status = 'open' } = {}) {
  const id = ++rid;
  db.prepare(`INSERT INTO phone_requests
    (id, buyer_id, brand, model, max_price, governorate, status, offer_count, created_at, expires_at)
    VALUES(?, 1, 'Apple', 'iPhone 13', 600000, ?, ?, 0, ?, ?)`)
    .run(id, gov, status, NOW - ageHours * HOUR, NOW + expiresIn);
  return id;
}

// Every test builds its own board.
test.beforeEach(() => {
  db.prepare('DELETE FROM phone_requests').run();
  db.prepare("DELETE FROM users WHERE id > 1").run();
});

const pulse = (o = {}) => requestPulse(db, { governorate: 'Baghdad', now: NOW, ...o });

test('counts only the last 24 hours', () => {
  request({ ageHours: 1 });
  request({ ageHours: 23 });
  request({ ageHours: 25 });
  assert.equal(pulse().count_24h, 2);
});

test('counts only your governorate', () => {
  request({ gov: 'Baghdad' });
  request({ gov: 'Basra' });
  assert.equal(pulse().count_24h, 1);
  assert.equal(pulse({ governorate: null }).count_24h, 2, 'no governorate is the whole country');
});

test('an expired window is not counted, even while the row still says open', () => {
  // expireStale is a lazy sweep, so 'open' is not proof the feed will show
  // it. Counting the row anyway is a badge for something that is not there.
  request({ ageHours: 1, expiresIn: -HOUR });
  assert.equal(pulse().count_24h, 0);
});

test('closed requests are not counted', () => {
  request({ status: 'fulfilled' });
  assert.equal(pulse().count_24h, 0);
});

test('the badge counts only what you have not seen', () => {
  request({ ageHours: 6 });
  request({ ageHours: 2 });
  const seenAt = NOW - 4 * HOUR;
  const p = pulse({ since: seenAt });
  assert.equal(p.count_24h, 2, 'the headline is still the full day');
  assert.equal(p.count_new, 1, 'the badge is only what arrived since');
});

test('the badge never promises more than the headline', () => {
  // since=0 is what a client that has never opened the feed sends. Without
  // the clamp into the window, count_new would count requests older than the
  // 24 hours the subtitle is describing.
  request({ ageHours: 30 });
  request({ ageHours: 2 });
  const p = pulse({ since: 0 });
  assert.equal(p.count_24h, 1);
  assert.equal(p.count_new, 1);
  assert.ok(p.count_new <= p.count_24h);
});

test('a future `since` is not a negative badge', () => {
  request({ ageHours: 2 });
  assert.equal(pulse({ since: NOW + HOUR }).count_new, 0);
});

test('the window constant is the day the copy claims', () => {
  // «بآخر ٢٤ ساعة» is printed next to this number.
  assert.equal(PULSE_WINDOW_MS, 24 * HOUR);
});

// ── seller_reach ───────────────────────────────────────────────────────

test('reach counts the shops in your governorate', () => {
  shop(); shop();
  shop({ gov: 'Basra' });
  assert.equal(pulse().seller_reach, 2);
});

test('reach excludes the shops that answer nobody', () => {
  // The same four guards sellersToBroadcast applies. A number that counts
  // them is a promise the broadcast will not keep.
  shop();
  shop({ extra: { shop_hidden: 1 } });
  shop({ extra: { shop_status: 'pending' } });
  shop({ extra: { shop_no_contact: 1 } });
  shop({ extra: { shop_origin: 'admin' } });
  assert.equal(pulse().seller_reach, 1);
});

test('reach never exceeds the broadcast cap', () => {
  // Saying «١٢٤ تاجر» when the push stops at 40 is exactly the copy problem
  // HowFeaturingWorks.tsx documents an apology for.
  for (let i = 0; i < 6; i++) shop();
  assert.equal(pulse({ maxReach: 4 }).seller_reach, 4);
});

test('with no governorate there is no honest reach to quote', () => {
  shop();
  assert.equal(pulse({ governorate: null }).seller_reach, 0);
});

test('an individual is not counted as a shop, however much they sell', () => {
  // Individuals reach the broadcast by having sold the BRAND, which is not
  // chosen yet when this number is shown. Counting them would be a guess.
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
              VALUES(99, '07700009999', 'x', 'Person', 'Baghdad', 'individual', ?)`).run(NOW);
  assert.equal(pulse().seller_reach, 0);
});
