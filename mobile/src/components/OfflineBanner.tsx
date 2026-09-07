// One line, at the top, only when we genuinely cannot reach the server.
//
// The restraint matters more than the banner. Before this, an offline app
// looked like an EMPTY app — Browse rendered «لا توجد إعلانات» over a dead
// connection (fixed in Stage 2) — so the job here is to say "this is your
// connection, not the marketplace" once, without covering anything.
//
// It never appears for a slow request or a single failure: reachability
// requires consecutive transport failures, so a banner showing up is a real
// statement rather than a flicker every time a request is retried.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts } from '../theme';
import { isOnline, subscribeOnline, checkNow } from '../lib/reachability';

export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => subscribeOnline(setOnline), []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);

  if (online) return null;

  async function retry() {
    if (checking) return;
    setChecking(true);
    try { await checkNow(); } finally { setChecking(false); }
  }

  return (
    <View
      accessibilityRole="alert"
      style={{
        paddingTop: insets.top || 8,
        paddingBottom: 8,
        paddingHorizontal: 14,
        backgroundColor: theme.ink,
        flexDirection: 'row-reverse',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Text style={{
        flex: 1, fontFamily: fonts.ar, fontSize: 12.5,
        color: theme.buttonInk, textAlign: 'right',
      }}>
        لا يوجد اتصال بالإنترنت. تشوف آخر ما تم تحميله.
      </Text>
      <TouchableOpacity onPress={retry} disabled={checking} accessibilityRole="button"
        style={{ paddingHorizontal: 10, paddingVertical: 3 }}>
        {checking
          ? <ActivityIndicator size="small" color={theme.buttonInk} />
          : (
            <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.buttonInk }}>
              إعادة المحاولة
            </Text>
          )}
      </TouchableOpacity>
    </View>
  );
}
