import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleProp, ViewStyle, TextStyle, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius, shadowSoft } from '../theme';
import { IconArrowLeft } from './icons';

// ─── Button ──────────────────────────────────────────────────────
// `successSoft` is the outlined-green variant we use on the WhatsApp deeplink
// CTA so it reads as paired-but-secondary against the solid-green Call.
type Kind = 'primary' | 'accent' | 'ghost' | 'success' | 'successSoft' | 'danger';

interface BtnProps {
  children: React.ReactNode;
  onPress?: () => void;
  kind?: Kind;
  full?: boolean;
  sm?: boolean;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}

const KIND_STYLES: Record<Kind, { bg: string; ink: string; border?: string }> = {
  primary: { bg: theme.button, ink: theme.buttonInk },
  accent: { bg: theme.accent, ink: '#fff' },
  ghost: { bg: 'transparent', ink: theme.ink, border: theme.line },
  success: { bg: theme.success, ink: '#fff' },
  successSoft: { bg: theme.successSoft, ink: theme.success, border: theme.success },
  danger: { bg: 'transparent', ink: theme.danger, border: 'rgba(180,58,46,0.3)' },
};

export function Btn({ children, onPress, kind = 'primary', full, sm, disabled, busy, style }: BtnProps) {
  const k = KIND_STYLES[kind];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.85}
      style={[
        {
          backgroundColor: k.bg,
          borderRadius: sm ? radius.md : radius.lg,
          paddingHorizontal: sm ? 14 : 18,
          paddingVertical: sm ? 10 : 14,
          flexDirection: 'row-reverse',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          // `full` distributes evenly with siblings in a row, stretches
          // alone in a column. `minHeight` guarantees the button never
          // collapses to 0 main-axis size (which would hide the label).
          flex: full ? 1 : undefined,
          alignSelf: full ? 'stretch' : 'flex-start',
          minHeight: sm ? 38 : 48,
          opacity: disabled ? 0.4 : 1,
          borderWidth: k.border ? 1.5 : 0,
          borderColor: k.border,
        },
        (kind === 'primary' || kind === 'accent') && {
          shadowColor: '#1B1A18',
          shadowOpacity: 0.15,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={k.ink} size="small" />
      ) : typeof children === 'string' ? (
        <Text style={{ color: k.ink, fontFamily: fonts.arBold, fontSize: sm ? 13 : 15, fontWeight: '600' }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
}

// ─── Header ──────────────────────────────────────────────────────
interface HeaderProps {
  title: string;
  eyebrow?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  badge?: 'BUYER' | 'SHOP';
}

export function Header({ title, eyebrow, onBack, right, badge = 'BUYER' }: HeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 6 + insets.top, paddingBottom: 14, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', height: 36 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} style={{ padding: 4 }} activeOpacity={0.6}>
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
              <View style={{
                width: 22, height: 22, borderRadius: 6, backgroundColor: theme.accent,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontFamily: fonts.ltrBold, fontSize: 11, fontWeight: '700' }}>iQ</Text>
              </View>
              <Text style={{ fontFamily: fonts.ltr, color: theme.subtle, fontSize: 12, fontWeight: '600' }}>{badge}</Text>
            </View>
          )}
        </View>
        {right}
      </View>
      {eyebrow ? (
        <Text style={{ marginTop: 14, fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'right' }}>
          {eyebrow}
        </Text>
      ) : null}
      <Text style={{ marginTop: eyebrow ? 4 : 14, fontFamily: fonts.arBold, fontSize: 26, color: theme.ink, fontWeight: '700', letterSpacing: -0.5, lineHeight: 32, textAlign: 'right' }}>
        {title}
      </Text>
    </View>
  );
}

// ─── Field label (mono uppercase) ────────────────────────────────
export function FieldLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[{
      fontFamily: fonts.mono,
      fontSize: 10.5,
      letterSpacing: 1.2,
      color: theme.subtle,
      textTransform: 'uppercase',
      marginBottom: 8,
      textAlign: 'right',
    }, style]}>
      {children}
    </Text>
  );
}

// ─── Pill chip selector ──────────────────────────────────────────
interface PillProps {
  active?: boolean;
  onPress?: () => void;
  children: React.ReactNode;
  count?: number;
  small?: boolean;
}

export function Pill({ active, onPress, children, count, small }: PillProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        paddingHorizontal: small ? 11 : 13,
        paddingVertical: small ? 6 : 7,
        borderRadius: radius.pill,
        backgroundColor: active ? theme.ink : theme.surface,
        borderWidth: active ? 0 : 1,
        borderColor: theme.line,
        flexDirection: 'row-reverse',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}
    >
      <Text style={{ fontFamily: fonts.ar, fontSize: small ? 12 : 12.5, fontWeight: '500', color: active ? theme.bg : theme.ink }}>
        {children}
      </Text>
      {count != null ? (
        <Text style={{ fontFamily: fonts.ltr, fontSize: 10.5, color: active ? theme.bg : theme.subtle, opacity: 0.65 }}>
          {count}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Input ───────────────────────────────────────────────────────
// `autofill` opts INTO native credential autofill (only used on the auth
// screen for phone + password). All other inputs default to autofill OFF —
// suggestion bars on top of the keyboard for names, prices, models, etc.
// are noisy and irrelevant in this app.
type AutofillKind = 'phone' | 'password' | 'username' | 'name';

interface IInput {
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
  secure?: boolean;
  numeric?: boolean;
  multiline?: boolean;
  ltr?: boolean; // model names stay LTR even in RTL screens
  bare?: boolean; // no border / background — for use inside a FieldBox
  autofill?: AutofillKind;
}

const AC_MAP: Record<AutofillKind, 'tel' | 'password' | 'username' | 'name'> = {
  phone: 'tel', password: 'password', username: 'username', name: 'name',
};
const TCT_MAP: Record<AutofillKind, 'telephoneNumber' | 'password' | 'username' | 'name'> = {
  phone: 'telephoneNumber', password: 'password', username: 'username', name: 'name',
};

export function Input({ value, onChangeText, placeholder, secure, numeric, multiline, ltr, bare, autofill }: IInput) {
  // Autofill suppression — layered approach because no single prop is
  // honored by every Android skin (MIUI, OneUI, ColorOS each ignore
  // different ones).
  //
  // ANDROID, non-numeric text fields without autofill opt-in:
  //   keyboardType="visible-password"
  //     → inputType becomes TYPE_TEXT_VARIATION_VISIBLE_PASSWORD on the
  //       Android side. The system autofill service explicitly refuses
  //       to attach to fields with the visible-password variation, and
  //       most IMEs (Gboard, SwiftKey) also drop the suggestion strip.
  //       Characters render normally — this is NOT secureTextEntry.
  //   secureTextEntry stays FALSE — setting it true would mark the
  //       field as a password, which paradoxically *invites* GPM to
  //       attach a "fill password" affordance.
  //
  // iOS:
  //   textContentType="none" + autoComplete="off" — keyboard suggestion
  //   bar suppressed, no strong-password popover.
  //
  // Cross-platform:
  //   importantForAutofill="noExcludeDescendants" — the strongest
  //   Android system-autofill signal (rejects the field AND its
  //   children, closing a loophole that plain "no" leaves open).
  let kbType: any = numeric ? 'phone-pad' : 'default';
  if (Platform.OS === 'android' && !numeric && !secure && !autofill) {
    kbType = 'visible-password';
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.subtle}
      secureTextEntry={secure === true}
      keyboardType={kbType}
      multiline={multiline}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      autoComplete={autofill ? AC_MAP[autofill] : 'off'}
      textContentType={autofill ? TCT_MAP[autofill] : 'none'}
      importantForAutofill={autofill ? 'yes' : 'noExcludeDescendants'}
      style={{
        backgroundColor: bare ? 'transparent' : theme.surface,
        borderRadius: bare ? 0 : radius.lg,
        borderWidth: bare ? 0 : 1,
        borderColor: theme.line,
        paddingHorizontal: bare ? 0 : 14,
        paddingVertical: bare ? 0 : 12,
        fontFamily: fonts.ar,
        fontSize: 14.5,
        color: theme.ink,
        textAlign: ltr ? 'left' : 'right',
        writingDirection: ltr ? 'ltr' : 'rtl',
        minHeight: multiline ? 88 : undefined,
        textAlignVertical: multiline ? 'top' : 'center',
      }}
    />
  );
}

// ─── Card surface ────────────────────────────────────────────────
export function Card({ children, style, accent }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; accent?: boolean }) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: radius.xxl,
          borderWidth: 1.5,
          borderColor: accent ? theme.accent : theme.line,
          padding: 14,
        },
        shadowSoft,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[{
      fontFamily: fonts.mono,
      fontSize: 10.5,
      letterSpacing: 1.2,
      color: theme.subtle,
      textTransform: 'uppercase',
      textAlign: 'right',
    }, style]}>{children}</Text>
  );
}

export function MoneyIQD({ amount, big }: { amount: number; big?: boolean }) {
  return (
    <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: big ? 19 : 14, color: theme.ink, textAlign: 'left', writingDirection: 'ltr' }}>
      {fmtIQD(amount)}
    </Text>
  );
}

// Comma-separated full-digit IQD price, e.g. 100,000 / 1,000,000 / 1,525,000.
// (Earlier we abbreviated to K/M, but the precise form reads more clearly
// for a phone marketplace — buyers want to see the exact ask.)
export function fmtIQD(n: number) {
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('en-US');
}
