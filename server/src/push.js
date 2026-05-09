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
    messages.push({ to: r.expo_push_token, sound: 'default', title, body, data });
  }
  if (messages.length === 0) return;
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.error('push send error', err);
    }
  }
}
