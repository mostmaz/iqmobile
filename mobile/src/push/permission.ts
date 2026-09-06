// Notification permission — one place that knows the state, asks for it, and
// recovers when the answer was "no".
//
// The hard part is iOS: the OS grants exactly ONE chance to show the system
// prompt per install. Once the user taps "Don't Allow", requestPermissionsAsync
// resolves instantly with denied forever after, and `canAskAgain` goes false.
// So any screen that *requires* notifications must be able to route the user
// to Settings and notice when they come back — otherwise a single mistaken tap
// locks them out of that screen for the life of the install.
//
// That's what `useNotificationPermission` is for: it re-reads the real OS
// state whenever the app returns to the foreground, so walking to Settings,
// flipping the switch and walking back updates the UI with no restart.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerPushToken } from './register';

export type PermState = {
  /** Nothing asked yet — the system prompt is still available. */
  granted: boolean;
  /** True while we haven't read the OS state yet; screens should not gate on a guess. */
  loading: boolean;
  /** False on iOS once the user has denied: only Settings can change it now. */
  canAskAgain: boolean;
  status: Notifications.PermissionStatus | 'unknown';
};

export async function readPermission(): Promise<Omit<PermState, 'loading'>> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return {
      granted: !!p.granted
        // iOS provisional / ephemeral authorizations report granted=false but
        // do deliver notifications; treat them as good enough to pass a gate.
        || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
        || p.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED,
      canAskAgain: p.canAskAgain !== false,
      status: p.status,
    };
  } catch {
    // Never let a permissions read throw a gate open or shut arbitrarily —
    // report "not granted, can still ask", which is the recoverable state.
    return { granted: false, canAskAgain: true, status: 'unknown' };
  }
}

/**
 * Ask for the permission. Returns the resulting granted flag.
 * On success it also registers the push token, because a permission with no
 * token on the server is a switch the user flipped that changes nothing.
 */
export async function askPermission(): Promise<boolean> {
  try {
    const before = await Notifications.getPermissionsAsync();
    let granted = !!before.granted;
    if (!granted && before.canAskAgain !== false) {
      const res = await Notifications.requestPermissionsAsync();
      granted = !!res.granted;
    }
    if (granted) {
      // Fire-and-forget: the gate should open the moment the OS says yes,
      // not wait on a network round trip to our own server.
      registerPushToken().catch(() => {});
    }
    return granted;
  } catch {
    return false;
  }
}

export function openNotificationSettings() {
  // openSettings() lands on this app's page on both platforms; on Android it
  // is the app info screen, one tap from Notifications.
  Linking.openSettings().catch(() => {});
}

/**
 * Live permission state. Re-reads on every foreground so a trip to Settings
 * is reflected without a restart — the whole recovery path depends on it.
 */
export function useNotificationPermission() {
  const [state, setState] = useState<PermState>({
    granted: false, loading: true, canAskAgain: true, status: 'unknown',
  });
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const p = await readPermission();
    if (mounted.current) setState({ ...p, loading: false });
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => { mounted.current = false; sub.remove(); };
  }, [refresh]);

  const request = useCallback(async () => {
    const granted = await askPermission();
    // Re-read rather than trusting the return: on Android 13 the OS can
    // resolve the request before the dialog's state has settled.
    await refresh();
    return granted;
  }, [refresh]);

  return { ...state, request, refresh, openSettings: openNotificationSettings, isAndroid: Platform.OS === 'android' };
}
