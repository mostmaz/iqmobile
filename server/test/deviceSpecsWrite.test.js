// Spec sheets for devices that appear after the bulk GSMArena load: the
// parser port, the write helpers, and the admin endpoints the nightly pass uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-specs-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.JWT_SECRET = 'specs-test-only';

const { db } = await import('../src/db.js');
const { issueToken } = await import('../src/auth.js');
const { parseGsmParts, partsFromHtml, gsmPagePath, upsertSpecSheet, mapModelToSpec, devicesMissingSpecs } =
  await import('../src/deviceSpecsWrite.js');
const { specsFor } = await import('../src/deviceSpecs.js');
const { default: express } = await import('express');
const { default: admin } = await import('../src/routes/admin/index.js');

const t0 = Date.now();
for (const b of ['Apple', 'Samsung']) {
  db.prepare('INSERT OR IGNORE INTO brands(name, display_ar, position, created_at) VALUES(?,?,?,?)').run(b, b, 99, t0);
}
const uid = db.prepare(
  "INSERT INTO users(phone, password_hash, display_name, governorate, created_at) VALUES('07700000009','x','s','Baghdad',1)",
).run().lastInsertRowid;
const listing = (brand, model) => db.prepare(
  `INSERT INTO phone_listings(seller_id, brand, model, condition, asking_price, governorate, status, created_at, expires_at, updated_at)
   VALUES(?,?,?,'used',100000,'Baghdad','active',?,?,?)`,
).run(uid, brand, model, t0, t0 + 1e9, t0);

const PARTS = {
  ds: {
    displaysize: '6.3 inches, 96.5 cm<sup>2</sup>',
    displayresolution: '1206 x 2622 pixels',
    displaytype: 'LTPO OLED, 120Hz',
    chipset: 'Apple A19 (3 nm)',
    internalmemory: '256GB 8GB RAM, 512GB 8GB RAM',
    batdescription1: 'Li-Ion 3692 mAh',
    cam1modules: '48 MP, f/1.6, 26mm (wide)',
    cam2modules: '18 MP, f/1.9',
    os: 'iOS 26',
    year: '2025, September 09',
  },
  pairs: [['Charging', 'Wired, PD2.0 40W wired 25W wireless (MagSafe) 4.5W reverse wired']],
  hl: '<i class="head-icon icon-wired-charging"></i>40W',
};

test('parseGsmParts mirrors the Python parser', () => {
  const p = parseGsmParts(PARTS);
  assert.equal(p.display_inches, 6.3);
  assert.equal(p.display, '6.3 inches, 96.5 cm 2');
  assert.deepEqual(p.ram_gb, [8]);
  assert.deepEqual(p.storage_options, ['256GB', '512GB']);
  assert.equal(p.battery_mah, 3692);
  assert.equal(p.charge_w, 40);
  assert.equal(p.charge_w_wireless, 25);
  assert.equal(p.chipset, 'Apple A19 (3 nm)');
});

test('highlight watts only fill what the Charging row lacks', () => {
  const p = parseGsmParts({ ds: { chipset: 'x' }, pairs: [], hl: '<i class="icon-wired-charging"></i>PD<i class="icon-wireless-charging"></i>15W' });
  assert.equal(p.charge_w, null);
  assert.equal(p.charge_w_wireless, 15);
});

const PAGE = `<h1 class="specs-phone-name-title" data-spec="modelname">Nothing Phone (2)</h1>
<div data-spec="battype-hl"><i class="head-icon icon-wired-charging"></i>45W</div>
<table><tr><td class="ttl"><a href="x">Size</a></td><td class="nfo" data-spec="displaysize">6.7 inches, 108.4 cm<sup>2</sup></td></tr>
<tr><td class="ttl">Chipset</td><td class="nfo" data-spec="chipset">Qualcomm SM8475 Snapdragon 8+ Gen 1 (4 nm)</td></tr>
<tr><td class="ttl">Internal</td><td class="nfo" data-spec="internalmemory">128GB 8GB RAM, 256GB 12GB RAM</td></tr>
<tr><td class="ttl">Single</td><td class="nfo" data-spec="cam1modules">50 MP, f/1.9 (wide)<br>50 MP, f/2.2 (ultrawide)</td></tr>
<tr><td class="ttl">Type</td><td class="nfo" data-spec="batdescription1">Li-Ion 4700 mAh</td></tr>
<tr><td class="ttl">Charging</td><td class="nfo">45W wired, PD3.0<br>15W wireless (Qi)<br>5W reverse wired</td></tr></table>`;

test('partsFromHtml reads the page the way gsm_specs.py does', () => {
  const { name, parts } = partsFromHtml(PAGE);
  assert.equal(name, 'Nothing Phone (2)');
  const p = parseGsmParts(parts);
  assert.equal(p.display_inches, 6.7);
  assert.equal(p.camera_main, '50 MP, f/1.9 (wide) 50 MP, f/2.2 (ultrawide)');
  assert.deepEqual(p.ram_gb, [8, 12]);
  assert.equal(p.battery_mah, 4700);
  assert.equal(p.charge_w, 45);
  assert.equal(p.charge_w_wireless, 15);
});

test('gsmPagePath accepts GSMArena device pages only', () => {
  assert.equal(gsmPagePath('https://www.gsmarena.com/apple_iphone_17-14000.php'), 'apple_iphone_17-14000.php');
  assert.equal(gsmPagePath('apple_ipad_(2022)-11941.php'), 'apple_ipad_(2022)-11941.php');
  assert.equal(gsmPagePath('https://evil.example/apple_iphone_17-14000.php'), null);
  assert.equal(gsmPagePath('https://www.gsmarena.com/results.php3?sName=x'), null);
});

test('a manual mapping is never replaced by an automatic one', () => {
  const a = upsertSpecSheet({ gsm_url: 'a-1.php', gsm_name: 'A', chipset: 'a' });
  const b = upsertSpecSheet({ gsm_url: 'b-2.php', gsm_name: 'B', chipset: 'b' });
  assert.equal(mapModelToSpec('Samsung', 'Galaxy X', a, 'manual'), true);
  assert.equal(mapModelToSpec('Samsung', ' galaxy x ', b, 'auto'), false);
  assert.equal(db.prepare("SELECT spec_id FROM device_spec_map WHERE brand='Samsung' AND model_norm='galaxy x'").get().spec_id, a);
});

test('admin endpoints: missing list, add from GSMArena, map a second spelling', async () => {
  listing('Apple', 'iPhone 17');
  listing('Apple', 'iPhone 17');
  listing('Apple', 'iphone 17 ');
  assert.ok(devicesMissingSpecs(10).some((d) => d.model === 'iPhone 17' && d.listings === 3));

  const app = express(); app.use(express.json()); app.use('/admin', admin);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/admin`;
  const token = issueToken({ id: 1, kind: 'admin', username: 'admin' });
  const call = (p, body) => fetch(base + p, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    assert.equal((await fetch(base + '/device-specs/missing')).status, 401);
    const miss = await call('/device-specs/missing');
    assert.equal(miss.status, 200);
    assert.ok(miss.json.devices.find((d) => d.brand === 'Apple'));

    const bad = await call('/device-specs/gsmarena', {
      url: 'https://evil.example/x-1.php', name: 'Apple iPhone 17', parts: PARTS, models: [{ brand: 'Apple', model: 'iPhone 17' }],
    });
    assert.equal(bad.status, 400);
    const empty = await call('/device-specs/gsmarena', {
      url: 'https://www.gsmarena.com/apple_iphone_17-14000.php', name: 'Apple iPhone 17', parts: { ds: {}, pairs: [] }, models: [{ brand: 'Apple', model: 'iPhone 17' }],
    });
    assert.equal(empty.status, 422);

    const add = await call('/device-specs/gsmarena', {
      url: 'https://www.gsmarena.com/apple_iphone_17-14000.php', name: 'Apple iPhone 17', parts: PARTS,
      models: [{ brand: 'Apple', model: 'iPhone 17' }],
    });
    assert.equal(add.status, 200);
    assert.equal(add.json.mapped.length, 1);
    const s = specsFor('Apple', 'iPhone 17');
    assert.equal(s.display_inches, 6.3);
    assert.equal(s.battery_mah, 3692);
    // "iphone 17 " normalises to the same model_norm, so it is covered too.
    assert.ok(specsFor('Apple', 'iphone 17 '));

    const found = await call('/device-specs/sheets?q=iphone%2017');
    assert.equal(found.json[0].id, add.json.spec_id);
    const map = await call('/device-specs/map', { spec_id: add.json.spec_id, models: [{ brand: 'Apple', model: 'iPhone17' }] });
    assert.equal(map.status, 200);
    assert.ok(specsFor('Apple', 'iPhone17'));
    // No html/parts: the server fetches the page itself.
    const realFetch = globalThis.fetch;
    let asked = null;
    globalThis.fetch = (u, o) => {
      if (String(u).startsWith('https://www.gsmarena.com/')) {
        asked = String(u);
        return Promise.resolve(new Response(`<div id="specs-list">${PAGE}</div>`, { status: 200 }));
      }
      return realFetch(u, o);
    };
    try {
      const viaServer = await call('/device-specs/gsmarena', {
        url: 'https://www.gsmarena.com/nothing_phone_(2)-12386.php', models: [{ brand: 'Apple', model: 'Phone 2 test' }],
      });
      assert.equal(viaServer.status, 200);
      assert.equal(asked, 'https://www.gsmarena.com/nothing_phone_(2)-12386.php');
      assert.equal(viaServer.json.device, 'Nothing Phone (2)');
      assert.equal(specsFor('Apple', 'Phone 2 test').battery_mah, 4700);
      // A challenge page (no spec table) is a failure, not a blank sheet.
      globalThis.fetch = (u, o) => (String(u).startsWith('https://www.gsmarena.com/')
        ? Promise.resolve(new Response('<title>Just a moment</title>', { status: 403 })) : realFetch(u, o));
      const blocked = await call('/device-specs/gsmarena', {
        url: 'samsung_galaxy_a56-13603.php', models: [{ brand: 'Samsung', model: 'Galaxy A56' }],
      });
      assert.equal(blocked.status, 502);
    } finally {
      globalThis.fetch = realFetch;
    }
    const unknown = await call('/device-specs/map', { spec_id: add.json.spec_id, models: [{ brand: 'Nope', model: 'x' }] });
    assert.equal(unknown.status, 400);
  } finally {
    server.close();
  }
});
