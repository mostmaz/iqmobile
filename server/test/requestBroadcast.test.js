// Who a new device request reaches.
//
// The rule this pins is asymmetric on purpose: a SHOP is a lead because it
// is nearby or because it sells the brand; an INDIVIDUAL only because they
// sell the brand. There are orders of magnitude more individuals than shops
// in any governorate, so "lives in Baghdad" as a trigger is the
// everyone-in-the-country blast MAX_BROADCAST exists to prevent.
//
// An HTTP test, because the selection is a SQL query with four COALESCE
// guards in it, and the guards are the part that breaks: they exist for
// shop columns that are NULL on an individual's row, so a stricter
// comparison silently drops every individual instead of every hidden shop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-bcast-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');

const NOW = Date.now();

let uid = 100;
function user({ type = 'individual', gov = 'Baghdad', guest = 0, extra = {} } = {}) {
  const id = uid++;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, is_guest, created_at)
              VALUES(?, ?, 'x', ?, ?, ?, ?, ?)`)
    .run(id, `0770000${String(id).padStart(4, '0')}`, `u${id}`, gov, type, guest, NOW);
  for (const [k, v] of Object.entries(extra)) {
    db.prepare(`UPDATE users SET ${k}=? WHERE id=?`).run(v, id);
  }
  return id;
}

let lid = 1000;
function listing(sellerId, brand, model, price, status = 'active') {
  const id = lid++;
  db.prepare(`INSERT INTO phone_listings
    (id, seller_id, brand, model, condition, asking_price, governorate, status,
     created_at, updated_at, expires_at)
    VALUES(?, ?, ?, ?, 'used', ?, 'Baghdad', ?, ?, ?, ?)`)
    .run(id, sellerId, brand, model, price, status, NOW, NOW, NOW + 30 * 86400000);
  return id;
}

// The request every case below is measured against.
const BUYER = user();
const REQUEST = {
  id: 1, buyer_id: BUYER, brand: 'Samsung', model: 'Galaxy S24',
  max_price: 500000, governorate: 'Baghdad',
};

// ── the cast ────────────────────────────────────────────────────────────
// Individuals
const INDIV_SELLS_BRAND = user();          // sold a Samsung → reachable
listing(INDIV_SELLS_BRAND, 'Samsung', 'Galaxy A54', 300000, 'sold');
const INDIV_SAME_GOV_ONLY = user();        // Baghdad, never sold Samsung → NOT
const INDIV_OTHER_BRAND = user();          // sold an Apple → NOT
listing(INDIV_OTHER_BRAND, 'Apple', 'iPhone 12', 400000);
const INDIV_GUEST = user({ guest: 1 });    // guest → NOT, whatever they sold
listing(INDIV_GUEST, 'Samsung', 'Galaxy A14', 200000);
// Shops
const SHOP_SAME_GOV = user({ type: 'shop' });                       // → yes
const SHOP_SAME_GOV_SELLS = user({ type: 'shop' });                 // → yes
listing(SHOP_SAME_GOV_SELLS, 'Samsung', 'Galaxy S24 Ultra', 480000);
const SHOP_FAR_SELLS_BRAND = user({ type: 'shop', gov: 'Basra' });  // → yes
listing(SHOP_FAR_SELLS_BRAND, 'Samsung', 'Galaxy S23', 450000);
const SHOP_FAR_NO_BRAND = user({ type: 'shop', gov: 'Basra' });     // → NOT
const SHOP_HIDDEN = user({ type: 'shop', extra: { shop_hidden: 1 } });
const SHOP_ADMIN = user({ type: 'shop', extra: { shop_origin: 'admin' } });

const { __testables } = await import('../src/routes/phoneRequests.js');
const reach = (exclude = new Map()) =>
  new Set(__testables.sellersToBroadcast(REQUEST, exclude).map((s) => s.id));

test('an individual who has sold the brand is reached', () => {
  // The whole point of the change: most phones here change hands between
  // people, so a person with a Samsung history is a real lead.
  assert.ok(reach().has(INDIV_SELLS_BRAND));
});

test('an individual is NOT reached for merely living in the governorate', () => {
  // A shop nearby is a lead; a person nearby is a stranger. Reversing this
  // turns one request into a push to a third of the country.
  const r = reach();
  assert.ok(!r.has(INDIV_SAME_GOV_ONLY));
  assert.ok(!r.has(INDIV_OTHER_BRAND), 'a different brand is not a signal either');
});

test('a shop IS reached for merely being in the governorate', () => {
  assert.ok(reach().has(SHOP_SAME_GOV));
});

test('a distant shop that sells the brand is still reached', () => {
  assert.ok(reach().has(SHOP_FAR_SELLS_BRAND));
});

test('a shop with neither signal is a bystander, not a lead', () => {
  assert.ok(!reach().has(SHOP_FAR_NO_BRAND));
});

test('guests are never reached, brand history or not', () => {
  // A guest row's phone is synthetic — nobody is behind it to answer.
  assert.ok(!reach().has(INDIV_GUEST));
});

test('hidden and admin-made shops stay excluded', () => {
  // These guards are COALESCE-based so they pass an individual's NULLs
  // through; a stricter comparison would drop every individual instead.
  const r = reach();
  assert.ok(!r.has(SHOP_HIDDEN));
  assert.ok(!r.has(SHOP_ADMIN));
});

test('the buyer is never told about their own request', () => {
  assert.ok(!reach().has(BUYER));
});

test('sellers already alerted about a matching listing are not alerted twice', () => {
  const exclude = new Map([[INDIV_SELLS_BRAND, { listing_id: 1 }]]);
  assert.ok(!reach(exclude).has(INDIV_SELLS_BRAND));
});

test('signal beats seller type: a nearby individual who sells the brand outranks a nearby shop that does not', () => {
  // The ordering is by evidence first. A shop is not automatically the
  // better lead — a person who has actually sold this brand is.
  const ordered = __testables.sellersToBroadcast(REQUEST, new Map()).map((s) => s.id);
  assert.ok(ordered.indexOf(INDIV_SELLS_BRAND) < ordered.indexOf(SHOP_SAME_GOV));
});

test('at EQUAL signal the shop sorts first', () => {
  // Both nearby, both sell the brand. The shop survives a MAX_BROADCAST cut
  // first, because answering a request is a shop's job and a person's favour.
  const ordered = __testables.sellersToBroadcast(REQUEST, new Map()).map((s) => s.id);
  assert.ok(ordered.indexOf(SHOP_SAME_GOV_SELLS) < ordered.indexOf(INDIV_SELLS_BRAND));
});

test('each recipient carries whether it is a shop, for the copy', () => {
  // «طلب جديد يناسب متجرك» sent to someone with no shop is the app talking
  // to a different person than the one reading it.
  const rows = __testables.sellersToBroadcast(REQUEST, new Map());
  assert.equal(rows.find((s) => s.id === SHOP_SAME_GOV).is_shop, true);
  assert.equal(rows.find((s) => s.id === INDIV_SELLS_BRAND).is_shop, false);
});
