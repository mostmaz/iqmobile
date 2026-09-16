import { Expo } from 'expo-server-sdk';
import { db } from './db.js';

const expo = new Expo();

export async function pushTo(userIds, title, body, data = {}) {
  if (!userIds || userIds.length === 0) return;
  const placeholders = userIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, expo_push_token FROM users WHERE id IN (${placeholders})`)
    .all(...userIds);

  const messages = [];
  for (const r of rows) {
    if (!r.expo_push_token || !Expo.isExpoPushToken(r.expo_push_token)) continue;
    messages.push({ to: r.expo_push_token, sound: 'default', channelId: 'default', title, body, data });
  }
  if (messages.length === 0) return;
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        if (ticket.status !== 'error') return;
        console.error('[push] rejected:', ticket.details?.error || ticket.message);
        if (ticket.details?.error === 'DeviceNotRegistered') {
          db.prepare('UPDATE users SET expo_push_token=NULL WHERE expo_push_token=?').run(chunk[i].to);
        }
      });
    } catch (err) {
      console.error('push send error', err);
    }
  }
}
