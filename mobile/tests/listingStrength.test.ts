import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingStrength, strengthChipLabel } from '../src/lib/listingStrength.ts';

const note = (id: string) => ({ id, step: 0, title: id, hint: '' });

test('nothing open is a complete listing', () => {
  const s = listingStrength([], 8);
  assert.equal(s.score, 100);
  assert.equal(s.band, 'strong');
});

test('one note left is never 100%', () => {
  // On a long checklist the rounding would otherwise reach 100 with a note
  // still showing two lines below — the app contradicting itself.
  const s = listingStrength([note('a')], 200);
  assert.ok(s.score < 100, `got ${s.score}`);
  assert.equal(s.score, 99);
});

test('a seller who has done nothing still sees a beginning, not a zero', () => {
  // They have already picked a brand and a model to get here. 0% at the
  // moment someone decides whether the form is worth finishing is both false
  // and discouraging.
  const s = listingStrength([note('a'), note('b'), note('c')], 3);
  assert.equal(s.score, 20);
  assert.equal(s.band, 'weak');
});

test('the score tracks how much is left', () => {
  assert.equal(listingStrength([note('a')], 4).score, 75);
  assert.equal(listingStrength([note('a'), note('b')], 4).score, 50);
});

test('more issues than checks cannot drive the score negative', () => {
  // listingQuality can raise two notes about one field; the denominator is
  // an estimate, not a contract.
  const s = listingStrength([note('a'), note('b'), note('c')], 2);
  assert.ok(s.score >= 20 && s.score <= 99, `got ${s.score}`);
});

test('a zero denominator does not divide by zero', () => {
  const s = listingStrength([], 0);
  assert.equal(Number.isFinite(s.score), true);
  assert.equal(s.score, 100);
});

test('the chip counts, and counts in Arabic grammar', () => {
  // «١ ملاحظات» is wrong in a way a native reader notices immediately.
  assert.equal(strengthChipLabel(0), 'مكتمل');
  assert.equal(strengthChipLabel(1), 'ملاحظة واحدة');
  assert.equal(strengthChipLabel(2), 'ملاحظتان');
  assert.equal(strengthChipLabel(3), '٣ ملاحظات');
});
