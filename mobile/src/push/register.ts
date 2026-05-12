// Push-notification registration + tap handling.
//
// Lifecycle:
//   1. registerPushToken() — request permission, fetch ExpoPushToken,
//      send to the server. Called from RootNav when user becomes
//      authenticated.
//   2. setupPushTapHandler(onTap) — wires the OS notification-tap event
//      to a callback so we can navigate inside the app (e.g. tapping a
//      "listing sold" push opens that listing). Called once at app boot.
//
// Why projectId is passed explicitly:
//   In Expo SDK 50+ `getExpoPushTokenAsync` requires `projectId` to bind
//   the token to your EAS project. Without it the call silently returns
//   nothing in standalone / EAS builds — easy to miss because it still
//   works in Expo Go.
//
// Expo Go vs standalone:
//   Expo Go SDK 53+ stripped remote push on Android — the
//   "TOO_MANY_REGISTRATIONS" warning in dev logs is exactly that. Test
//   from the EAS preview APK (or iOS Expo Go).

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { Auth } from '../api/endpoints';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerPushToken() {
  // Wrapped in Auth.pushDebug() calls so server logs show exactly which
  // step fails on devices we can't debug-attach. Each call is fire-and-
  // forget — failures don't change the control flow.
  try {
    Auth.pushDebug?.(`start platform=${Platform.OS}`);
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    Auth.pushDebug?.(`perm initial granted=${granted} status=${settings.status}`);
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
      Auth.pushDebug?.(`perm requested granted=${granted} status=${req.status}`);
    }
    if (!granted) {
      Auth.pushDebug?.('exit: permission not granted');
      return;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
      Auth.pushDebug?.('android channel set');
    }

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    Auth.pushDebug?.(`projectId=${projectId || 'MISSING'}`);

    try {
      const tokenResp = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : (undefined as any),
      );
      Auth.pushDebug?.(`getExpoPushTokenAsync ok data=${tokenResp?.data ? tokenResp.data.slice(0, 25) + '...' : 'EMPTY'}`);
      if (tokenResp?.data) {
        await Auth.pushToken(tokenResp.data);
        Auth.pushDebug?.('pushToken POSTed to server ok');
      }
    } catch (inner: any) {
      Auth.pushDebug?.(`getExpoPushTokenAsync THREW: ${inner?.code || ''} ${inner?.message || String(inner)}`.slice(0, 800));
      throw inner;
    }
  } catch (e: any) {
    console.warn('push register failed', e);
    Auth.pushDebug?.(`outer catch: ${e?.message || String(e)}`.slice(0, 500));
  }
}

// Single-shot subscription for notification taps. Calling more than once
// would leak listeners, so we guard with a module-level ref.
let tapSub: Notifications.Subscription | null = null;

export function setupPushTapHandler(
  onTap: (data: Record<string, any>) => void,
) {
  if (tapSub) return;
  tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = (response?.notification?.request?.content?.data || {}) as Record<string, any>;
    try { onTap(data); } catch (e) { console.warn('push tap handler failed', e); }
  });

  // Cold-start case — app was launched by tapping a notification. The
  // listener above only fires for live taps, so we also drain whatever
  // notification was tapped before we mounted.
  Notifications.getLastNotificationResponseAsync().then((resp) => {
    if (!resp) return;
    const data = (resp.notification.request.content.data || {}) as Record<string, any>;
    try { onTap(data); } catch (e) { console.warn('push cold-tap handler failed', e); }
  });
}
