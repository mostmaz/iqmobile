// What a shop is told when it gets the advanced panel.
//
// The approval notification used to read «صار عندك لوحة إدارة متجرك / سجّل
// دخولك للوحة وشوف الأدوات الجديدة» — an announcement that you have been
// given something, in a message that does not let you reach it. The panel is
// a WEB address arriving as a phone push, so the address has to be in words
// the merchant can read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANEL_URL, ADVANCED_FEATURES, panelInviteMessage, panelInvitePayload,
} from '../src/shopPanelInvite.js';

test('the panel link is the MERCHANT entry, not the admin dashboard', () => {
  // /dashboard drops a shop owner on an admin login they cannot pass.
  assert.equal(PANEL_URL, 'https://iqmobile.org/dashboard/store');
});

test('the link is on the brand domain, never the API host', () => {
  // Same trap as the canonical bug: api.iqmobile.org serves this too, and
  // it is now Disallow: / to crawlers and the wrong thing to hand a person.
  assert.ok(!PANEL_URL.includes('api.'));
});

test('the address is in the BODY, where a push actually shows it', () => {
  // A payload field is invisible to someone reading a notification.
  const m = panelInviteMessage();
  assert.match(m.body, /iqmobile\.org\/dashboard\/store/);
});

test('the message says what the tier actually unlocks', () => {
  // «شوف الأدوات الجديدة» told a merchant nothing they could act on.
  const m = panelInviteMessage();
  assert.match(m.body, /جماعي/);
  assert.match(m.body, /ردود جاهزة/);
  assert.ok(m.title.length > 0);
});

test('the payload carries the link and the list for a client that can render them', () => {
  const p = panelInvitePayload();
  assert.equal(p.panel_url, PANEL_URL);
  assert.ok(Array.isArray(p.features) && p.features.length >= 4);
  assert.equal(p.kind, 'tier', 'still the tier notification the app already routes');
});

test('the feature list names real advanced-only surfaces', () => {
  // These map to routes behind requireAdvanced in shopAdmin.js. If that gate
  // changes, this list is what goes stale — the test is the reminder.
  assert.ok(ADVANCED_FEATURES.some((f) => f.includes('دفعة واحدة')), 'bulk');
  assert.ok(ADVANCED_FEATURES.some((f) => f.includes('ردود جاهزة')), 'quick replies');
  assert.ok(ADVANCED_FEATURES.some((f) => f.includes('تشخيص')), 'diagnostics');
  assert.ok(ADVANCED_FEATURES.some((f) => f.includes('الطلب')), 'demand');
});

test('the push body stays short enough to be read on a lock screen', () => {
  // Android truncates around 120 characters collapsed; past that the link
  // itself can be the part that is cut.
  assert.ok(panelInviteMessage().body.length <= 120,
    `body is ${panelInviteMessage().body.length} chars`);
});
