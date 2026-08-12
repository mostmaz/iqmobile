import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../theme';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../api/client';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr('');
    try {
      await login(username.trim(), password);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <View style={{
        flex: 1, justifyContent: 'center', paddingHorizontal: 26,
        paddingBottom: insets.bottom + 20,
      }}>
        <View style={{ alignItems: 'center', marginBottom: 34 }}>
          <View style={{
            width: 58, height: 58, borderRadius: 16, backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center', marginBottom: 14,
          }}>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>iQ</Text>
          </View>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 20, fontWeight: '700', color: theme.ink }}>
            لوحة الإدارة
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, marginTop: 6 }}>
            تنبيهات فورية للطلبات والإعلانات والمتاجر
          </Text>
        </View>

        <Field
          label="اسم المستخدم"
          value={username}
          onChangeText={(v: string) => { setUsername(v); setErr(''); }}
          autoCapitalize="none"
        />
        {/* The admin password is 48 random characters. Typing that blind on
            a phone keyboard is a coin flip, and five wrong tries locks the
            account for a minute — so it has to be readable while entering. */}
        <Field
          label="كلمة المرور"
          value={password}
          onChangeText={(v: string) => { setPassword(v); setErr(''); }}
          secureTextEntry={!showPw}
          autoCapitalize="none"
          autoComplete="off"
          onSubmitEditing={submit}
          returnKeyType="go"
          accessory={
            <TouchableOpacity
              onPress={() => setShowPw((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showPw ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              hitSlop={10}
              style={{ paddingHorizontal: 4, paddingVertical: 6 }}
            >
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.accent }}>
                {showPw ? 'إخفاء' : 'إظهار'}
              </Text>
            </TouchableOpacity>
          }
        />

        {err ? (
          <Text style={{
            fontFamily: fonts.ar, fontSize: 13, color: theme.danger,
            textAlign: 'right', marginTop: 4, marginBottom: 6,
          }}>
            {err}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={submit}
          disabled={!canSubmit}
          activeOpacity={0.85}
          style={{
            marginTop: 16, borderRadius: radius.lg, paddingVertical: 16,
            backgroundColor: theme.accent, alignItems: 'center',
            opacity: canSubmit ? 1 : 0.45,
          }}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: '#fff' }}>دخول</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, accessory, ...rest }: any) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right' }}>
          {label}
        </Text>
        {accessory}
      </View>
      <TextInput
        {...rest}
        placeholderTextColor={theme.faint}
        autoCorrect={false}
        spellCheck={false}
        style={{
          backgroundColor: theme.surface,
          borderWidth: 1, borderColor: theme.line,
          borderRadius: radius.lg,
          paddingHorizontal: 14, paddingVertical: 14,
          fontSize: 15, color: theme.ink, textAlign: 'left',
        }}
      />
    </View>
  );
}
