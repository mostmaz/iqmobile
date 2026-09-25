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
