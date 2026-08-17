// Push registration for the operator app.
//
// The token is posted after login and again on every cold start, because it
// can rotate (app reinstall, data clear, Expo credential change). The server
// upserts on the token, so re-posting an unchanged one is free.
//
// Logout deletes the row. That matters more here than in a consumer app: a
// device that keeps its registration after someone signs out will keep
// buzzing about orders for a person who is no longer an operator.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../api/client';

/** Foreground behaviour: an operator looking at the app still wants the alert. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type AdminPushKind =
  | 'order.new' | 'guarantee.new' | 'listing.new' | 'shop.new'
  | 'report.new' | 'device.suggested' | 'feature.requested';

export const KIND_LABEL: Record<AdminPushKind, string> = {
  'order.new': 'طلب جديد',
  'guarantee.new': 'طلب ضمان جديد',
  'listing.new': 'إعلان جديد',
  'shop.new': 'متجر جديد',
  'report.new': 'بلاغ جديد',
  'device.suggested': 'جهاز مقترح',
  'feature.requested': 'طلب ترويج',
};

let cachedToken: string | null = null;
let lastError: string | null = null;

/**
 * Ask for permission and return the Expo token, or null when it can't be had
 * (emulator without Play services, permission refused, missing projectId).
 * Never throws — a failed registration must not block sign-in.
 */
export async function getPushToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    // NOT gated on Device.isDevice. An emulator built from a
    // google_apis_playstore image has Play Services and registers with FCM
    // exactly like hardware — refusing to try there blocks the only clean
    // way to test push when the physical phone has hit Android's
    // registration cap. If Play Services really is absent, the call below
    // fails on its own and says so.

    // Android needs the channel to exist before the first notification, or
    // the OS drops it into a default channel with no sound.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('admin', {
        name: 'تنبيهات الإدارة',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#E4643F',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') {
      lastError = 'إذن الإشعارات مرفوض على هذا الجهاز';
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;

    if (!projectId) {
      lastError = 'no projectId in app config — getExpoPushTokenAsync cannot mint a token';
      console.warn('[push]', lastError);
      return null;
    }

    const res = await Notifications.getExpoPushTokenAsync({ projectId });
    cachedToken = res.data;
    lastError = null;
    return cachedToken;
  } catch (e: any) {
    // Swallowing this was a mistake: registration failing silently is
    // indistinguishable from push not being wired up at all, and it cost an
    // afternoon of guessing which of the two it was. The message is kept so
    // the settings screen can show it.
    lastError = String(e?.message || e);
    if (!Device.isDevice) lastError += ' (محاكي بدون Play Services؟)';
    console.warn('[push] getExpoPushTokenAsync failed:', lastError);
    return null;
  }
}

/** Why the last token attempt failed, for the settings screen to surface. */
export function lastPushError(): string | null { return lastError; }

/** Register this device against the signed-in admin. Returns muted kinds. */
export async function registerDevice(): Promise<AdminPushKind[]> {
  const t = await getPushToken();
  if (!t) return [];
  try {
    const r = await api<{ muted_kinds: AdminPushKind[] }>('/admin/devices', {
      method: 'POST',
      body: JSON.stringify({ expo_push_token: t, platform: Platform.OS }),
    });
    return r.muted_kinds || [];
  } catch {
    return [];
  }
}

/** Drop this device's registration. Called on sign-out. */
export async function unregisterDevice(): Promise<void> {
  const t = cachedToken || (await getPushToken());
  if (!t) return;
  try {
    await api('/admin/devices', {
      method: 'DELETE',
      body: JSON.stringify({ expo_push_token: t }),
    });
  } catch { /* signing out locally matters more than the server round-trip */ }
}

export async function setMutedKinds(muted: AdminPushKind[]): Promise<AdminPushKind[]> {
  const t = cachedToken || (await getPushToken());
  if (!t) return muted;
  const r = await api<{ muted_kinds: AdminPushKind[] }>('/admin/devices/prefs', {
    method: 'PATCH',
    body: JSON.stringify({ expo_push_token: t, muted_kinds: muted }),
  });
  return r.muted_kinds || [];
}
