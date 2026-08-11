// Push notifications to the operators, not to the users.
//
// pushTo() in push.js reads users.expo_push_token, which is the wrong table
// for this: an admin is a row in `admins`, has no user account, and may be
// signed in on more than one device. So admin devices get their own table,
// keyed on the token (a device can only ever belong to one admin — if it
// re-registers under a different login, the row moves).
//
// The events worth waking someone for are the ones with a person waiting at
// the other end: a cash-on-delivery order nobody has called back, a shop that
// just registered, a listing that needs a look. Everything else belongs in
// the work queue, which the operator reads when they choose to.

import { Expo } from 'expo-server-sdk';
import { db } from './db.js';

const expo = new Expo();

/**
 * Notification kinds an admin device can mute. Kept as a whitelist so a
 * typo'd preference silently disables nothing.
 */
export const ADMIN_PUSH_KINDS = [
  'order.new',
  'listing.new',
  'shop.new',
  'report.new',
  'device.suggested',
  'feature.requested',
];

/**
 * Send to every registered admin device that hasn't muted this kind.
 *
 * Fire-and-forget by design: a failed push must never fail the request that
 * triggered it — an order still has to be placed if Expo is down. Callers
 * are expected NOT to await this.
 */
export async function pushToAdmins(kind, title, body, data = {}) {
  let rows;
  try {
    rows = db.prepare(
      `SELECT expo_push_token, muted_kinds FROM admin_devices`,
    ).all();
  } catch {
    return; // table not migrated yet
  }

  const messages = [];
  for (const r of rows) {
    if (!Expo.isExpoPushToken(r.expo_push_token)) continue;
    const muted = String(r.muted_kinds || '').split(',').filter(Boolean);
    if (muted.includes(kind)) continue;
    messages.push({
      to: r.expo_push_token,
      sound: 'default',
      title,
      body,
      // The app routes on `kind` and `id` to open the right screen.
      data: { ...data, kind },
      // Group by kind so ten new listings collapse rather than filling the
      // shade — an operator who has been away should not have to dismiss
      // forty separate notifications.
      ...(kind ? { channelId: 'admin', categoryId: kind, threadId: kind } : {}),
    });
  }
  if (!messages.length) return;

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      // A DeviceNotRegistered ticket means the app was uninstalled or the
      // token rotated. Drop it now rather than retrying it forever.
      tickets.forEach((t, i) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
          try {
            db.prepare('DELETE FROM admin_devices WHERE expo_push_token=?')
              .run(chunk[i].to);
          } catch { /* ignore */ }
        }
      });
    } catch (err) {
      console.error('admin push send error', err.message);
    }
  }
}
