// What may become a paid message.
//
// Every case below is a string the OLD code accepted and forwarded to ARQAM as
// +964…, at $0.02–$0.18 each. The width of this check is the width of the
// attack surface, so the rejections matter more than the acceptances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIraqiMobile, isIraqiMobile, toE164 } from '../src/iraqiPhone.js';

test('the local form round-trips', () => {
  assert.equal(normalizeIraqiMobile('07701234567'), '07701234567');
  assert.equal(toE164('07701234567'), '+9647701234567');
});

test('the ways people actually type a number all normalise', () => {
  for (const input of [
    '+9647701234567', '00964 770 123 4567', '964-770-123-4567',
    '0770 123 4567', '0770-123-4567', '(0770) 1234567', ' 07701234567 ',
  ]) {
    assert.equal(normalizeIraqiMobile(input), '07701234567', input);
  }
});

test('Arabic-Indic digits are a real thing Iraqi users type', () => {
  assert.equal(normalizeIraqiMobile('٠٧٧٠١٢٣٤٥٦٧'), '07701234567');
  assert.equal(normalizeIraqiMobile('۰۷۷۰۱۲۳۴۵۶۷'), '07701234567');
});

test('every live carrier prefix is accepted', () => {
  // Rejecting a prefix Iraq actually allocated turns a paying customer into
  // someone who cannot sign in, so this list stays generous.
  for (const p of ['073', '074', '075', '077', '078', '079']) {
    assert.equal(isIraqiMobile(`${p}01234567`), true, p);
  }
});

test('the exact strings the old check waved through are refused', () => {
  // normalizePhone was `length >= 10 && length <= 12` with no prefix check.
  for (const bad of [
    '0123456789',      // 10 digits, landline-shaped
    '012345678901',    // 12 digits, nothing like a mobile
    '0751234567',      // 10 digits — one short of a real Korek number
    '077012345678',    // 12 digits — one too many
    '06701234567',     // not the 07 mobile trunk
    '01812345678',     // Baghdad landline
    '00000000000',
  ]) {
    assert.equal(normalizeIraqiMobile(bad), null, `${bad} must not be billable`);
    assert.equal(toE164(bad), null, `${bad} must not reach the provider`);
  }
});

test('a landline can never be billed — it cannot receive WhatsApp anyway', () => {
  assert.equal(isIraqiMobile('017901234'), false);
  assert.equal(isIraqiMobile('06012345678'), false);
});

test('junk of any shape is null, never a throw', () => {
  for (const junk of [null, undefined, '', '   ', 'abc', '+', 42, {}, []]) {
    assert.equal(normalizeIraqiMobile(junk), null, JSON.stringify(junk));
  }
});

test('stray letters are stripped like any other separator', () => {
  // Non-digits are removed before judging, which is the same rule that makes
  // "(0770) 123-4567" work. The result is the SAME number, so accepting it is
  // correct rather than lax — and it opens no bypass, because the rate limiter
  // keys on this normalised form. Every spelling of a number shares one bucket.
  assert.equal(normalizeIraqiMobile('07x7y0z1234567'), '07701234567');
  assert.equal(normalizeIraqiMobile('0770abc1234567'), '07701234567');
});

test('all spellings of one number collapse to one rate-limit key', () => {
  // The property the limiter depends on: an attacker cannot buy extra sends
  // by dressing the same number up differently.
  const spellings = [
    '07701234567', '+9647701234567', '00964 770 123 4567',
    '0770-123-4567', '٠٧٧٠١٢٣٤٥٦٧', ' (0770) 1234567 ',
  ];
  const keys = new Set(spellings.map(normalizeIraqiMobile));
  assert.equal(keys.size, 1, [...keys].join(' | '));
});
