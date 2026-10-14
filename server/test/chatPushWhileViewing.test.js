// No push for a message the recipient is already looking at.
//
// Users reported "a notification for a message while I'm in the chat": the
// app shows every push in the foreground, banner and sound, including one
// for the thread on screen. The chat screen re-reads the thread every 3 s
// and each read stamps <side>_last_read_at, so the server can tell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-viewing-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { issueToken } = await import('../src/auth.js');
const { default: chatsRoutes } = await import('../src/routes/chats.js');

const app = express();
app.use(express.json());
app.use('/', chatsRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

const NOW = Date.now();
for (const [id, phone] of [[1, '07700000001'], [2, '07700000002']]) {
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
              VALUES(?,?,'x','U','Baghdad',?)`).run(id, phone, NOW);
}
db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price, governorate, status, created_at, updated_at, expires_at)
            VALUES(1, 2, 'Apple', 'iPhone 13', 'used', 500000, 'Baghdad', 'active', ?, ?, ?)`).run(NOW, NOW, NOW + 86400000);
db.prepare('INSERT INTO chats(id, listing_id, buyer_id, seller_id, created_at, last_message_at) VALUES(1, 1, 1, 2, ?, ?)').run(NOW, NOW);
const buyer = issueToken({ id: 1 }), seller = issueToken({ id: 2 });
const call = (method, p, token, body) => fetch(BASE + p, {
  method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, data: await r.json() }));
const lastToSeller = () => db.prepare("SELECT pushed FROM notifications WHERE user_id=2 AND kind='chat.message' ORDER BY id DESC LIMIT 1").get();

test('the seller has the chat open: the message arrives without a push', async () => {
  assert.equal((await call('GET', '/chats/1/messages', seller)).status, 200); // the 3-second poll
  const r = await call('POST', '/chats/1/messages', buyer, { body: 'متوفر؟' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const n = lastToSeller();
  assert.ok(n, 'the inbox row is still written');
  assert.equal(n.pushed, 0);
});

test('the seller left the chat a minute ago: the message is pushed', async () => {
  db.prepare('UPDATE chats SET seller_last_read_at=? WHERE id=1').run(Date.now() - 60_000);
  const r = await call('POST', '/chats/1/messages', buyer, { body: 'وينك؟' });
  assert.equal(r.status, 200);
  assert.equal(lastToSeller().pushed, 1);
});

test('a seller who never opened the chat is pushed', async () => {
  db.prepare('UPDATE chats SET seller_last_read_at=NULL WHERE id=1').run();
  await call('POST', '/chats/1/messages', buyer, { body: 'مرحبا' });
  assert.equal(lastToSeller().pushed, 1);
});

test.after(() => { server.close(); db.close(); });
