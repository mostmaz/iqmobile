// Comparison: unknown is a third state, not a value.
//
// Both assertions below describe shipped behaviour that was misleading — a
// vanished row read as "not applicable", and a missing value was tinted as a
// difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  differs, visibleRows, hasAnyValue, cellText, cellIsUnknown, UNKNOWN_LABEL,
} from '../src/lib/compareRows.ts';

const row = (values: any[], kind?: any) => ({ label: 'x', values, kind });

test('one seller answering is not a disagreement', () => {
  // "89%" vs "didn't say" was counted as a difference and tinted. It is one
  // seller answering a question the other ignored.
  assert.equal(differs(row(['٨٩٪', null])), false);
  assert.equal(differs(row([null, 'سنة'])), false);
});

test('two different known values ARE a difference', () => {
  assert.equal(differs(row(['٨٩٪', '٧٤٪'])), true);
});

test('two identical values are not', () => {
  assert.equal(differs(row(['128GB', '128GB'])), false);
});

test('a row nobody answered is not a difference either', () => {
  assert.equal(differs(row([null, null])), false);
  assert.equal(differs(row(['', ''])), false);
});

test('three columns: two agree, one silent — still not a difference', () => {
  assert.equal(differs(row(['بغداد', null, 'بغداد'])), false);
});

test('three columns: one silent, two disagree — a difference', () => {
  assert.equal(differs(row(['بغداد', null, 'أربيل'])), true);
});

test('a seller row survives being entirely empty — "neither said" is the point', () => {
  // Warranty used to vanish when neither listing stated one, and a missing
  // row reads as "not applicable" rather than "nobody told us".
  const rows = [row([null, null], 'seller')];
  assert.equal(visibleRows(rows).length, 1);
});

test('an empty catalogue row is still dropped — that gap is ours, not theirs', () => {
  assert.equal(visibleRows([row([null, null], 'spec')]).length, 0);
  assert.equal(visibleRows([row(['A17', null], 'spec')]).length, 1);
});

test('an unknown cell says so, and is marked so it can be drawn muted', () => {
  assert.equal(cellText(null), UNKNOWN_LABEL);
  assert.equal(cellText(''), UNKNOWN_LABEL);
  assert.equal(cellText('سنة'), 'سنة');
  assert.equal(cellIsUnknown(null), true);
  assert.equal(cellIsUnknown('سنة'), false);
});

test('hasAnyValue ignores empty strings, not just null', () => {
  assert.equal(hasAnyValue(row(['', ''])), false);
  assert.equal(hasAnyValue(row(['', 'x'])), true);
});
