// End-to-end test of the deal lifecycle through HTTP routes.
// Spins the express app on a random port + a fresh sqlite file in /tmp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

// Per-test isolated DB. db.js reads DB_PATH at import time, so we set it
// before importing.
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

// Dynamic import after env is set.
const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { default: listingsRoutes } = await import('../src/routes/listings.js');
const { default: chatsRoutes } = await import('../src/routes/chats.js');
const { default: dealsRoutes } = await import('../src/routes/deals.js');
const { default: ratingsRoutes } = await import('../src/routes/ratings.js');

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/listings', listingsRoutes);
app.use('/', chatsRoutes);
app.use('/', dealsRoutes);
app.use('/', ratingsRoutes);

const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

async function call(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function register(phone, name) {
  const r = await call('POST', '/auth/register', {
    phone, password: 'pw1234', display_name: name, governorate: 'Baghdad',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

test('listing + chat still work; every deal mutation is retired (410)', async () => {
  const seller = await register('07700000001', 'Seller');
  const buyer = await register('07700000002', 'Buyer');

  const lc = await call('POST', '/listings', {
    brand: 'Apple', model: 'iPhone 13',
    condition: 'used', asking_price: 500000,
    governorate: 'Baghdad',
    contact_phone: '07700000001',
  }, seller.token);
  assert.equal(lc.status, 200);
  const listingId = lc.data.id;

  // Phone is public on the listing — the thing deal confirmation used to
  // gate. This is WHY the deal flow could be retired.
  const detail = await call('GET', `/listings/${listingId}`, null, buyer.token);
  assert.equal(detail.data.phone_visible, true);
  assert.equal(detail.data.contact_phone, '07700000001');

  const chat = await call('POST', `/listings/${listingId}/chat`, null, buyer.token);
  assert.equal(chat.status, 200);
  const chatId = chat.data.id;

  // Every mutation answers 410 deals_removed — even from the seller, even
  // with a well-formed body, and before any id validation.
  const gone = (r) => {
    assert.equal(r.status, 410, JSON.stringify(r.data));
    assert.equal(r.data.error, 'deals_removed');
  };
  gone(await call('POST', `/chats/${chatId}/propose-price`, { final_price: 480000 }, seller.token));
  gone(await call('POST', '/deals/1/buyer-accept', null, buyer.token));
  gone(await call('POST', '/deals/1/buyer-reject', null, buyer.token));
  gone(await call('POST', '/deals/1/counter-offer', { final_price: 1 }, buyer.token));
  gone(await call('POST', '/deals/1/seller-confirm', null, seller.token));
  gone(await call('POST', '/deals/1/cancel', null, seller.token));

  // No deal row was created by any of the rejected calls.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM deals').get().c, 0);

  // History read stays alive (and empty).
  const mine = await call('GET', '/deals/mine', null, seller.token);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.data, []);
});

test('phone numbers in chat messages pass through unchanged (no masking)', async () => {
  // Reuse the users from the previous test — the auth limiter allows only
  // 5 register calls a minute and the suite shares one process.
  const s = await call('POST', '/auth/login', { phone: '07700000001', password: 'pw1234' });
  const b = await call('POST', '/auth/login', { phone: '07700000002', password: 'pw1234' });
  const lc = await call('POST', '/listings', { brand: 'Apple', model: '14', condition: 'new', asking_price: 1, governorate: 'Baghdad', contact_phone: '07700000001' }, s.data.token);
  const chat = await call('POST', `/listings/${lc.data.id}/chat`, null, b.data.token);
  const msg = await call('POST', `/chats/${chat.data.id}/messages`, { body: 'تواصل 07710000000' }, b.data.token);
  assert.equal(msg.data.blocked, false);
  assert.equal(/07710000000/.test(msg.data.body), true);
});

test('cleanup', async () => {
  await new Promise((res) => server.close(res));
  fs.rmSync(tmp, { recursive: true, force: true });
});
