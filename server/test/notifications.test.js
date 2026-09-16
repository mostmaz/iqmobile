import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-notifications-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-notifications-secret';
const { default: express } = await import('express');
const { db, now } = await import('../src/db.js');
const { issueToken } = await import('../src/auth.js');
const { default: auth } = await import('../src/routes/auth.js');
const { default: wishlist, alertWishlistOnListing, alertWishlistOnPriceDrop } = await import('../src/routes/wishlist.js');
const { default: notifications } = await import('../src/routes/notifications.js');
const { default: requests } = await import('../src/routes/phoneRequests.js');
const app = express();
app.use(express.json());
app.use('/auth', auth);
app.use('/', wishlist);
app.use('/', requests);
app.use('/notifications', notifications);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
function user(phone) {
  const id = Number(db.prepare('INSERT INTO users(phone,password_hash,display_name,governorate,created_at) VALUES(?,?,?,?,?)').run(phone, 'unused', phone, 'Baghdad', now()).lastInsertRowid);
  return { id, token: issueToken({ id }) };
}
async function call(user, method, route, body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method, headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
test('wish creation does not alert sellers; matching new listing alerts buyer once', async () => {
  const buyer = user('07700000111');
  const seller = user('07700000112');
  const wish = await call(buyer, 'POST', '/wishlist', { brand: 'Apple', model: 'iPhone 13', max_price: 500000 });
  assert.equal(wish.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);
  const listing = { id: 123, seller_id: seller.id, brand: 'Apple', model: 'iPhone 13', asking_price: 450000, status: 'active' };
  alertWishlistOnListing({ ...listing, model: 'iPhone 13 Pro' });
  alertWishlistOnListing({ ...listing, asking_price: 600000 });
  alertWishlistOnListing({ ...listing, status: 'removed' });
  alertWishlistOnListing({ ...listing, seller_id: buyer.id });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);
  alertWishlistOnListing(listing);
  alertWishlistOnListing(listing);
  alertWishlistOnPriceDrop(listing, 600000);
  const inbox = await call(buyer, 'GET', '/notifications');
  assert.equal(inbox.data.length, 1);
  assert.equal(inbox.data[0].kind, 'wishlist.match');
  assert.equal(inbox.data[0].payload.listing_id, 123);
  assert.equal((await call(seller, 'GET', '/notifications')).data.length, 0);
  await call(seller, 'POST', `/notifications/${inbox.data[0].id}/read`);
  assert.equal((await call(buyer, 'GET', '/notifications')).data[0].read, false);
  await call(buyer, 'POST', `/notifications/${inbox.data[0].id}/read`);
  assert.equal((await call(buyer, 'GET', '/notifications')).data[0].read, true);
});
test('push registration validates tokens and transfers device ownership', async () => {
  const first = user('07700000113');
  const second = user('07700000114');
  const token = 'ExponentPushToken[notification-test-device]';
  assert.equal((await call(first, 'POST', '/auth/push-token', { expo_push_token: token })).status, 200);
  assert.equal((await call(second, 'POST', '/auth/push-token', { expo_push_token: 'invalid' })).status, 400);
  assert.equal((await call(second, 'POST', '/auth/push-token', { expo_push_token: token })).status, 200);
  assert.equal(db.prepare('SELECT expo_push_token FROM users WHERE id=?').get(first.id).expo_push_token, null);
  assert.equal(db.prepare('SELECT expo_push_token FROM users WHERE id=?').get(second.id).expo_push_token, token);
  assert.equal((await call(second, 'POST', '/auth/push-token', { expo_push_token: null })).status, 200);
  assert.equal(db.prepare('SELECT expo_push_token FROM users WHERE id=?').get(second.id).expo_push_token, null);
});

test('request creation alerts an exact holder; unchanged offers do not alert twice; expired details are retired', async () => {
  const buyer = user('07700000115');
  const seller = user('07700000116');
  const wrong = user('07700000117');
  const insert = db.prepare(`INSERT INTO phone_listings(seller_id,brand,model,condition,asking_price,governorate,status,created_at,updated_at,expires_at)
    VALUES(?,'Apple','iPhone 13',?,450000,'Baghdad','active',?,?,?)`);
  insert.run(seller.id, 'new', now(), now(), now()+86400000);
  insert.run(wrong.id, 'used', now(), now(), now()+86400000);
  const body = { brand: 'Apple', model: 'iPhone 13', condition: 'new', max_price: 500000, governorate: 'Baghdad' };
  const created = await call(buyer, 'POST', '/phone-requests', body);
  assert.equal(created.status, 200);
  await new Promise(resolve => setImmediate(resolve));
  const alerts = (await call(seller, 'GET', '/notifications')).data;
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'request.match');
  assert.equal(alerts[0].payload.request_id, created.data.id);
  assert.equal((await call(wrong, 'GET', '/notifications')).data.length, 0);
  assert.equal((await call(buyer, 'POST', '/phone-requests', body)).status, 409);
  const route = `/phone-requests/${created.data.id}/offers`;
  assert.equal((await call(seller, 'POST', route, { price: 450000 })).status, 200);
  assert.equal((await call(seller, 'POST', route, { price: 450000 })).status, 200);
  const inbox = (await call(buyer, 'GET', '/notifications')).data;
  assert.equal(inbox.filter(row => row.kind === 'request.offer').length, 1);
  const detail = (await call(buyer, 'GET', `/phone-requests/${created.data.id}`)).data;
  assert.equal(detail.offers.length, 1);
  assert.equal(detail.offer_count, 1);
  assert.equal((await call(wrong, 'GET', `/phone-requests/${created.data.id}`)).data.offers, undefined);
  db.prepare('UPDATE phone_requests SET expires_at=? WHERE id=?').run(now()-1, created.data.id);
  assert.equal((await call(buyer, 'GET', `/phone-requests/${created.data.id}`)).data.status, 'expired');
  assert.equal((await call(buyer, 'PATCH', `/phone-requests/${created.data.id}`, {status:'open'})).status, 400);
});
