// What a shop is told the moment it gets the advanced panel.
//
// The approval already sent a notification: «صار عندك لوحة إدارة متجرك /
// سجّل دخولك للوحة وشوف الأدوات الجديدة.» It never said WHERE the panel is,
// and it never said what the new tools were. A merchant reading that on
// their phone has been told they have been given something, in a message
// that does not let them reach it — the panel lives at a web address they
// have no way to guess, and the push opens the app instead.
//
// Two call sites send this (the review queue's approve, and the manual
// grant), and they had drifted into two slightly different wordings. One
// message, one place.

import { db, now } from './db.js';
import { notify } from './notify.js';
import { SITE_URL } from './seo.js';

/** The address merchants are given. Not the admin dashboard root. */
export const PANEL_URL = `${SITE_URL}/dashboard/store`;

/**
 * What the advanced tier actually unlocks, in the merchant's words.
 *
 * Taken from the routes behind requireAdvanced in shopAdmin.js — if that
 * gate changes, this list is the thing that goes stale, so it is here rather
 * than inline in a notification body where nobody would look for it.
 */
export const ADVANCED_FEATURES = [
  'رفع وتعديل الإعلانات دفعة واحدة',
  'نسخ إعلان موجود',
  'ردود جاهزة على محادثات المشترين',
  'تشخيص إعلاناتك ولماذا لا تصل',
  'الطلب على أجهزتك بمحافظتك',
];

/**
 * The push a newly-promoted shop gets.
 *
 * The URL is in the BODY, not only the payload: this arrives as a phone
 * notification, and a link the app cannot open is a link the merchant has to
 * be able to read and type.
 */
export function panelInviteMessage() {
  return {
    title: 'صار عندك لوحة إدارة متجرك',
    body: `افتحها من ${PANEL_URL.replace(/^https:\/\//, '')} — `
      + 'رفع وتعديل جماعي، ردود جاهزة، تشخيص إعلاناتك، والطلب على أجهزتك.',
  };
}

/** The payload, so the app can render the list properly where it can. */
export function panelInvitePayload() {
  return { kind: 'tier', panel_url: PANEL_URL, features: ADVANCED_FEATURES };
}

/**
 * The same invite as a message in the shop's own thread with the admins.
 *
 * A push is gone the moment it is swiped. This lands in «مراجعة المتجر»,
 * which the shop can reopen whenever it goes looking for the address again —
 * and it is the only channel that can carry one, because `chats` requires a
 * listing_id and a message from the administration is not about a listing.
 * That is the reason shop_review_messages exists at all (see db.js).
 *
 * The URL is on its own line: the app linkifies message bodies, and a link
 * with Arabic punctuation crowding it is a link that is hard to hit.
 */
export function filePanelInviteMessage(shopId, at = now()) {
  const body = [
    'صار عندك لوحة إدارة متجرك.',
    '',
    PANEL_URL,
    '',
    'من اللوحة تقدر:',
    ...ADVANCED_FEATURES.map((f) => `• ${f}`),
    '',
    'سجّل دخولك برقم متجرك.',
  ].join('\n');

  db.prepare(
    `INSERT INTO shop_review_messages(shop_id, author, body, created_at)
     VALUES(?, 'admin', ?, ?)`,
  ).run(shopId, body, at);
  return body;
}

/**
 * Tell a promoted shop, on both channels it has.
 *
 * The push is the interruption that says something happened; the thread is
 * where the address still is tomorrow. Sending only the push was the
 * original bug in a smaller form — a merchant who swipes it away has lost
 * the link again.
 */
export function sendPanelInvite(shopId) {
  filePanelInviteMessage(shopId);
  notify(shopId, 'shop.review.approved', panelInvitePayload(), panelInviteMessage());
}
