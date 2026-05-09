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

test('full deal flow: list, chat, propose, accept, confirm, phone unlocked, rate', async () => {
  const seller = await register('07700000001', 'Seller');
  const buyer = await register('07700000002', 'Buyer');

  // Seller posts listing. contact_phone is required now; use the seller's
  // own phone since that's the realistic case for an individual seller.
  const lc = await call('POST', '/listings', {
    brand: 'Apple', model: 'iPhone 13',
    condition: 'used', asking_price: 500000,
    governorate: 'Baghdad',
    contact_phone: '07700000001',
  }, seller.token);
  assert.equal(lc.status, 200);
  const listingId = lc.data.id;

  // Buyer browses → sees the listing.
  const browse = await call('GET', '/listings', null, buyer.token);
  assert.equal(browse.status, 200);
  assert.ok(browse.data.find((l) => l.id === listingId));

  // Buyer fetches detail — phone is now always visible (per-listing
  // contact_phone, no deal-confirmation gate).
  const detail = await call('GET', `/listings/${listingId}`, null, buyer.token);
  assert.equal(detail.data.seller_phone, '07700000001');
  assert.equal(detail.data.phone_visible, true);
  assert.equal(detail.data.contact_phone, '07700000001');

  // Buyer starts chat.
  const chat = await call('POST', `/listings/${listingId}/chat`, null, buyer.token);
  assert.equal(chat.status, 200);
  const chatId = chat.data.id;

  // Seller proposes a price (deal flow data still works for record-keeping
  // even though the UI no longer surfaces it).
  const propose = await call('POST', `/chats/${chatId}/propose-price`, { final_price: 480000 }, seller.token);
  assert.equal(propose.status, 200);
  const dealId = propose.data.id;
  assert.equal(propose.data.status, 'proposed');

  // Buyer accepts.
  const accept = await call('POST', `/deals/${dealId}/buyer-accept`, null, buyer.token);
  assert.equal(accept.status, 200);
  assert.equal(accept.data.status, 'buyer_accepted');

  // Seller confirms.
  const confirm = await call('POST', `/deals/${dealId}/seller-confirm`, null, seller.token);
  assert.equal(confirm.status, 200);
  assert.equal(confirm.data.status, 'seller_confirmed');

  // Listing status flipped to reserved (default behaviour).
  const reserved = await call('GET', `/listings/${listingId}`, null, buyer.token);
  assert.equal(reserved.data.status, 'reserved');

  // Buyer rates the seller.
  const rate = await call('POST', `/deals/${dealId}/rating`, { stars: 5, comment: 'تجربة ممتازة' }, buyer.token);
  assert.equal(rate.status, 200);

  // Cannot rate twice.
  const rate2 = await call('POST', `/deals/${dealId}/rating`, { stars: 4 }, buyer.token);
  assert.equal(rate2.status, 409);
});

test('seller cannot confirm before buyer accepts', async () => {
  const s = await register('07700000010', 'S');
  const b = await register('07700000011', 'B');
  const lc = await call('POST', '/listings', { brand: 'Samsung', model: 'S22', condition: 'new', asking_price: 700000, governorate: 'Baghdad', contact_phone: '07700000010' }, s.token);
  const chat = await call('POST', `/listings/${lc.data.id}/chat`, null, b.token);
  const propose = await call('POST', `/chats/${chat.data.id}/propose-price`, { final_price: 650000 }, s.token);
  const tooSoon = await call('POST', `/deals/${propose.data.id}/seller-confirm`, null, s.token);
  assert.equal(tooSoon.status, 409);
});

test('buyer cannot rate without confirmed deal', async () => {
  const s = await register('07700000020', 'S2');
  const b = await register('07700000021', 'B2');
  const lc = await call('POST', '/listings', { brand: 'Apple', model: '12', condition: 'used', asking_price: 100000, governorate: 'Baghdad', contact_phone: '07700000020' }, s.token);
  const chat = await call('POST', `/listings/${lc.data.id}/chat`, null, b.token);
  const propose = await call('POST', `/chats/${chat.data.id}/propose-price`, { final_price: 90000 }, s.token);
  const earlyRate = await call('POST', `/deals/${propose.data.id}/rating`, { stars: 5 }, b.token);
  assert.equal(earlyRate.status, 409);
});

test('phone numbers in chat messages pass through unchanged (no masking)', async () => {
  const s = await register('07700000030', 'S3');
  const b = await register('07700000031', 'B3');
  const lc = await call('POST', '/listings', { brand: 'Apple', model: '14', condition: 'new', asking_price: 1, governorate: 'Baghdad', contact_phone: '07700000030' }, s.token);
  const chat = await call('POST', `/listings/${lc.data.id}/chat`, null, b.token);
  const msg = await call('POST', `/chats/${chat.data.id}/messages`, { body: 'تواصل 07710000000' }, b.token);
  assert.equal(msg.data.blocked, false);
  assert.equal(/07710000000/.test(msg.data.body), true);
});

test('cleanup', async () => {
  await new Promise((res) => server.close(res));
  fs.rmSync(tmp, { recursive: true, force: true });
});
