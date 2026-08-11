import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../theme';
import { useAuth } from '../lib/auth';
import { ApiError } from '../api/client';

// Login errors are named, not generic. "تعذّر تسجيل الدخول" for a wrong
// password sends the operator to check their connection; for a real network
// failure it sends them to re-type a password that was fine.
function messageFor(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'network';
  if (code === 'bad_credentials') return 'اسم المستخدم أو كلمة المرور غير صحيحة.';
  if (code === 'missing_fields') return 'أدخل اسم المستخدم وكلمة المرور.';
  if (code === 'timeout') return 'انتهت مهلة الاتصال. تحقّق من الشبكة وحاول مجدداً.';
  if (code === 'rate_limited') return 'محاولات كثيرة. انتظر دقيقة ثم حاول مجدداً.';
  return 'تعذّر الاتصال بالخادم.';
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr('');
    try {
      await login(username.trim(), password);
    } catch (e) {
      setErr(messageFor(e));
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
        <Field
          label="كلمة المرور"
          value={password}
          onChangeText={(v: string) => { setPassword(v); setErr(''); }}
          secureTextEntry
          onSubmitEditing={submit}
          returnKeyType="go"
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

function Field({ label, ...rest }: any) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{
        fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
        textAlign: 'right', marginBottom: 6,
      }}>
        {label}
      </Text>
      <TextInput
        {...rest}
        placeholderTextColor={theme.faint}
        autoCorrect={false}
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
