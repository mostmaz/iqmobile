// How long a sign-in lasts (15 Oct 2026).
//
// Production ran JWT_TTL=7d, and the app answers an expired token by making
// a new guest, so every guest was reset on day 8 and lost its chats and
// saved searches. Pinned here: an app token is good for a year from issue,
// whatever its exp claim says (so the 7-day tokens already out there are
// honoured); /auth/me renews a week-old one; an admin token still dies on
// time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import jwt from 'jsonwebtoken';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-session-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_TTL = '7d';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { issueToken, verifyToken, APP_SESSION_DAYS } = await import('../src/auth.js');
const { default: authRoutes } = await import('../src/routes/auth.js');

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
// A token as the old server minted it: issued `ageDays` ago, 7-day exp.
const oldToken = (payload, ageDays) =>
  jwt.sign({ ...payload, iat: nowS() - ageDays * DAY, exp: nowS() - (ageDays - 7) * DAY }, 'test-secret');

const guestId = Number(db.prepare(
  `INSERT INTO users(phone, password_hash, display_name, governorate, seller_type, is_guest, created_at)
   VALUES('guest:abc','','ضيف','Baghdad','individual',1,?)`,
).run(Date.now()).lastInsertRowid);

test('an app token outlives its 7-day exp: a guest is still themselves on day 8 and day 300', () => {
  assert.equal(verifyToken(oldToken({ id: guestId }, 8))?.id, guestId);
  assert.equal(verifyToken(oldToken({ id: guestId }, 300))?.id, guestId);
});

test('…but not past a year', () => {
  assert.equal(verifyToken(oldToken({ id: guestId }, APP_SESSION_DAYS + 1)), null);
});

test('a forged token is still refused', () => {
  const forged = jwt.sign({ id: guestId, iat: nowS() }, 'wrong-secret');
  assert.equal(verifyToken(forged), null);
});

test('new app tokens are minted for a year; admin tokens keep JWT_TTL', () => {
  const app1 = jwt.decode(issueToken({ id: guestId }));
  assert.equal(Math.round((app1.exp - app1.iat) / DAY), APP_SESSION_DAYS);
  const adm = jwt.decode(issueToken({ id: 1, kind: 'admin', username: 'a' }));
  assert.equal(Math.round((adm.exp - adm.iat) / DAY), 7);
});

test('an expired admin token is refused', () => {
  assert.equal(verifyToken(oldToken({ id: 1, kind: 'admin', username: 'a' }, 8)), null);
  assert.ok(verifyToken(issueToken({ id: 1, kind: 'admin', username: 'a' })));
});

test('/auth/me signs an 8-day-old session in and hands back a renewed token; a fresh one is left alone', async () => {
  const me = await fetch(`${BASE}/auth/me`, { headers: { authorization: `Bearer ${oldToken({ id: guestId }, 8)}` } });
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.user.id, guestId);
  const renewed = jwt.decode(body.token);
  assert.equal(renewed.id, guestId);
  assert.ok(renewed.iat >= nowS() - 5);

  const fresh = await (await fetch(`${BASE}/auth/me`, { headers: { authorization: `Bearer ${issueToken({ id: guestId })}` } })).json();
  assert.equal(fresh.token, undefined);
});

test.after(() => { server.close(); db.close(); });
