// The daily device-name pass against the real seeded catalogue and the
// committed GSMArena index: what it decides on its own, and what it must
// leave for a person.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-daily-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const { runDeviceNameDaily, decideDevice, dueToday, lastDeviceNameReport } = await import('../src/deviceNameDaily.js');

const t0 = Date.now();
for (const b of ['Apple', 'Samsung', 'Redmi', 'POCO', 'Xiaomi', 'Honor', 'Infinix', 'Tecno', 'Other']) {
  db.prepare('INSERT OR IGNORE INTO brands(name, display_ar, position, created_at) VALUES(?,?,?,?)').run(b, b, 99, t0);
}
const uid = db.prepare(
  "INSERT INTO users(phone, password_hash, display_name, governorate, created_at) VALUES('07700000001','x','seller','Baghdad',1)",
).run().lastInsertRowid;
const listing = (brand, model, extra = {}) => db.prepare(
  `INSERT INTO phone_listings(seller_id, brand, model, condition, asking_price, governorate, status, created_at, expires_at, updated_at, product_type)
   VALUES(?,?,?,'used',100000,'Baghdad','active',?,?,?,?)`,
).run(uid, brand, model, t0, t0 + 1e9, t0, extra.product_type || null).lastInsertRowid;
const suggest = (brand, model, type = 'phone') => db.prepare(
  'INSERT INTO device_suggestions(user_id, brand, device_type, model, created_at) VALUES(?,?,?,?,?)',
).run(uid, brand, type, model, t0).lastInsertRowid;
const sugg = (id) => db.prepare('SELECT * FROM device_suggestions WHERE id=?').get(id);
const lst = (id) => db.prepare('SELECT brand, model FROM phone_listings WHERE id=?').get(id);
const inCatalog = (b, m) => !!db.prepare('SELECT 1 FROM device_catalog WHERE brand=? AND model=?').get(b, m);

test('the seeded catalogue is there', () => {
  assert.ok(db.prepare('SELECT COUNT(*) n FROM device_catalog').get().n > 1000);
  assert.ok(inCatalog('Apple', 'iPhone 13 Pro Max'));
});

test('decideDevice: Arabic for a catalogue device is "existing", never a new row', () => {
  const d = decideDevice('Apple', 'ايفون 13 برو ماكس', 'phone');
  assert.equal(d.action, 'existing');
  assert.equal(d.model, 'iPhone 13 Pro Max');
});

test('decideDevice: brand typed in front moves to the brand', () => {
  const d = decideDevice('Xiaomi', 'Poco X7 Pro', 'phone');
  assert.equal(d.action, 'existing');
  assert.equal(d.brand, 'POCO');
});

test('decideDevice: accessories and bare brands are rejected', () => {
  assert.equal(decideDevice('Apple', 'Apple pencil', 'phone').action, 'reject');
  assert.equal(decideDevice('Samsung', 'سامسونك', 'phone').action, 'reject');
});

test('decideDevice: a non-device sentence stays for a person', () => {
  assert.equal(decideDevice('Other', 'جهاز ممتاز 2 شريحة 17 ملم', 'phone').action, 'undecided');
});

test('the pass: suggestions, catalogue junk, listings', () => {
  // catalogue junk that came in through the dashboard
  const ins = db.prepare("INSERT INTO device_catalog(brand, device_type, model, source, created_at) VALUES(?,?,?,'suggestion',?)");
  const arab = ins.run('Apple', 'phone', 'ايفون ١٣', t0).lastInsertRowid;
  const wrong = ins.run('Xiaomi', 'phone', 'Poco X7 Pro', t0).lastInsertRowid;
  const dup = ins.run('Apple', 'phone', 'iphone 13 pro max', t0).lastInsertRowid;

  const s1 = suggest('Apple', 'ايفون 13 برو ماكس');
  const s2 = suggest('Apple', 'Apple pencil');
  const s3 = suggest('Other', 'جهاز ممتاز 2 شريحة 17 ملم');
  const l1 = listing('Apple', 'ايفون 13 برو ماكس ذاكره 256 بطاريه 98');
  const l2 = listing('Xiaomi', 'Poco X7 Pro');
  const l3 = listing('Apple', 'ايفون 7 بلس');       // must NOT become iPhone 7
  const l4 = listing('Apple', 'AirPods Pro 2', { product_type: 'accessory' });

  const dry = runDeviceNameDaily({ apply: false, now: t0 });
  assert.equal(sugg(s1).status, 'pending', 'dry run writes nothing');

  const r = runDeviceNameDaily({ apply: true, now: t0 });
  assert.equal(dry.summary.listings_renamed, r.summary.listings_renamed);

  assert.ok(!db.prepare('SELECT 1 FROM device_catalog WHERE id=?').get(arab), 'Arabic row removed');
  assert.ok(!db.prepare('SELECT 1 FROM device_catalog WHERE id=?').get(wrong), 'wrong-brand dup removed');
  assert.ok(!db.prepare('SELECT 1 FROM device_catalog WHERE id=?').get(dup), 'case dup removed');

  assert.equal(sugg(s1).status, 'approved');
  assert.equal(sugg(s1).model, 'iPhone 13 Pro Max');
  assert.equal(sugg(s2).status, 'rejected');
  assert.equal(sugg(s3).status, 'pending');

  assert.deepEqual(lst(l1), { brand: 'Apple', model: 'iPhone 13 Pro Max' });
  assert.deepEqual(lst(l2), { brand: 'POCO', model: 'X7 Pro' });
  assert.equal(lst(l3).model === 'iPhone 7', false);
  assert.equal(lst(l4).model, 'AirPods Pro 2');

  assert.ok(lastDeviceNameReport().summary);

  // second run: nothing left to do
  const again = runDeviceNameDaily({ apply: true, now: t0 + 1 });
  assert.equal(again.summary.listings_scanned, 0);
  assert.equal(again.summary.catalog_removed, 0);
  assert.equal(again.summary.suggestions_left, 1);
});

test('schedule: once per Baghdad day, from 04:00', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(dueToday(at('2026-10-01T00:30:00Z'), null), null);           // 03:30 Baghdad
  assert.equal(dueToday(at('2026-10-01T01:05:00Z'), null), '2026-10-01');   // 04:05
  assert.equal(dueToday(at('2026-10-01T20:00:00Z'), '2026-10-01'), null);   // already ran
  assert.equal(dueToday(at('2026-10-01T22:00:00Z'), '2026-10-01'), null);          // 01:00 next day, too early
  assert.equal(dueToday(at('2026-10-02T01:00:00Z'), '2026-10-01'), '2026-10-02'); // 04:00 next day
});
