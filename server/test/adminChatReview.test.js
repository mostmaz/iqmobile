// Reviewing a reported chat from the dashboard and banning from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-chatreview-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { issueToken } = await import('../src/auth.js');
const { default: adminRoutes } = await import('../src/routes/admin/index.js');

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;
const admin = issueToken({ id: 1, kind: 'admin', username: 'admin' });
const call = (method, p, body) => fetch(BASE + p, {
  method, headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, data: await r.json() }));

const NOW = Date.now();
for (const [id, name, phone] of [[10, 'Buyer', '07700000010'], [11, 'Scammer Shop', '07700000011']]) {
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
              VALUES(?,?, 'x', ?, 'Baghdad', ?)`).run(id, phone, name, NOW);
}
db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price, governorate, status, created_at, updated_at, expires_at)
            VALUES(5, 11, 'Apple', 'iPhone 13', 'used', 400000, 'Baghdad', 'active', ?, ?, ?)`).run(NOW, NOW, NOW + 86400000);
db.prepare(`INSERT INTO chats(id, listing_id, buyer_id, seller_id, created_at, last_message_at) VALUES(7, 5, 10, 11, ?, ?)`).run(NOW, NOW);
db.prepare(`INSERT INTO chat_messages(chat_id, sender_id, body, masked, created_at) VALUES(7, 11, 'حوّل العربون على هالرقم', 0, ?)`).run(NOW);
db.prepare(`INSERT INTO reports(reporter_id, target_kind, target_id, reason, status, created_at) VALUES(10, 'chat', 7, 'scam_attempt', 'open', ?)`).run(NOW);

test('a chat report says who is in the thread', async () => {
  const r = await call('GET', '/admin/reports?status=open');
  const rep = r.data.find((x) => x.target_kind === 'chat');
  assert.equal(rep.chat.id, 7);
  assert.equal(rep.chat.buyer_name, 'Buyer');
  assert.equal(rep.chat.seller_name, 'Scammer Shop');
  assert.equal(rep.chat.message_count, 1);
});

test('the thread comes with both people, their numbers and ban state', async () => {
  const r = await call('GET', '/admin/chats/7/messages');
  assert.equal(r.status, 200);
  assert.equal(r.data.messages.length, 1);
  const seller = r.data.parties.find((p) => p.role === 'seller');
  assert.equal(seller.id, 11);
  assert.equal(seller.phone, '07700000011');
  assert.equal(seller.suspended_at, null);
  assert.equal(seller.reports_against, 1, 'the buyer reported their chat');
  assert.equal(r.data.parties.find((p) => p.role === 'buyer').reports_against, 0);
  assert.equal(r.data.listing.id, 5);
});

test('ban sets, it does not toggle — pressing twice leaves them banned', async () => {
  const a = await call('PATCH', '/admin/users/11/suspend', { suspended: true, from: 'chat_review' });
  assert.ok(a.data.suspended_at);
  const b = await call('PATCH', '/admin/users/11/suspend', { suspended: true });
  assert.equal(b.data.suspended_at, a.data.suspended_at);
  const audit = db.prepare("SELECT action FROM audit_log WHERE target_id=11 ORDER BY id").all().map((x) => x.action);
  assert.ok(audit.includes('user.suspend'));
  const un = await call('PATCH', '/admin/users/11/suspend', { suspended: false });
  assert.equal(un.data.suspended_at, null);
});

test('with no body it still toggles, as the Users page calls it', async () => {
  assert.ok((await call('PATCH', '/admin/users/10/suspend')).data.suspended_at);
  assert.equal((await call('PATCH', '/admin/users/10/suspend')).data.suspended_at, null);
});

test('the house store cannot be banned, from anywhere', async () => {
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, shop_orders_enabled, created_at)
              VALUES(20, '07700000020', 'x', 'House', 'Baghdad', 'shop', 1, ?)`).run(NOW);
  db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES('storefront_shop_id', '20')").run();
  const r = await call('PATCH', '/admin/users/20/suspend', { suspended: true });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'protected_account');
  assert.equal(db.prepare('SELECT suspended_at FROM users WHERE id=20').get().suspended_at, null);
});

test.after(() => { server.close(); db.close(); });
