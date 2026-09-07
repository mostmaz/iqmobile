// The three price states.
//
// Every assertion here is a site that was live-broken: a call-for-price
// listing rendering its sentinel asking_price of 1 as «١ د.ع».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOnRequest, isNegotiable, priceText, ON_REQUEST_LABEL } from '../src/lib/priceMode.ts';

const fmt = (n: number) => n.toLocaleString('en-US');

test('the sentinel price never reaches the screen as a price', () => {
  // The bug: asking_price is 1 for a call-for-price listing, and both the
  // detail page and the card formatted it. One dinar for an iPhone.
  assert.equal(priceText({ asking_price: 1, price_on_request: 1 }, fmt), null);
  assert.equal(priceText({ asking_price: 1, price_on_request: true }, fmt), null);
});

test('the column is an INTEGER, so 0/1 must work as well as booleans', () => {
  assert.equal(isOnRequest({ price_on_request: 1 }), true);
  assert.equal(isOnRequest({ price_on_request: true }), true);
  assert.equal(isOnRequest({ price_on_request: 0 }), false);
  assert.equal(isOnRequest({ price_on_request: false }), false);
  assert.equal(isOnRequest({}), false);
  assert.equal(isOnRequest(null), false);
});

test('a real price is returned formatted', () => {
  assert.equal(priceText({ asking_price: 375000 }, fmt), '375,000');
});

test('a missing or nonsense price is null, never a formatted zero', () => {
  for (const p of [null, undefined, 0, -5, NaN, 'abc' as any]) {
    assert.equal(priceText({ asking_price: p as any }, fmt), null, String(p));
  }
});

test('on-request outranks negotiable — there is no number to negotiate', () => {
  assert.equal(isNegotiable({ price_on_request: 1, price_mode: 'negotiable' }), false);
});

test('negotiable is opt-in; a listing with no mode is fixed', () => {
  assert.equal(isNegotiable({ asking_price: 100, price_mode: 'negotiable' }), true);
  assert.equal(isNegotiable({ asking_price: 100, price_mode: 'fixed' }), false);
  assert.equal(isNegotiable({ asking_price: 100 }), false);
  assert.equal(isNegotiable({ asking_price: 100, price_mode: null }), false);
});

test('there is exactly one phrase for "no public price"', () => {
  // The app had three. Three phrasings read as three different rules.
  assert.equal(ON_REQUEST_LABEL, 'السعر عند الطلب');
});
