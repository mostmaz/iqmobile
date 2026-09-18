// The seller's price box.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOfferPrice, parseOfferPrice, checkOfferPrice, MIN_OFFER_IQD } from '../src/lib/offerPrice.ts';

test('grouping appears as the seller types', () => {
  assert.equal(formatOfferPrice('2'), '2');
  assert.equal(formatOfferPrice('200'), '200');
  assert.equal(formatOfferPrice('200000'), '200,000');
  assert.equal(formatOfferPrice('1250000'), '1,250,000');
});

test('re-formatting what is already formatted is stable', () => {
  // The box feeds its own value back on every keystroke.
  assert.equal(formatOfferPrice('200,000'), '200,000');
  assert.equal(formatOfferPrice(formatOfferPrice('850000')), '850,000');
});

test('an Arabic-Indic keyboard is folded, not rejected', () => {
  // A phone set to Arabic produces these, and the seller should not have to
  // notice which numerals they are typing.
  assert.equal(formatOfferPrice('٢٠٠٠٠٠'), '200,000');
  assert.equal(parseOfferPrice('٨٥٠٬٠٠٠'), 850000);
});

test('stray characters are dropped rather than breaking the box', () => {
  // The keyboard is phone-pad, so it also offers + * # and a space.
  assert.equal(formatOfferPrice('200*000'), '200,000');
  assert.equal(formatOfferPrice('+200 000'), '200,000');
  assert.equal(formatOfferPrice(''), '');
  assert.equal(formatOfferPrice('abc'), '');
});

test('leading zeros do not survive', () => {
  assert.equal(formatOfferPrice('000200000'), '200,000');
  assert.equal(formatOfferPrice('0'), '0');
});

test('parse and format agree', () => {
  assert.equal(parseOfferPrice('200,000'), 200000);
  assert.ok(Number.isNaN(parseOfferPrice('')));
});

test('«200» is caught before it is sent', () => {
  const v = checkOfferPrice(200, 800000);
  assert.equal(v.ok, false);
  assert.equal((v as any).code, 'price_too_low');
});

test('the floor matches the server exactly', () => {
  assert.equal(MIN_OFFER_IQD, 20000);
  assert.equal(checkOfferPrice(MIN_OFFER_IQD - 1, null).ok, false);
  assert.equal(checkOfferPrice(MIN_OFFER_IQD, null).ok, true);
});

test('over the cap is confirmable, not fatal', () => {
  const v = checkOfferPrice(900000, 800000);
  assert.equal(v.ok, false);
  assert.equal((v as any).code, 'above_cap');
  assert.equal((v as any).confirmable, true);
  assert.match((v as any).message, /800,000/);
});

test('at or under the cap passes, and an unknown cap blocks nothing', () => {
  assert.equal(checkOfferPrice(800000, 800000).ok, true);
  assert.equal(checkOfferPrice(900000, null).ok, true);
  assert.equal(checkOfferPrice(900000, undefined).ok, true);
});

test('an empty box is its own message, not «too low»', () => {
  const v = checkOfferPrice(NaN, 800000);
  assert.equal((v as any).code, 'bad_price');
});
