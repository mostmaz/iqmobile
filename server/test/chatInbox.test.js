// What each side of a chat sees in the inbox.
//
// A thread is created when the buyer taps «مراسلة», before a word is typed.
// The buyer owns that draft and should see it; the seller should see
// nothing until something is said. Through HTTP, because the filter lives
// in the SQL of the list route and nowhere else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-inbox-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { default: listingsRoutes } = await import('../src/routes/listings.js');
const { default: chatsRoutes } = await import('../src/routes/chats.js');

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/listings', listingsRoutes);
app.use('/', chatsRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

async function call(method, p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}
async function register(phone, name) {
  const r = await call('POST', '/auth/register', {
    phone, password: 'pw1234', display_name: name, governorate: 'Baghdad',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

const seller = await register('07700000011', 'Seller');
const buyer = await register('07700000012', 'Buyer');
const lc = await call('POST', '/listings', {
  brand: 'Apple', model: 'iPhone 13', condition: 'used', asking_price: 500000,
  governorate: 'Baghdad', contact_phone: '07700000011',
}, seller.token);
assert.equal(lc.status, 200, JSON.stringify(lc.data));
const listingId = lc.data.id;

test('opening a thread shows it to the buyer and to nobody else', async () => {
  const opened = await call('POST', `/listings/${listingId}/chat`, null, buyer.token);
  assert.equal(opened.status, 200);

  const mine = await call('GET', '/chats', null, buyer.token);
  assert.deepEqual(mine.data.map((c) => c.id), [opened.data.id]);
  assert.equal(mine.data[0].last_message, null);

  const theirs = await call('GET', '/chats', null, seller.token);
  assert.deepEqual(theirs.data, []);
  const asSeller = await call('GET', '/chats?role=seller', null, seller.token);
  assert.deepEqual(asSeller.data, []);
  const forListing = await call('GET', `/chats?listing_id=${listingId}`, null, seller.token);
  assert.deepEqual(forListing.data, []);
});

test('the first word makes it a conversation the seller sees', async () => {
  const chatId = db.prepare('SELECT id FROM chats WHERE buyer_id=?').get(buyer.user.id).id;
  const sent = await call('POST', `/chats/${chatId}/messages`, { body: 'متوفر؟' }, buyer.token);
  assert.equal(sent.status, 200, JSON.stringify(sent.data));

  const theirs = await call('GET', '/chats', null, seller.token);
  assert.deepEqual(theirs.data.map((c) => c.id), [chatId]);
  assert.equal(theirs.data[0].last_message.preview, 'متوفر؟');
  assert.equal(theirs.data[0].unread_count, 1);
});

test.after(() => { server.close(); db.close(); });
