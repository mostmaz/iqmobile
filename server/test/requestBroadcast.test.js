// Who a new device request reaches.
//
// The rule is graded, and the grading is the point. Production showed what
// the old flat "ever listed this brand?" test bought: every request hit the
// 40-recipient ceiling, and an audit of who got them found almost everyone
// had a single listing of that brand, often already sold, often in another
// governorate. 1,958 request notifications in a week produced 13 offers.
//
// So these tests care less about "is X reached" and more about ORDER and
// LENGTH: that holding the actual phone beats having sold the brand, that
// the newest listing wins, and that the list is allowed to be short.
//
// An HTTP-free test against the real DB, because the selection is a SQL
// query plus a JS fold and the interesting failures live in the seam.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-bcast-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');

const NOW = Date.now();
const DAY = 86400000;

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
function listing(sellerId, brand, model, { price = 300000, status = 'active', ageDays = 1 } = {}) {
  const id = lid++;
  const at = NOW - ageDays * DAY;
  db.prepare(`INSERT INTO phone_listings
    (id, seller_id, brand, model, condition, asking_price, governorate, status,
     created_at, updated_at, expires_at)
    VALUES(?, ?, ?, ?, 'used', ?, 'Baghdad', ?, ?, ?, ?)`)
    .run(id, sellerId, brand, model, price, status, at, at, NOW + 30 * DAY);
  return id;
}

// The request every case below is measured against. Priced high so the
// budget never accidentally becomes the thing under test.
const BUYER = user();
const REQUEST = {
  id: 1, buyer_id: BUYER, brand: 'Samsung', model: 'Galaxy S24',
  max_price: 5_000_000, governorate: 'Baghdad',
};

const { __testables } = await import('../src/routes/phoneRequests.js');
const pick = (exclude = new Map()) => __testables.sellersToBroadcast(REQUEST, exclude);
const ids = (exclude = new Map()) => pick(exclude).map((s) => s.id);

test.beforeEach(() => {
  db.prepare('DELETE FROM phone_listings').run();
  db.prepare('DELETE FROM users WHERE id <> ?').run(BUYER);
});

// ── the three tightenings ──────────────────────────────────────────────

test('selling the phone STOPS the alerts about it', () => {
  // The old rule counted status='sold', so the one moment you are provably
  // not a supplier signed you up for alerts forever.
  const gone = user();
  listing(gone, 'Samsung', 'Galaxy S24', { status: 'sold' });
  assert.ok(!ids().includes(gone));
});

test('a reserved listing still counts — it can fall through', () => {
  const holding = user();
  listing(holding, 'Samsung', 'Galaxy S24', { status: 'reserved' });
  assert.ok(ids().includes(holding));
});

test('holding the exact MODEL shuts the brand tier out entirely', () => {
  // «Apple» covers an iPhone 11 and an iPhone 17 Pro Max alike, which is how
  // a request for one reached people holding the other. Once somebody
  // actually has the phone, the people who merely share a manufacturer are
  // not a weaker lead — they are not a lead.
  const brandOnly = user();
  listing(brandOnly, 'Samsung', 'Galaxy A54', { ageDays: 0 });   // newest, wrong model
  const exact = user();
  listing(exact, 'Samsung', 'Galaxy S24', { ageDays: 30 });      // older, right model
  assert.deepEqual(ids(), [exact],
    'recency does not promote the wrong phone past the right one');
});

test('the list is allowed to be SHORT', () => {
  // Two people hold the phone and there are no local shops: two people get
  // told. Padding the rest out of the brand tier is what taught everyone to
  // ignore these.
  const a = user(); listing(a, 'Samsung', 'Galaxy S24');
  const b = user(); listing(b, 'Samsung', 'Galaxy S24');
  for (let i = 0; i < 20; i++) {
    const weak = user({ gov: 'Basra' });
    listing(weak, 'Samsung', 'Galaxy A14');
  }
  assert.equal(ids().length, 2);
});

test('with NOBODY holding the phone, the brand tier opens — to the floor only', () => {
  // The one case weak signal earns: no holder anywhere, so reach a handful
  // rather than nobody. Still stops at MIN_BROADCAST, not MAX.
  for (let i = 0; i < 25; i++) {
    const weak = user({ gov: 'Basra' });
    listing(weak, 'Samsung', 'Galaxy A14');
  }
  const n = ids().length;
  assert.ok(n > 0, 'a request with weak signal still reaches someone');
  assert.ok(n <= 8, `topped up to the floor, not the ceiling (got ${n})`);
});

test('the ceiling still holds when everyone genuinely qualifies', () => {
  for (let i = 0; i < 50; i++) {
    const s = user();
    listing(s, 'Samsung', 'Galaxy S24');
  }
  assert.equal(ids().length, 40);
});

// ── recency ────────────────────────────────────────────────────────────

test('the newest listing wins', () => {
  const old = user(); listing(old, 'Samsung', 'Galaxy S24', { ageDays: 90 });
  const fresh = user(); listing(fresh, 'Samsung', 'Galaxy S24', { ageDays: 0 });
  const mid = user(); listing(mid, 'Samsung', 'Galaxy S24', { ageDays: 10 });
  assert.deepEqual(ids(), [fresh, mid, old]);
});

test('a seller is ranked by their NEWEST matching listing, not their oldest', () => {
  const stale = user(); listing(stale, 'Samsung', 'Galaxy S24', { ageDays: 5 });
  const mixed = user();
  listing(mixed, 'Samsung', 'Galaxy S24', { ageDays: 100 });
  listing(mixed, 'Samsung', 'Galaxy S24', { ageDays: 1 });
  assert.deepEqual(ids(), [mixed, stale]);
});

test('a shop breaks a tie, but does not outrank a fresher listing', () => {
  // Answering a request is a shop's job and a person's favour — but that is
  // a tiebreak now, not a trump card.
  const shopOld = user({ type: 'shop' }); listing(shopOld, 'Samsung', 'Galaxy S24', { ageDays: 9 });
  const personNew = user(); listing(personNew, 'Samsung', 'Galaxy S24', { ageDays: 1 });
  assert.deepEqual(ids(), [personNew, shopOld]);

  db.prepare('DELETE FROM phone_listings').run();
  const shopTie = user({ type: 'shop' }); listing(shopTie, 'Samsung', 'Galaxy S24', { ageDays: 3 });
  const personTie = user(); listing(personTie, 'Samsung', 'Galaxy S24', { ageDays: 3 });
  assert.equal(ids()[0], shopTie, 'at equal recency the shop sorts first');
});

// ── the guards that were already right ─────────────────────────────────

test('a nearby shop is still a lead with nothing listed', () => {
  const shop = user({ type: 'shop' });
  assert.ok(ids().includes(shop));
});

test('an individual is NOT reached for merely living in the governorate', () => {
  const neighbour = user();
  assert.ok(!ids().includes(neighbour));
});

test('a distant shop with no stock is a bystander, not a lead', () => {
  const far = user({ type: 'shop', gov: 'Basra' });
  assert.ok(!ids().includes(far));
});

test('guests are never reached, stock or not', () => {
  const guest = user({ guest: 1 });
  listing(guest, 'Samsung', 'Galaxy S24');
  assert.ok(!ids().includes(guest));
});

test('hidden and admin-made shops stay excluded', () => {
  // COALESCE-based guards, so they must pass an individual's NULLs through;
  // a stricter comparison would drop every individual instead.
  const hidden = user({ type: 'shop', extra: { shop_hidden: 1 } });
  const pending = user({ type: 'shop', extra: { shop_status: 'pending' } });
  const silent = user({ type: 'shop', extra: { shop_no_contact: 1 } });
  const admin = user({ type: 'shop', extra: { shop_origin: 'admin' } });
  for (const id of [hidden, pending, silent, admin]) listing(id, 'Samsung', 'Galaxy S24');
  const got = ids();
  for (const id of [hidden, pending, silent, admin]) assert.ok(!got.includes(id));
});

test('the buyer is never told about their own request', () => {
  listing(BUYER, 'Samsung', 'Galaxy S24');
  assert.ok(!ids().includes(BUYER));
});

test('sellers already alerted about a matching listing are not alerted twice', () => {
  const dup = user();
  listing(dup, 'Samsung', 'Galaxy S24');
  assert.ok(!ids(new Map([[dup, { listing_id: 1 }]])).includes(dup));
});

test('each recipient carries whether it is a shop, for the copy', () => {
  // «طلب جديد يناسب متجرك» sent to someone with no shop is the app talking
  // to a different person than the one reading it.
  const shop = user({ type: 'shop' }); listing(shop, 'Samsung', 'Galaxy S24');
  const person = user(); listing(person, 'Samsung', 'Galaxy S24');
  const rows = pick();
  assert.equal(rows.find((s) => s.id === shop).is_shop, true);
  assert.equal(rows.find((s) => s.id === person).is_shop, false);
});

test('the model match folds scripts, like everything else', () => {
  // «جالكسي اس ٢٤» and "Galaxy S24" are the same phone.
  const ar = user();
  listing(ar, 'Samsung', 'جالكسي اس ٢٤');
  assert.ok(ids().includes(ar));
});
