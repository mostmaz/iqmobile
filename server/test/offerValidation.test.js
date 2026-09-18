// Is this offer a real price, or a typo?
//
// The numbers behind every case: 43 offers ever sent on production as of 18
// Sep 2026, 16 of them under 20,000 IQD, and one at 13,750,000 for a phone
// whose median is 550,000. Sellers type prices the way they say them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOffer, medianListingPrice,
  MIN_OFFER_IQD, ABSURD_MULTIPLE, MIN_SAMPLE,
} from '../src/offerValidation.js';

const ok = (o) => validateOffer({ maxPrice: 800000, median: 550000, ...o });

// ── the floor ──────────────────────────────────────────────────────────

test('«200» meaning 200,000 is rejected, not quietly sent', () => {
  const v = ok({ price: 200 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'price_too_low');
  assert.match(v.message, /السعر يبدو ناقصاً/);
  assert.equal(v.needsConfirm, false, 'not something to confirm past');
});

test('the floor is exclusive at exactly 20,000', () => {
  assert.equal(ok({ price: MIN_OFFER_IQD - 1 }).ok, false);
  assert.equal(ok({ price: MIN_OFFER_IQD }).ok, true);
});

test('zero, negatives and nonsense are rejected before anything else', () => {
  for (const price of [0, -5, NaN, null, undefined, 'abc', '']) {
    const v = ok({ price });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'bad_price', `price=${String(price)}`);
  }
});

test('a decimal is floored, not rounded up past a limit', () => {
  assert.equal(ok({ price: 19999.9 }).ok, false);
  assert.equal(ok({ price: 20000.7 }).ok, true);
});

// ── the ceiling: a warning, not a wall ─────────────────────────────────

test('over the buyer’s cap asks for a second tap and says the cap', () => {
  const v = ok({ price: 900000, maxPrice: 800000 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'above_cap');
  assert.equal(v.needsConfirm, true);
  assert.match(v.message, /800,000/, 'quotes the actual ceiling');
});

test('confirming sends it — a ceiling is an opening position', () => {
  assert.equal(ok({ price: 900000, maxPrice: 800000, confirmedAboveCap: true }).ok, true);
});

test('at exactly the cap there is nothing to confirm', () => {
  assert.equal(ok({ price: 800000, maxPrice: 800000 }).ok, true);
});

test('with no cap known, nothing is blocked on it', () => {
  assert.equal(ok({ price: 900000, maxPrice: null }).ok, true);
  assert.equal(ok({ price: 900000, maxPrice: 0 }).ok, true);
});

// ── the absurd multiple ────────────────────────────────────────────────

test('13,750,000 against a 550,000 median is a keyboard accident', () => {
  const v = ok({ price: 13750000, median: 550000, maxPrice: 800000 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'price_absurd');
  assert.equal(v.needsConfirm, false, 'no confirming past this one');
});

test('the absurd check outranks the cap warning', () => {
  // Both apply; the useful message is the one about the extra digit.
  assert.equal(ok({ price: 13750000, median: 550000, confirmedAboveCap: true }).code, 'price_absurd');
});

test('just inside the multiple is allowed, with a confirm for the cap', () => {
  const v = ok({ price: 550000 * ABSURD_MULTIPLE, median: 550000, maxPrice: 800000 });
  assert.equal(v.code, 'above_cap', 'the multiple did not fire');
});

test('with no median there is no opinion to enforce', () => {
  // A thinly-stocked device must not have honest prices rejected.
  assert.equal(ok({ price: 9000000, median: null, maxPrice: null }).ok, true);
  assert.equal(ok({ price: 9000000, median: 0, maxPrice: null }).ok, true);
});

// ── the median itself ──────────────────────────────────────────────────

test('the median needs a real sample, and folds device names', async () => {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-median-'));
  process.env.DB_PATH = path.join(tmp, 'test.db');
  process.env.JWT_SECRET = 'test-secret';
  const { db } = await import('../src/db.js');
  const { norm } = await import('../src/routes/savedSearches.js');

  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, created_at)
              VALUES(1,'07790000001','x','S','Baghdad',?)`).run(Date.now());
  let id = 1;
  const add = (model, price, status = 'active') => db.prepare(
    `INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price,
      governorate, status, created_at, updated_at, expires_at)
     VALUES(?,1,'Apple',?,'used',?,'Baghdad',?,?,?,?)`,
  ).run(id++, model, price, status, Date.now(), Date.now(), Date.now() + 8.64e7);

  const dev = { brand: 'Apple', model: 'iPhone 13' };
  add('iPhone 13', 500000); add('iPhone 13', 600000); add('iPhone 13', 700000);
  assert.equal(medianListingPrice(db, dev, norm), null, `under ${MIN_SAMPLE} is no sample`);

  add('ايفون ١٣', 400000);   // the Arabic spelling counts toward the same device
  assert.equal(medianListingPrice(db, dev, norm), 550000, 'even count averages the middle two');

  add('iPhone 13 Pro Max', 9000000);   // a different phone must not drag it
  assert.equal(medianListingPrice(db, dev, norm), 550000);

  add('iPhone 13', 1, 'active');        // the call-for-price sentinel
  add('iPhone 13', 800000, 'sold');     // and anything not live
  assert.equal(medianListingPrice(db, dev, norm), 550000);

  assert.equal(medianListingPrice(db, { brand: 'Apple', model: '' }, norm), null);
});
