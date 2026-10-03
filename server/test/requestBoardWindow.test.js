// The request board shows the last ten days (owner's call, 3 Oct 2026).
// Requests live three weeks; the board just stops showing the older ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-boardwindow-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: requestRoutes, BOARD_WINDOW_MS } = await import('../src/routes/phoneRequests.js');

const app = express();
app.use(express.json());
app.use('/', requestRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

const NOW = Date.now();
const DAY = 86400000;
db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
            VALUES(1, '07700000001', 'x', 'Buyer', 'Baghdad', ?)`).run(NOW);
let rid = 0;
function request(ageDays) {
  const id = ++rid;
  db.prepare(`INSERT INTO phone_requests
    (id, buyer_id, brand, model, max_price, governorate, status, offer_count, created_at, expires_at)
    VALUES(?, 1, 'Apple', 'iPhone 13', 500000, 'Baghdad', 'open', 0, ?, ?)`)
    .run(id, NOW - ageDays * DAY, NOW - ageDays * DAY + 21 * DAY);
  return id;
}
const EIGHT = request(8), NINE_AND_A_HALF = request(9.5), ELEVEN = request(11);

test('the board is ten days wide', () => {
  assert.equal(BOARD_WINDOW_MS, 10 * DAY);
});

test('a request from 8 or 9½ days ago is on the board; one from 11 days ago is not', async () => {
  const res = await fetch(`${BASE}/phone-requests`);
  assert.equal(res.status, 200);
  const ids = (await res.json()).map((r) => r.id);
  assert.ok(ids.includes(EIGHT));
  assert.ok(ids.includes(NINE_AND_A_HALF));
  assert.ok(!ids.includes(ELEVEN));
  // Still open and reachable on its own — only the board stops showing it.
  const one = await fetch(`${BASE}/phone-requests/${ELEVEN}`);
  assert.equal(one.status, 200);
});

test.after(() => { server.close(); db.close(); });
