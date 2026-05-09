import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsPhoneNumber, maskPhoneNumbers, detectPhoneNumbers } from '../src/phoneMask.js';

test('detects standard Iraqi mobile: 07700001234', () => {
  assert.ok(containsPhoneNumber('سعري النهائي 500 — اتصل بي 07700001234'));
});

test('detects international form: +9647700001234', () => {
  assert.ok(containsPhoneNumber('whatsapp +9647700001234 please'));
});

test('detects 00964 prefix', () => {
  assert.ok(containsPhoneNumber('عبر 009647500001234'));
});

test('detects with spaces and dashes: 0770 000 1234', () => {
  assert.ok(containsPhoneNumber('رقمي 0770-000-1234 مكتوب بالشرطات'));
});

test('detects Arabic-Indic digits: ٠٧٧٠٠٠٠١٢٣٤', () => {
  assert.ok(containsPhoneNumber('اتصل بي ٠٧٧٠٠٠٠١٢٣٤ لو سمحت'));
});

test('handles look-alike letters: 077O0OO12 34 (Os and spaces)', () => {
  // exactly the kind of evasion we expect: O instead of 0
  assert.ok(containsPhoneNumber('07700O01234 رقمي'));
});

test('does not flag short prices like "500000"', () => {
  // 6-digit price — not a phone (we require 9-15 digits)
  assert.equal(containsPhoneNumber('السعر 500000 د.ع فقط'), false);
});

test('does not flag a single 8-digit identifier', () => {
  assert.equal(containsPhoneNumber('رقم الفاتورة 12345678'), false);
});

test('mask: replaces detected number with ████', () => {
  const out = maskPhoneNumbers('اتصل بي 07700001234 الآن');
  assert.ok(/█/.test(out));
  assert.ok(!/07700001234/.test(out));
  assert.ok(out.includes('اتصل بي'));
});

test('mask: leaves text without numbers untouched', () => {
  const s = 'متى نتفاوض على السعر؟';
  assert.equal(maskPhoneNumbers(s), s);
});

test('detect: returns digit-only summary', () => {
  const m = detectPhoneNumbers('رقمي 0770-000-1234 خدماتي');
  assert.equal(m.length, 1);
  assert.equal(m[0].digits, '07700001234');
});
