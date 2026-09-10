// How the request feature's one number is worded.
//
// The reason this is tested at all: an Arabic plural that is off reads as
// machine-written to every user of the app and to nobody reviewing the diff
// in English.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arNum, requestCountAr, resultsCountAr, pulseLine, invitePitch, badgeLabel } from '../src/lib/requestPulse.ts';

test('counts in prose are Arabic-Indic', () => {
  assert.equal(arNum(18), '١٨');
  assert.equal(arNum(0), '٠');
});

test('«طلب» takes all four Arabic number cases', () => {
  assert.equal(requestCountAr(1), 'طلب واحد', 'singular drops the numeral');
  assert.equal(requestCountAr(2), 'طلبان', 'the dual is a word, not «٢ طلب»');
  assert.equal(requestCountAr(3), '٣ طلبات');
  assert.equal(requestCountAr(10), '١٠ طلبات');
  assert.equal(requestCountAr(11), '١١ طلباً', 'past ten it goes back to the singular');
  assert.equal(requestCountAr(18), '١٨ طلباً');
});

test('the subtitle names the city when we know it, and stays quiet when we do not', () => {
  // Claiming «· بغداد» to somebody in Basra is worse than a shorter line.
  assert.equal(pulseLine(18, 'بغداد'), '١٨ طلباً بآخر ٢٤ ساعة · بغداد');
  assert.equal(pulseLine(18, ''), '١٨ طلباً بآخر ٢٤ ساعة');
});

test('an empty day says so rather than «٠ طلبات»', () => {
  assert.ok(pulseLine(0, 'بغداد').startsWith('لا طلبات'));
});

test('the invite quotes a number only when there is one to keep', () => {
  // reach is a floor — shops in your governorate — so the number can be
  // said out loud. At 0 the sentence has to work without it.
  assert.equal(invitePitch(0), 'اطلب الجهاز وخل التجار يشوفون طلبك.');
  assert.ok(invitePitch(124).includes('١٢٤'));
});

test('the invite counts «تاجر» the same four ways', () => {
  assert.ok(invitePitch(1).includes('تاجراً واحداً'));
  assert.ok(invitePitch(2).includes('تاجرين'));
  assert.ok(invitePitch(5).includes('٥ تجار'));
  assert.ok(invitePitch(40).includes('٤٠ تاجراً'));
});

test('no badge is null, not zero', () => {
  // A caller that renders 0 draws an empty red dot on a tab with nothing
  // behind it.
  assert.equal(badgeLabel(0), null);
  assert.equal(badgeLabel(undefined), null);
  assert.equal(badgeLabel(3), '٣');
});

test('the badge caps instead of growing the tab', () => {
  assert.equal(badgeLabel(250), '99+');
});

test('«نتيجة» counts the same four ways, and admits when it does not know', () => {
  assert.equal(resultsCountAr(0), 'لا نتائج');
  assert.equal(resultsCountAr(1), 'نتيجة واحدة');
  assert.equal(resultsCountAr(2), 'نتيجتان');
  assert.equal(resultsCountAr(3), '٣ نتائج');
  assert.equal(resultsCountAr(15), '١٥ نتيجة');
  // A further page may exist, so the exact number is not ours to claim.
  assert.equal(resultsCountAr(15, true), '١٥+ نتيجة');
});
