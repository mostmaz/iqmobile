// What a buyer is told the moment they post, and what a seller is told they
// could answer.
//
// Three numbers that all come off the same matcher and must not drift from
// it: the local/elsewhere split behind «توسيع البحث لكل العراق؟», the
// low-budget warning, and the seller's «لديك X طلبات مطابقة» badge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-supply-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: routes } = await import('../src/routes/phoneRequests.js');
const { issueToken } = await import('../src/auth.js');

const app = express();
app.use(express.json());
app.use('/', routes);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const NOW = Date.now();
const DAY = 86400000;

let uid = 900;
function user(gov = 'Baghdad') {
  const id = uid++;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, is_guest, created_at)
              VALUES(?,?, 'x', ?, ?, 0, ?)`).run(id, `07755${String(id).padStart(5, '0')}`, `u${id}`, gov, NOW);
  return id;
}
const token = (id) => issueToken({ id });

let lid = 9000;
function listing(sellerId, { model = 'Galaxy S24', price = 500000, gov = 'Baghdad' } = {}) {
  const id = lid++;
  db.prepare(`INSERT INTO phone_listings
    (id, seller_id, brand, model, condition, asking_price, governorate, status,
     created_at, updated_at, expires_at)
    VALUES(?,?, 'Samsung', ?, 'used', ?, ?, 'active', ?, ?, ?)`)
    .run(id, sellerId, model, price, gov, NOW, NOW, NOW + 30 * DAY);
  return id;
}

const post = (body, as) => fetch(`${BASE}/phone-requests`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token(as)}` },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, data: await r.json() }));

const REQ = { brand: 'Samsung', model: 'Galaxy S24', governorate: 'Baghdad' };

test.beforeEach(() => {
  db.prepare('DELETE FROM request_notifications').run();
  db.prepare('DELETE FROM request_offers').run();
  db.prepare('DELETE FROM phone_requests').run();
  db.prepare('DELETE FROM phone_listings').run();
  db.prepare('DELETE FROM notifications').run();
});

// ── item 5: the local/elsewhere split ──────────────────────────────────

test('a request with stock only in another province says so', () => {
  // The case the widening prompt exists for. Without the split this looks
  // identical to a request nothing can fill.
  const far = user('Basra'); listing(far, { gov: 'Basra' });
  return post({ ...REQ, max_price: 600000 }, user()).then(({ data }) => {
    assert.equal(data.supply.local, 0);
    assert.equal(data.supply.elsewhere, 1);
    assert.equal(data.supply.total, 1);
  });
});

test('local stock is counted as local', async () => {
  const near = user(); listing(near, { gov: 'Baghdad' });
  const far = user('Basra'); listing(far, { gov: 'Basra' });
  const { data } = await post({ ...REQ, max_price: 600000 }, user());
  assert.equal(data.supply.local, 1);
  assert.equal(data.supply.elsewhere, 1);
});

test('nothing anywhere is zero, not an error', async () => {
  const { data } = await post({ ...REQ, max_price: 600000 }, user());
  assert.deepEqual(data.supply, { local: 0, elsewhere: 0, total: 0 });
});

test('widening re-announces, and only to whoever has not heard', async () => {
  const far = user('Basra'); listing(far, { gov: 'Basra' });
  const buyer = user();
  const { data } = await post({ ...REQ, max_price: 600000 }, buyer);
  await new Promise((r) => setImmediate(r));
  const before = db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=?").get(far).n;

  const res = await fetch(`${BASE}/phone-requests/${data.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token(buyer)}` },
    body: JSON.stringify({ any_governorate: true }),
  });
  const widened = await res.json();
  await new Promise((r) => setImmediate(r));
  assert.equal(widened.any_governorate, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=?").get(far).n, before,
    'already told, so not told again');
});

// ── item 4: the budget warning ─────────────────────────────────────────

test('a ceiling far under the market is flagged and stored', async () => {
  // Five live requests looked like this: 50-75k for phones worth 400k+.
  for (const price of [500000, 520000, 540000, 560000]) listing(user(), { price });
  const { data } = await post({ ...REQ, max_price: 60000 }, user());
  assert.equal(data.budget.low, true);
  assert.equal(data.low_budget, true, 'stored on the row for the dashboard');
  assert.match(data.budget.message, /قد لا تصلك عروض/);
  assert.ok(data.budget.suggested_min < data.budget.suggested_max);
});

test('a sensible ceiling is not warned about', async () => {
  for (const price of [500000, 520000, 540000, 560000]) listing(user(), { price });
  const { data } = await post({ ...REQ, max_price: 600000 }, user());
  assert.equal(data.budget.low, false);
  assert.equal(data.budget.message, null);
  assert.equal(data.low_budget, false);
});

test('too few listings means no opinion, however low the budget', async () => {
  // Two listings is not a market. Warning off that would drive away the
  // buyers for thinly-stocked devices.
  listing(user(), { price: 500000 });
  const { data } = await post({ ...REQ, max_price: 1000 }, user());
  assert.equal(data.budget.low, false);
  assert.equal(data.budget.median, null);
});

// ── item 2: the seller's badge ─────────────────────────────────────────

const pulse = (as) => fetch(`${BASE}/phone-requests/pulse`, {
  headers: { authorization: `Bearer ${token(as)}` },
}).then((r) => r.json());

test('a seller holding the phone sees a count', async () => {
  const seller = user(); listing(seller, { price: 400000 });
  await post({ ...REQ, max_price: 600000 }, user());
  assert.equal((await pulse(seller)).matching_for_me, 1);
});

test('answering a request clears it from the badge', async () => {
  // A badge that keeps counting after you replied is one nobody can clear.
  const seller = user(); listing(seller, { price: 400000 });
  const { data } = await post({ ...REQ, max_price: 600000 }, user());
  assert.equal((await pulse(seller)).matching_for_me, 1);

  await fetch(`${BASE}/phone-requests/${data.id}/offers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token(seller)}` },
    body: JSON.stringify({ price: 450000 }),
  });
  assert.equal((await pulse(seller)).matching_for_me, 0);
});

test('a seller with no stock, and a signed-out visitor, see zero', async () => {
  await post({ ...REQ, max_price: 600000 }, user());
  assert.equal((await pulse(user())).matching_for_me, 0);
  const anon = await fetch(`${BASE}/phone-requests/pulse`).then((r) => r.json());
  assert.equal(anon.matching_for_me, 0);
});

test('the buyer is not offered their own request', async () => {
  const buyer = user(); listing(buyer, { price: 400000 });
  await post({ ...REQ, max_price: 600000 }, buyer);
  assert.equal((await pulse(buyer)).matching_for_me, 0);
});

test.after(() => server.close());
