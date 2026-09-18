// Who has already been told about which request.
//
// Measured on production, 18 Sep 2026: of 84 live requests with no offer, 49
// had never had a matching seller notified at all. Two bugs produced that,
// and both are pinned here:
//
//   - the reverse path (a new listing answering open requests) deduped on
//     the LISTING and `break`ed on a hit, so one already-seen request hid
//     every other request behind it, and a seller's second phone re-announced
//     a request they had already heard about;
//   - a request whose stock appeared after it was written was never
//     revisited, because the broadcast was a one-shot at create time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-ledger-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const { broadcastRequest, alertRequestsOnListing } = await import('../src/routes/phoneRequests.js');

const NOW = Date.now();
const DAY = 86400000;

let uid = 500;
function user() {
  const id = uid++;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
              VALUES(?,?, 'x', ?, 'Baghdad', ?)`).run(id, `07733${String(id).padStart(5, '0')}`, `u${id}`, NOW);
  return id;
}
const BUYER = user();

let rid = 0;
function request({ model = 'Galaxy S24', buyer = BUYER, max = 5_000_000, status = 'open' } = {}) {
  const id = ++rid;
  db.prepare(`INSERT INTO phone_requests
    (id, buyer_id, brand, model, max_price, governorate, status, offer_count, created_at, expires_at)
    VALUES(?,?, 'Samsung', ?, ?, 'Baghdad', ?, 0, ?, ?)`)
    .run(id, buyer, model, max, status, NOW, NOW + 21 * DAY);
  return db.prepare('SELECT * FROM phone_requests WHERE id=?').get(id);
}

let lid = 7000;
function listing(sellerId, model = 'Galaxy S24', { price = 300000 } = {}) {
  const id = lid++;
  db.prepare(`INSERT INTO phone_listings
    (id, seller_id, brand, model, condition, asking_price, governorate, status,
     created_at, updated_at, expires_at)
    VALUES(?,?, 'Samsung', ?, 'used', ?, 'Baghdad', 'active', ?, ?, ?)`)
    .run(id, sellerId, model, price, NOW, NOW, NOW + 30 * DAY);
  return db.prepare('SELECT * FROM phone_listings WHERE id=?').get(id);
}

const alertsTo = (u) => db.prepare(
  `SELECT * FROM notifications WHERE user_id=? AND kind='request.match' ORDER BY id`).all(u);
const ledger = (r, s) => db.prepare(
  'SELECT * FROM request_notifications WHERE request_id=? AND seller_id=?').get(r, s);

test.beforeEach(() => {
  db.prepare('DELETE FROM request_notifications').run();
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM phone_listings').run();
  db.prepare('DELETE FROM phone_requests').run();
  db.prepare('DELETE FROM users WHERE id <> ?').run(BUYER);
  rid = 0;
});

// ── 1b: the reverse path ───────────────────────────────────────────────

test('a new listing announces SEVERAL open requests, not one', () => {
  // The old cap was literally `if (++sent >= 1) break`, so a seller who
  // listed a phone five buyers wanted heard about one of them.
  const a = request(), b = request(), c = request();
  const seller = user();
  alertRequestsOnListing(listing(seller));
  assert.equal(alertsTo(seller).length, 3);
  for (const r of [a, b, c]) assert.ok(ledger(r.id, seller), `request ${r.id} recorded`);
});

test('but not ALL of them — a popular phone does not become a push storm', () => {
  for (let i = 0; i < 9; i++) request();
  const seller = user();
  alertRequestsOnListing(listing(seller));
  const n = alertsTo(seller).length;
  assert.ok(n >= 2 && n <= 3, `told about ${n}, expected a handful`);
});

test('an already-seen request no longer hides the ones behind it', () => {
  // The `break`-on-hit bug: with request #1 already known, the old code
  // stopped the whole loop and #2 was never announced.
  const first = request(), second = request();
  const seller = user();
  db.prepare(`INSERT INTO request_notifications(request_id, seller_id, source, notified_at)
              VALUES(?,?, 'broadcast', ?)`).run(first.id, seller, NOW);
  alertRequestsOnListing(listing(seller));
  const got = alertsTo(seller).map((n) => JSON.parse(n.payload_json).request_id);
  assert.deepEqual(got, [second.id]);
});

test('a second matching phone does not re-announce the same request', () => {
  const r = request();
  const seller = user();
  alertRequestsOnListing(listing(seller, 'Galaxy S24', { price: 300000 }));
  alertRequestsOnListing(listing(seller, 'Galaxy S24', { price: 280000 }));
  assert.equal(alertsTo(seller).length, 1);
  assert.equal(JSON.parse(alertsTo(seller)[0].payload_json).request_id, r.id);
});

test('a listing that answers nothing tells nobody', () => {
  request({ model: 'Galaxy S24' });
  const seller = user();
  alertRequestsOnListing(listing(seller, 'Galaxy A14'));
  assert.equal(alertsTo(seller).length, 0);
});

// ── 1c / 1d: the forward path and the ledger ───────────────────────────

test('the broadcast records everyone it told', () => {
  const r = request();
  const holder = user(); listing(holder);
  broadcastRequest(r);
  assert.equal(alertsTo(holder).length, 1);
  assert.equal(ledger(r.id, holder).source, 'broadcast');
});

test('re-broadcasting the same request rings nobody twice', () => {
  // What reopening a request used to cost: a fresh broadcast to everyone who
  // had already heard about it.
  const r = request();
  const holder = user(); listing(holder);
  broadcastRequest(r);
  broadcastRequest(r);
  broadcastRequest(r);
  assert.equal(alertsTo(holder).length, 1);
});

test('a re-broadcast DOES reach stock that arrived since', () => {
  // The point of re-broadcasting at all: 21-day request windows outlive the
  // listings that were up when they were written.
  const r = request();
  const early = user(); listing(early);
  broadcastRequest(r);
  const late = user(); listing(late);
  broadcastRequest(r);
  assert.equal(alertsTo(early).length, 1, 'not told twice');
  assert.equal(alertsTo(late).length, 1, 'told once, having just arrived');
});

test('the two paths share one ledger', () => {
  // Told by the broadcast, then posts a matching phone: no second alert.
  const r = request();
  const seller = user(); listing(seller);
  broadcastRequest(r);
  alertRequestsOnListing(listing(seller, 'Galaxy S24', { price: 250000 }));
  assert.equal(alertsTo(seller).length, 1);
});

test('the buyer is never told about their own request, by either path', () => {
  const r = request();
  broadcastRequest(r);
  alertRequestsOnListing(listing(BUYER));
  assert.equal(alertsTo(BUYER).length, 0);
});

test('deleting a request clears its ledger rows', () => {
  // ON DELETE CASCADE, so a recycled id cannot inherit someone else's
  // "already told".
  const r = request();
  const holder = user(); listing(holder);
  broadcastRequest(r);
  assert.ok(ledger(r.id, holder));
  db.prepare('DELETE FROM phone_requests WHERE id=?').run(r.id);
  assert.equal(ledger(r.id, holder), undefined);
});
