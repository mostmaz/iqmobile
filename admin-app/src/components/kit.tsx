// Shared pieces for the list-and-act screens.
//
// Every operator screen is the same shape: a title, an optional search, a row
// of filters, a list, and per-row actions that hit an endpoint and refresh.
// Writing that seven times invites seven slightly different behaviours, which
// on a moderation tool means seven different ways to mis-tap something
// destructive. So it lives here once.

import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../theme';
import { errorMessage } from '../api/client';

export function ScreenHeader({
  title, subtitle, onBack, right,
}: {
  title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{
      paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
      flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    }}>
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          hitSlop={10}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: -8 }}
        >
          <Text style={{ fontSize: 24, color: theme.ink }}>›</Text>
        </TouchableOpacity>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 19, fontWeight: '700', color: theme.ink, textAlign: 'right' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function SearchBar({ value, onChangeText, placeholder }: {
  value: string; onChangeText: (v: string) => void; placeholder: string;
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.faint}
        autoCorrect={false}
        autoCapitalize="none"
        style={{
          backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
          borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 11,
          fontSize: 14.5, color: theme.ink, textAlign: 'right',
        }}
      />
    </View>
  );
}

export function ChipRow<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7, paddingHorizontal: 16, paddingBottom: 10 }}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <TouchableOpacity
            key={o.key || 'all'}
            onPress={() => onChange(o.key)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
            style={{
              paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.pill,
              backgroundColor: active ? theme.ink : theme.surface,
              borderWidth: 1, borderColor: active ? theme.ink : theme.line,
            }}
          >
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: active ? theme.bg : theme.subtle }}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: theme.surface, borderRadius: radius.xl,
      borderWidth: 1, borderColor: theme.line, padding: 14, marginBottom: 10,
    }}>
      {children}
    </View>
  );
}

/**
 * A row action. `confirm` turns it into a two-step: anything that removes,
 * suspends or rejects should pass one, because this is a list and the
 * neighbouring row is 10dp away.
 */
export function Action({
  label, onPress, tone = 'neutral', busy, confirm,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'danger' | 'ok' | 'neutral';
  busy?: boolean;
  confirm?: { title: string; body?: string };
}) {
  const bg = tone === 'primary' ? theme.accent
    : tone === 'ok' ? theme.ok
    : 'transparent';
  const fg = tone === 'danger' ? theme.danger
    : tone === 'neutral' ? theme.subtle
    : '#fff';
  const bordered = tone === 'danger' || tone === 'neutral';

  return (
    <TouchableOpacity
      disabled={busy}
      accessibilityRole="button"
      onPress={() => {
        if (!confirm) return onPress();
        Alert.alert(confirm.title, confirm.body, [
          { text: 'رجوع', style: 'cancel' },
          { text: label, style: tone === 'danger' ? 'destructive' : 'default', onPress },
        ]);
      }}
      activeOpacity={0.85}
      style={{
        flex: 1, paddingVertical: 11, borderRadius: radius.lg, alignItems: 'center',
        backgroundColor: bg, borderWidth: bordered ? 1.5 : 0, borderColor: theme.line,
        opacity: busy ? 0.5 : 1,
      }}
    >
      <Text style={{ fontFamily: fonts.arBold, fontSize: 13, fontWeight: '700', color: fg }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 12 }}>{children}</View>
  );
}

export function ListState({ loading, error, empty, emptyText, onRetry }: {
  loading?: boolean;
  // Pass the actual error, not just a boolean — "تعذّر التحميل" for a DNS
  // failure on the device sends the operator to check the server, which is
  // the wrong place entirely.
  error?: boolean | unknown;
  empty?: boolean; emptyText: string; onRetry?: () => void;
}) {
  if (loading) {
    return (
      <View style={{ paddingVertical: 60, alignItems: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={{ paddingVertical: 48, alignItems: 'center' }}>
        <Text style={{
          fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
          textAlign: 'center', lineHeight: 21, paddingHorizontal: 8,
        }}>
          {typeof error === 'boolean' ? 'تعذّر التحميل. تحقّق من الاتصال.' : errorMessage(error)}
        </Text>
        {onRetry ? (
          <TouchableOpacity
            onPress={onRetry}
            style={{ marginTop: 14, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: theme.accent }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: '#fff' }}>إعادة المحاولة</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }
  if (empty) {
    return (
      <Text style={{
        fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
        textAlign: 'center', paddingVertical: 50,
      }}>
        {emptyText}
      </Text>
    );
  }
  return null;
}

export function Meta({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
      {children}
    </Text>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return (
    <Text numberOfLines={2} style={{ fontFamily: fonts.arBold, fontSize: 14.5, fontWeight: '600', color: theme.ink, textAlign: 'right' }}>
      {children}
    </Text>
  );
}
