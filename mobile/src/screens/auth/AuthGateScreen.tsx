// AuthGate — a single modal screen reachable from any "auth-required"
// action. Phone-only, passwordless: the user enters their Iraqi mobile
// number, the server upserts a real account (or promotes the current
// guest session in place), and we proceed. SMS OTP comes later — until
// then this is trust-on-first-use.
//
// UNIFIED-ACCOUNT REDESIGN: there's no Person-vs-Shop chooser. A single
// account model lets the user buy AND sell from the same identity.

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { theme, fonts, radius, shadowAccent } from '../../theme';
import { Btn, Input } from '../../components/ui';
import { IconArrowLeft, IconPhoneIcon, IconCheck } from '../../components/icons';
import { ar } from '../../i18n/ar';

const TRUST_STRIP = [
  'تشتري وتبيع من نفس الحساب — بلا عمولة',
  'تواصل مباشرة بالاتصال أو واتساب',
  'بدون كلمة مرور — رقم هاتفك يكفي',
];

export default function AuthGateScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { phoneLogin } = useAuth();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setErr('أدخل رقم هاتف صحيح'); return; }
    setBusy(true); setErr('');
    try {
      await phoneLogin(phone);
      navigation.goBack();
    } catch (e: any) {
      setErr((ar.errors as any)[e.message] || ar.errors.network);
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24, paddingHorizontal: 20,
      }}>
        {/* close + logo row */}
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
            <View style={[{
              width: 36, height: 36, borderRadius: 10, backgroundColor: theme.accent,
              alignItems: 'center', justifyContent: 'center',
            }, shadowAccent]}>
              <Text style={{ color: '#fff', fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 14 }}>iQ</Text>
            </View>
            <Text style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 15, color: theme.ink }}>IQ Mobile</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={{
            width: 38, height: 38, borderRadius: 999,
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <IconArrowLeft size={20} color={theme.ink} sw={1.7} />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={{
          fontFamily: fonts.arBold, fontWeight: '700', fontSize: 26, color: theme.ink,
          letterSpacing: -0.5, lineHeight: 32, textAlign: 'right',
        }}>
          أدخل رقم هاتفك
        </Text>
        <Text style={{
          marginTop: 6, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, lineHeight: 21, textAlign: 'right',
        }}>
          رقم هاتفك هو حسابك. لا حاجة لكلمة مرور — سنرسل رمز تحقق قصيراً قريباً.
        </Text>

        {/* phone */}
        <View style={{ marginTop: 22 }}>
          <FieldBox icon={IconPhoneIcon} label={ar.auth.phone}>
            <Input value={phone} onChangeText={setPhone} placeholder="07700001234" numeric ltr bare />
          </FieldBox>
        </View>

        {/* Trust strip — three quick value props. */}
        <View style={{
          marginTop: 14, padding: 12,
          backgroundColor: theme.surface, borderColor: theme.line, borderWidth: 1, borderRadius: 12,
          gap: 7,
        }}>
          {TRUST_STRIP.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8 }}>
              <View style={{
                width: 16, height: 16, borderRadius: 999, marginTop: 2, flexShrink: 0,
                backgroundColor: theme.accentSoft,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <IconCheck size={10} color={theme.accent} sw={2.6} />
              </View>
              <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 12, lineHeight: 18, color: theme.ink, textAlign: 'right' }}>
                {row}
              </Text>
            </View>
          ))}
        </View>

        {err ? (
          <Text style={{ marginTop: 14, fontFamily: fonts.ar, fontSize: 13, color: theme.danger, textAlign: 'right' }}>
            {err}
          </Text>
        ) : null}

        <View style={{ marginTop: 22 }}>
          <Btn kind="accent" full onPress={submit} busy={busy}>
            متابعة
          </Btn>
          <Text style={{ marginTop: 12, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, textAlign: 'center', color: theme.subtle, textTransform: 'uppercase' }}>
            رمز SMS قريباً
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function FieldBox({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
      paddingHorizontal: 14, paddingVertical: 10,
      flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    }}>
      <Icon size={18} color={theme.subtle} sw={1.6} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, marginBottom: 2, textAlign: 'right' }}>{label}</Text>
        {children}
      </View>
    </View>
  );
}

