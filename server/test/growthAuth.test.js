import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('registration timestamps survive login and guest promotion preserves creation history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-growth-auth-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.JWT_SECRET = 'growth-test-only';
  process.env.OTP_REQUIRED = 'false';
  const { default: express } = await import('express');
  const { db } = await import('../src/db.js');
  const { default: auth } = await import('../src/routes/auth.js');
  const { default: listings } = await import('../src/routes/listings.js');
  const app = express(); app.use(express.json()); app.use('/auth', auth); app.use('/listings', listings);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function post(route, body, token) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  }
  try {
    const guest = await post('guest', {});
    const before = db.prepare('SELECT * FROM users WHERE id=?').get(guest.user.id);
    assert.ok(before.guest_created_at); assert.equal(before.registered_at, null);
    const promoted = await post('phone-login', { phone: '07700000021' }, guest.token);
    assert.equal(promoted.user.id, guest.user.id);
    const after = db.prepare('SELECT * FROM users WHERE id=?').get(guest.user.id);
    assert.ok(after.registered_at); assert.equal(after.created_at, before.created_at);
    assert.equal(after.guest_created_at, before.guest_created_at);
    await post('phone-login', { phone: '07700000021' });
    assert.equal(db.prepare('SELECT registered_at FROM users WHERE id=?').get(after.id).registered_at, after.registered_at);
    const fresh = await post('phone-login', { phone: '07700000022' });
    assert.ok(db.prepare('SELECT registered_at FROM users WHERE id=?').get(fresh.user.id).registered_at);
    // Explicit submissions are deduplicated; previews and old clients stay separate.
    async function search(params) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/listings?q=reaalme&${params}`, { headers: { authorization: `Bearer ${fresh.token}` } });
      assert.equal(response.status, 200); return response.json();
    }
    await search('search_mode=preview'); await search('');
    await search('search_mode=submit&search_request_id=regression_search_01');
    await search('search_mode=submit&search_request_id=regression_search_01');
    await search('search_mode=submit&search_request_id=regression_search_01&offset=15');
    const submitted = db.prepare("SELECT * FROM events WHERE type='search_submit'").all();
    assert.equal(submitted.length,1); assert.equal(submitted[0].query,'realme'); assert.equal(submitted[0].result_count,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='search_preview'").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='search'").get().n,1);
    const password = await post('register', { phone: '07700000023', password: 'pw1234', display_name: 'Test', governorate: 'Baghdad' });
    assert.ok(db.prepare('SELECT registered_at FROM users WHERE id=?').get(password.user.id).registered_at);
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
