import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIraqiPhone, toLatinDigits } from '../src/phoneNormalize.js';

// The bug this module exists to fix: five separate copies of this function
// stripped Arabic-Indic digits instead of reading them, so a customer typing
// their number on the default Iraqi keyboard was told it was invalid.
test('accepts Arabic-Indic digits: ٠٧٧٠١٢٣٤٥٦٧', () => {
  assert.equal(normalizeIraqiPhone('٠٧٧٠١٢٣٤٥٦٧'), '07701234567');
});

test('accepts Extended Arabic-Indic (Persian) digits: ۰۷۷۰۱۲۳۴۵۶۷', () => {
  assert.equal(normalizeIraqiPhone('۰۷۷۰۱۲۳۴۵۶۷'), '07701234567');
});

test('accepts Arabic-Indic digits with separators', () => {
  assert.equal(normalizeIraqiPhone('٠٧٧٠-١٢٣ ٤٥٦٧'), '07701234567');
});

test('plain local form is unchanged', () => {
  assert.equal(normalizeIraqiPhone('07701234567'), '07701234567');
});

test('strips +964 / 00964 / 964 prefixes and separators', () => {
  assert.equal(normalizeIraqiPhone('+964 770 123 4567'), '07701234567');
  assert.equal(normalizeIraqiPhone('00964 7701234567'), '07701234567');
  assert.equal(normalizeIraqiPhone('9647701234567'), '07701234567');
});

test('rejects input with no digits, and runs that are too short or too long', () => {
  assert.equal(normalizeIraqiPhone('abc'), null);
  assert.equal(normalizeIraqiPhone(''), null);
  assert.equal(normalizeIraqiPhone(null), null);
  assert.equal(normalizeIraqiPhone('123'), null);
  assert.equal(normalizeIraqiPhone('0770123456789999'), null);
});

test('toLatinDigits folds numerals and leaves other text alone', () => {
  assert.equal(toLatinDigits('رقمي ٠٧٧٠'), 'رقمي 0770');
  assert.equal(toLatinDigits('iPhone 13'), 'iPhone 13');
});
