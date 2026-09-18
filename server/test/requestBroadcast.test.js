// Exact matching recipients, eligibility, and the 100-seller cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-bcast-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');

const NOW = Date.now();
const DAY = 86400000;

let uid = 100;
function user({ type = 'individual', gov = 'Baghdad', guest = 0, extra = {} } = {}) {
  const id = uid++;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, is_guest, created_at)
              VALUES(?, ?, 'x', ?, ?, ?, ?, ?)`)
    .run(id, `0770000${String(id).padStart(4, '0')}`, `u${id}`, gov, type, guest, NOW);
  for (const [k, v] of Object.entries(extra)) {
    db.prepare(`UPDATE users SET ${k}=? WHERE id=?`).run(v, id);
  }
  return id;
}

let lid = 1000;
function listing(sellerId, brand, model, { price = 300000, status = 'active', ageDays = 1 } = {}) {
  const id = lid++;
  const at = NOW - ageDays * DAY;
  db.prepare(`INSERT INTO phone_listings
    (id, seller_id, brand, model, condition, asking_price, governorate, status,
     created_at, updated_at, expires_at)
    VALUES(?, ?, ?, ?, 'used', ?, 'Baghdad', ?, ?, ?, ?)`)
    .run(id, sellerId, brand, model, price, status, at, at, NOW + 30 * DAY);
  return id;
}

// The request every case below is measured against. Priced high so the
// budget never accidentally becomes the thing under test.
const BUYER = user();
const REQUEST = {
  id: 1, buyer_id: BUYER, brand: 'Samsung', model: 'Galaxy S24',
  max_price: 5_000_000, governorate: 'Baghdad',
};
// A real row, not just the object above: the broadcast now records who it
// told in request_notifications, whose foreign key points here. Passing a
// synthetic request made that insert fail, and because broadcastRequest
// swallows its own errors the symptom was every seller silently unnotified —
// which is the exact production bug this ledger exists to prevent.
db.prepare(`INSERT INTO phone_requests
  (id, buyer_id, brand, model, max_price, governorate, status, offer_count, created_at, expires_at)
  VALUES(?,?,?,?,?,?,'open',0,?,?)`)
  .run(REQUEST.id, BUYER, REQUEST.brand, REQUEST.model, REQUEST.max_price, REQUEST.governorate,
       NOW, NOW + 21 * 86400000);

const { __testables, broadcastRequest } = await import('../src/routes/phoneRequests.js');
const ids = () => [...__testables.sellersWithMatchingListing(REQUEST).keys()];

test.beforeEach(() => {
  db.prepare('DELETE FROM phone_listings').run();
  // The dedupe ledger is keyed on (request, seller) and these tests reuse
  // one request id, so without this every case after the first sees its
  // whole cast as "already told" and asserts against zero notifications.
  db.prepare('DELETE FROM request_notifications').run();
  db.prepare('DELETE FROM users WHERE id <> ?').run(BUYER);
});

// ── the three tightenings ──────────────────────────────────────────────

test('only exact devices qualify, with no shop or brand-only fallback', () => {
  const exact = user(); listing(exact, 'Samsung', 'Galaxy S24');
  const wrong = user(); listing(wrong, 'Samsung', 'Galaxy A14');
  const nearbyShop = user({ type: 'shop' });
  broadcastRequest(REQUEST);
  assert.deepEqual(ids(), [exact]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id IN (?,?)').get(wrong, nearbyShop).n, 0);
});
test('no exact holders means no broadcast', () => {
  const wrong = user(); listing(wrong, 'Samsung', 'Galaxy A14');
  user({ type: 'shop' });
  broadcastRequest(REQUEST);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);
});
test('sold, draft and call-for-price listings are excluded; reserved listings qualify', () => {
  const sold = user(); listing(sold, 'Samsung', 'Galaxy S24', { status: 'sold' });
  const draft = user(); const dl = listing(draft, 'Samsung', 'Galaxy S24');
  db.prepare('UPDATE phone_listings SET is_draft=1 WHERE id=?').run(dl);
  const unpriced = user(); listing(unpriced, 'Samsung', 'Galaxy S24', { price: 1 });
  const reserved = user(); listing(reserved, 'Samsung', 'Galaxy S24', { status: 'reserved' });
  assert.deepEqual(ids(), [reserved]);
});
test('guest, hidden, unapproved, contactless and admin-made accounts are excluded', () => {
  const excluded = [user({ guest: 1 }), ...[
    { shop_hidden: 1 }, { shop_status: 'pending' }, { shop_no_contact: 1 }, { shop_origin: 'admin' },
  ].map(extra => user({ type: 'shop', extra }))];
  for (const id of excluded) listing(id, 'Samsung', 'Galaxy S24');
  broadcastRequest(REQUEST);
  assert.deepEqual(ids(), []);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);
});
test('one alert per seller even with multiple matches, never to the buyer', () => {
  listing(BUYER, 'Samsung', 'Galaxy S24');
  const seller = user(); listing(seller, 'Samsung', 'Galaxy S24', { price: 350000 });
  const cheapest = listing(seller, 'Samsung', 'Galaxy S24', { price: 300000 });
  broadcastRequest(REQUEST);
  const rows = db.prepare('SELECT * FROM notifications').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, seller);
  assert.equal(JSON.parse(rows[0].payload_json).listing_id, cheapest);
});
test('full broadcast reaches 100 matching sellers, then stops', () => {
  for (let i = 0; i < 105; i++) {
    const holder = user(); listing(holder, 'Samsung', 'Galaxy S24');
  }
  broadcastRequest(REQUEST);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='request.match'").get().n, 100);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='request.new'").get().n, 0);
});
test('Arabic and English device names match the same model', () => {
  const seller = user(); listing(seller, 'Samsung', 'جالكسي اس ٢٤');
  assert.deepEqual(ids(), [seller]);
});

test('delegated managers count toward the cap and receive only one alert each', () => {
  const manager = user();
  for (let i = 0; i < 105; i++) {
    const shop = user({ type: 'shop', extra: { shop_manager_id: manager } });
    listing(shop, 'Samsung', 'Galaxy S24');
  }
  broadcastRequest(REQUEST);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 100);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(manager).n, 1);
});
