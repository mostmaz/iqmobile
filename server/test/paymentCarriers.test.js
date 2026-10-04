// Which payment methods featuring offers. Airtime (Asiacell, Korek) was
// switched off on 4 Oct 2026; Qi Card and the wallet balance remain. Every
// app build draws its buttons from /features/tiers, so the served list IS
// the switch — and a carrier that is off must not leak a number or a dial
// code that would let any client take the money anyway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-carriers-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { issueToken } = await import('../src/auth.js');
const { default: featuresRoutes } = await import('../src/routes/features.js');
const { CARRIERS, OFFERED_CARRIERS } = await import('../src/featureTiers.js');

const app = express();
app.use(express.json());
app.use('/', featuresRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

const NOW = Date.now();
db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
            VALUES(1, '07701112233', 'x', 'Seller', 'Baghdad', 'individual', ?)`).run(NOW);
db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price, governorate,
            status, is_draft, created_at, updated_at, expires_at)
            VALUES(1, 1, 'Apple', 'iPhone 13', 'used', 500000, 'Baghdad', 'active', 0, ?, ?, ?)`).run(NOW, NOW, NOW + 86400000);
const token = issueToken({ id: 1 });
const post = (body) => fetch(`${BASE}/listings/1/feature-request`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, data: await r.json() }));

test('only Qi Card is offered; airtime numbers and dial codes are not served', async () => {
  const cfg = await (await fetch(`${BASE}/features/tiers`)).json();
  assert.deepEqual(cfg.carriers, ['qicard']);
  assert.deepEqual(OFFERED_CARRIERS, ['qicard']);
  for (const k of ['asiacell', 'korek']) {
    assert.ok(!(k in cfg.transfer_numbers), `${k} number served`);
    assert.ok(!(k in cfg.ussd_templates), `${k} dial code served`);
    assert.ok(!(k in cfg.carrier_prefixes), `${k} prefix served`);
  }
  assert.ok(cfg.qi_card?.account, 'the Qi Card account is still there');
  // The system still knows the old carriers, so requests filed under them resolve.
  assert.ok(CARRIERS.includes('asiacell') && CARRIERS.includes('korek'));
});

test('a new Asiacell or Korek request is refused; Qi Card goes through', async () => {
  assert.equal((await post({ tier: 'bronze', carrier: 'asiacell', sender_phone: '07701112233' })).data.error, 'bad_carrier');
  assert.equal((await post({ tier: 'bronze', carrier: 'korek', sender_phone: '07501112233' })).data.error, 'bad_carrier');
  const ok = await post({ tier: 'bronze', carrier: 'qicard', sender_name: 'Seller Name' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test.after(() => { server.close(); db.close(); });
