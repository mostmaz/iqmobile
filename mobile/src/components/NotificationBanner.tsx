// Foreground notification banner.
//
// When an SSE `chat.message` event arrives AND the user isn't already
// looking at the matching Chat screen, slide a small banner down from
// the top with sender name + body preview. Tap → jump into the chat.
//
// SSE is the live channel (server emits via `notify()` in
// server/src/notify.js). We deliberately don't poll
// /messages/inbox here — that would double-fire on every message and
// burn battery while the SSE connection is healthy. The polling fallback
// (when SSE has been dropped for a while) can be added later if needed.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, TouchableOpacity, View, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../theme';
import { subscribeSSE } from '../sse/client';
import { navigationRef, getCurrentRouteName, getCurrentRouteParams } from '../navigation/ref';
import { ar } from '../i18n/ar';

type BannerPayload = {
  chat_id: number;
  title: string;
  body: string;
};

export function NotificationBanner() {
  const insets = useSafeAreaInsets();
  const [banner, setBanner] = useState<BannerPayload | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  // Auto-dismiss timer — cleared if a new banner arrives before it fires
  // (we replace the old banner content instead of stacking).
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribeSSE((event, data) => {
      if (event !== 'chat.message') return;
      const chatId = data?.chat_id;
      const msg = data?.message;
      if (!chatId || !msg) return;

      // Suppress when the user is already looking at this exact chat.
      // navigationRef.getCurrentRoute() returns the deepest active route
      // (e.g. 'Chat' with { id }) — we only skip when both match.
      const route = getCurrentRouteName();
      const params = getCurrentRouteParams();
      if (route === 'Chat' && Number(params?.id) === Number(chatId)) return;

      const senderName = msg.sender_name || ar.chat.newMessage;
      const preview = msg.body ? String(msg.body).slice(0, 80) : '📷';
      setBanner({ chat_id: chatId, title: senderName, body: preview });
    });
    // `unsub` returns Set.delete()'s boolean; React's useEffect cleanup
    // must return void, so wrap the call to discard the result.
    return () => { unsub(); };
  }, []);

  // Slide in when a banner is set; slide out + clear after ~4s.
  useEffect(() => {
    if (!banner) return;
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9, tension: 80 }).start();
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      Animated.timing(translateY, { toValue: -160, duration: 200, useNativeDriver: true }).start(() => {
        setBanner(null);
      });
    }, 4000);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [banner, translateY]);

  function openChat() {
    if (!banner) return;
    // Jump straight into the Chat screen inside the Chats tab. Same nested
    // navigate shape AuthGate uses elsewhere.
    if (navigationRef.isReady()) {
      navigationRef.navigate('Main', {
        screen: 'Chats',
        params: { screen: 'Chat', params: { id: banner.chat_id } },
      });
    }
    // Dismiss immediately on tap — no need to wait for the auto-timer.
    Animated.timing(translateY, { toValue: -160, duration: 150, useNativeDriver: true }).start(() => {
      setBanner(null);
    });
  }

  if (!banner) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + (Platform.OS === 'android' ? 4 : 0),
        left: 12, right: 12,
        transform: [{ translateY }],
        zIndex: 9999,
      }}
    >
      <TouchableOpacity
        onPress={openChat}
        activeOpacity={0.9}
        style={{
          backgroundColor: theme.ink,
          borderRadius: radius.lg,
          paddingHorizontal: 14, paddingVertical: 12,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <View style={{
          width: 6, height: 6, borderRadius: 999, backgroundColor: theme.accent,
        }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{
            fontFamily: fonts.arBold, fontWeight: '700', fontSize: 13.5,
            color: theme.buttonInk, textAlign: 'right',
          }}>
            {banner.title}
          </Text>
          <Text numberOfLines={1} style={{
            marginTop: 1,
            fontFamily: fonts.ar, fontSize: 12,
            color: theme.buttonInk, opacity: 0.85, textAlign: 'right',
          }}>
            {banner.body}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
