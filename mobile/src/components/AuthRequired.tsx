// Empty-state shown on tabs that need a user (Saved, Chats, Profile,
// Sell). Pushes the AuthGate modal via the navigation ref so the user
// can sign in/up without losing their place.

import React from 'react';
import { View, Text } from 'react-native';
import { theme, fonts } from '../theme';
import { Btn } from './ui';
import { go } from '../navigation/ref';
import { IconLock } from './icons';

export function AuthRequired({ title, body, mode = 'login' }: { title: string; body: string; mode?: 'login' | 'signup' }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
      <View style={{
        width: 64, height: 64, borderRadius: 999,
        backgroundColor: theme.accentSoft,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <IconLock size={26} color={theme.accent} sw={1.7} />
      </View>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 18, fontWeight: '700', color: theme.ink, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'center', lineHeight: 21 }}>
        {body}
      </Text>
      <View style={{ marginTop: 8, flexDirection: 'row-reverse', gap: 8, alignSelf: 'stretch' }}>
        <Btn kind="ghost" full onPress={() => go('AuthGate', { mode: 'login' })}>تسجيل دخول</Btn>
        <Btn kind="accent" full onPress={() => go('AuthGate', { mode: 'signup' })}>إنشاء حساب</Btn>
      </View>
    </View>
  );
}
