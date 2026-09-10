// The feed's quick sorts — «الأحدث · أعلى ميزانية · بدون عروض».
//
// An HTTP test, because the whole risk is in string interpolation into an
// ORDER BY. A unit test of a lookup table would pass while the route dropped
// the clause or accepted `sort=1) --`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-boardsort-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: requestRoutes } = await import('../src/routes/phoneRequests.js');

const app = express();
app.use(express.json());
app.use('/', requestRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

const NOW = Date.now();
const HOUR = 3600000;

db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
            VALUES(1, '07700000001', 'x', 'Buyer', 'Baghdad', ?)`).run(NOW);

let rid = 0;
function request({ max = 500000, offers = 0, ageHours = 1 }) {
  const id = ++rid;
  db.prepare(`INSERT INTO phone_requests
    (id, buyer_id, brand, model, max_price, governorate, status, offer_count, created_at, expires_at)
    VALUES(?, 1, 'Apple', 'iPhone 13', ?, 'Baghdad', 'open', ?, ?, ?)`)
    .run(id, max, offers, NOW - ageHours * HOUR, NOW + 7 * 24 * HOUR);
  return id;
}

//         id  budget    offers  age
const OLD_RICH  = request({ max: 900000, offers: 5, ageHours: 10 });
const NEW_POOR  = request({ max: 300000, offers: 2, ageHours: 1 });
const MID_QUIET = request({ max: 600000, offers: 0, ageHours: 5 });

const ids = async (q) => {
  const res = await fetch(`${BASE}/phone-requests${q}`);
  assert.equal(res.status, 200);
  return (await res.json()).map((r) => r.id);
};

test('the default order is newest first, as it always was', async () => {
  assert.deepEqual(await ids(''), [NEW_POOR, MID_QUIET, OLD_RICH]);
});

test('«أعلى ميزانية» sorts by the money', async () => {
  assert.deepEqual(await ids('?sort=budget'), [OLD_RICH, MID_QUIET, NEW_POOR]);
});

test('«بدون عروض» surfaces the unanswered ones first', async () => {
  // The point of this view: a request with five offers is a bidding war a
  // shop probably loses, and one with none is a reply that wins outright.
  assert.deepEqual(await ids('?sort=no_offers'), [MID_QUIET, NEW_POOR, OLD_RICH]);
});

test('every sort keeps recency as the tiebreak', async () => {
  // Without it a stale request with a big budget owns the top of «أعلى
  // ميزانية» until it expires. Two equal budgets, newest wins.
  const older = request({ max: 900000, offers: 5, ageHours: 20 });
  const order = await ids('?sort=budget');
  assert.ok(order.indexOf(OLD_RICH) < order.indexOf(older));
  db.prepare('DELETE FROM phone_requests WHERE id=?').run(older);
});

test('an unknown sort falls back to newest rather than erroring', async () => {
  // The board is the seller-facing screen; a 400 from a stale client would
  // empty it. Same rule /listings applies to an unknown condition.
  assert.deepEqual(await ids('?sort=whatever'), [NEW_POOR, MID_QUIET, OLD_RICH]);
});

test('a sort value cannot reach the SQL', async () => {
  const injected = encodeURIComponent('created_at DESC LIMIT 1) UNION SELECT * FROM users --');
  assert.deepEqual(await ids(`?sort=${injected}`), [NEW_POOR, MID_QUIET, OLD_RICH]);
});

test.after(() => server.close());
