// Alternatives offered when a search finds nothing.
//
// The property that matters most is that a count is never a promise the tap
// can't keep: whatever number is shown must be what applying that filter
// actually returns. Several tests below assert exactly that by re-running the
// suggested filter and comparing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { searchAlternatives, BUDGET_SLACK } from '../src/searchAlternatives.js';
import { GOV_NEIGHBOURS, neighboursOf } from '../src/governorates.js';
import { GOVERNORATES } from '../src/governorates.js';

const NOW = Date.parse('2026-09-07T12:00:00+03:00');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE phone_listings(
    id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT, model TEXT, storage TEXT,
    condition TEXT, asking_price INTEGER, governorate TEXT, status TEXT,
    is_draft INTEGER DEFAULT 0, expires_at INTEGER);`);
  const ins = db.prepare(
    `INSERT INTO phone_listings(brand,model,storage,condition,asking_price,governorate,status,is_draft,expires_at)
     VALUES(@brand,@model,@storage,@condition,@price,@gov,@status,@draft,@expires)`);
  const add = (o) => ins.run({
    brand: 'Apple', model: 'iPhone 13', storage: '128GB', condition: 'used',
    price: 700000, gov: 'Baghdad', status: 'active', draft: 0,
    expires: NOW + 86400000, ...o,
  });
  return { db, add };
}

const opts = { now: NOW, neverExpire: true };

test('nothing to offer when nothing else exists either', () => {
  const { db } = fixture();
  assert.deepEqual(searchAlternatives(db, { brand: 'Apple', governorate: 'Baghdad' }, opts), []);
});

test('a bordering governorate is offered with a true count', () => {
  const { db, add } = fixture();
  add({ gov: 'Babil' }); add({ gov: 'Babil' });   // Babil borders Baghdad
  add({ gov: 'Basra' });                          // Basra does not
  const alts = searchAlternatives(db, { brand: 'Apple', model: 'iPhone 13', governorate: 'Baghdad' }, opts);
  const govs = alts.filter((a) => a.kind === 'governorate');
  assert.deepEqual(govs.map((a) => a.value), ['Babil'], 'only neighbours, and Basra is not one');
  assert.equal(govs[0].count, 2);
  assert.deepEqual(govs[0].apply, { governorate: 'Babil' });
});

test('neighbours are ordered by how much stock they have', () => {
  const { db, add } = fixture();
  add({ gov: 'Wasit' });
  for (let i = 0; i < 4; i++) add({ gov: 'Babil' });
  for (let i = 0; i < 2; i++) add({ gov: 'Diyala' });
  const govs = searchAlternatives(db, { brand: 'Apple', governorate: 'Baghdad' }, opts)
    .filter((a) => a.kind === 'governorate');
  assert.deepEqual(govs.map((a) => a.value), ['Babil', 'Diyala', 'Wasit']);
});

test('a wider budget is offered at the real widened ceiling, never beyond it', () => {
  const { db, add } = fixture();
  add({ price: 780000 });   // 11% over 700k — inside the 20% slack
  add({ price: 900000 });   // 29% over — outside
  const alts = searchAlternatives(db, { brand: 'Apple', governorate: 'Baghdad', max_price: 700000 }, opts);
  const budget = alts.find((a) => a.kind === 'budget');
  assert.ok(budget, 'the 780k listing is reachable, so the option must appear');
  assert.equal(budget.value, Math.round(700000 * BUDGET_SLACK));
  assert.equal(budget.count, 1, 'the 900k listing is out of reach and must not be counted');
  assert.deepEqual(budget.apply, { max_price: 840000 });
});

test('another storage size is offered only from values that really exist', () => {
  const { db, add } = fixture();
  add({ storage: '256GB' }); add({ storage: '256GB' }); add({ storage: '512GB' });
  const alts = searchAlternatives(db, { brand: 'Apple', model: 'iPhone 13', storage: '128GB' }, opts);
  const st = alts.filter((a) => a.kind === 'storage');
  // Taken from the rows, not a hardcoded ladder — the server matches storage
  // exactly, so an invented '128 GB' would apply to nothing.
  assert.deepEqual(st.map((a) => a.value), ['256GB', '512GB']);
  assert.equal(st[0].count, 2);
});

test('no storage option when the buyer never filtered on storage', () => {
  const { db, add } = fixture();
  add({ storage: '256GB' });
  const alts = searchAlternatives(db, { brand: 'Apple' }, opts);
  assert.equal(alts.filter((a) => a.kind === 'storage').length, 0);
});

test('every count is exactly what applying that filter returns', () => {
  const { db, add } = fixture();
  add({ gov: 'Babil' }); add({ gov: 'Babil' }); add({ gov: 'Diyala' });
  add({ price: 800000 }); add({ storage: '256GB' });
  const filters = { brand: 'Apple', model: 'iPhone 13', governorate: 'Baghdad', storage: '128GB', max_price: 700000 };
  for (const alt of searchAlternatives(db, filters, opts)) {
    // A null in `apply` clears that filter, exactly as qs() treats it.
    const applied = { ...filters, ...alt.apply };
    const where = [];
    const params = [];
    if (applied.brand) { where.push('brand=?'); params.push(applied.brand); }
    if (applied.model) { where.push('model LIKE ?'); params.push(`%${applied.model}%`); }
    if (applied.governorate) { where.push('governorate=?'); params.push(applied.governorate); }
    if (applied.storage) { where.push('storage=?'); params.push(applied.storage); }
    if (Number.isFinite(applied.max_price)) { where.push('asking_price <= ?'); params.push(applied.max_price); }
    const real = db.prepare(
      `SELECT COUNT(*) n FROM phone_listings WHERE status IN ('active','reserved') AND COALESCE(is_draft,0)=0${where.length ? ' AND ' + where.join(' AND ') : ''}`,
    ).get(...params).n;
    assert.equal(alt.count, real, `${alt.kind}/${alt.value} promised ${alt.count} but applying it returns ${real}`);
  }
});

test('drafts, removed and sold listings are never counted', () => {
  const { db, add } = fixture();
  add({ gov: 'Babil', draft: 1 });
  add({ gov: 'Babil', status: 'removed' });
  add({ gov: 'Babil', status: 'sold' });
  const alts = searchAlternatives(db, { brand: 'Apple', governorate: 'Baghdad' }, opts);
  assert.deepEqual(alts, [], 'none of those are things a buyer can actually go and get');
});

test('expiry is honoured when the never-expire setting is off', () => {
  const { db, add } = fixture();
  add({ gov: 'Babil', expires: NOW - 1000 });
  assert.equal(
    searchAlternatives(db, { brand: 'Apple', governorate: 'Baghdad' }, { now: NOW, neverExpire: false }).length,
    0,
  );
  // …and ignored when it is on, matching the browse feed's own default.
  assert.equal(
    searchAlternatives(db, { brand: 'Apple', governorate: 'Baghdad' }, { now: NOW, neverExpire: true }).length,
    1,
  );
});

test('dropping the governorate is offered only when it beats the neighbours', () => {
  const { db, add } = fixture();
  add({ gov: 'Babil' });          // a neighbour, already covered
  const onlyNeighbour = searchAlternatives(db, { brand: 'Apple', governorate: 'Baghdad' }, opts);
  assert.equal(onlyNeighbour.filter((a) => a.kind === 'all_governorates').length, 0,
    'suggesting the whole country to reach the same one listing is noise');

  add({ gov: 'Basra' });          // not a neighbour — only reachable countrywide
  const withFar = searchAlternatives(db, { brand: 'Apple', governorate: 'Baghdad' }, opts);
  const all = withFar.find((a) => a.kind === 'all_governorates');
  assert.ok(all, 'now there is stock a neighbour cannot reach');
  assert.equal(all.count, 2);
  // null, not undefined — JSON.stringify would drop undefined and the tap
  // would clear nothing. Asserted through a round trip so a regression to
  // undefined fails here rather than silently on a device.
  assert.deepEqual(all.apply, { governorate: null });
  assert.deepEqual(JSON.parse(JSON.stringify(all.apply)), { governorate: null });
});

// ── the adjacency table itself ────────────────────────────────────────

test('every governorate has neighbours and every edge is symmetric', () => {
  for (const gov of GOVERNORATES) {
    const near = neighboursOf(gov);
    assert.ok(near.length > 0, `${gov} has no neighbours`);
    for (const other of near) {
      assert.ok(GOVERNORATES.includes(other), `${gov} borders unknown "${other}"`);
      assert.notEqual(other, gov, `${gov} borders itself`);
      // A one-way edge shows a suggestion in one direction only — invisible
      // to everyone except the one person who notices.
      assert.ok(
        neighboursOf(other).includes(gov),
        `${gov} → ${other} is not mirrored back`,
      );
    }
    assert.equal(new Set(near).size, near.length, `${gov} lists a neighbour twice`);
  }
  assert.equal(Object.keys(GOV_NEIGHBOURS).length, GOVERNORATES.length);
});
