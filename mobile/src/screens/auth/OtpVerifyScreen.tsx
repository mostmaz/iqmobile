// OTP verification screen. Reached from AuthGate after the server
// responds with { otp_required: true }. The user gets a 6-digit code by
// SMS (default) or WhatsApp, types it in, and the server issues a token.
//
// Resend is throttled client-side to a 30s cooldown; the server's own
// authLimiter + Twilio's per-service caps back that up if a client
// misbehaves.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { theme, fonts, radius, shadowAccent } from '../../theme';
import { Btn } from '../../components/ui';
import { IconArrowLeft } from '../../components/icons';
import { ar } from '../../i18n/ar';
import { digitsOnly } from '../../lib/format';

const RESEND_COOLDOWN_SECONDS = 30;

export default function OtpVerifyScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { phoneLogin, otpVerify } = useAuth();
  const phone: string = route.params?.phone || '';
  // No channel state any more. The server sends over WhatsApp and decides
  // for itself whether a number without WhatsApp needs an SMS instead, so
  // offering the user a switch would be offering a control we do not have.
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = useRef<TextInput>(null);

  // Countdown tick for the resend button.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Autofocus so users don't have to tap the code field.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  async function verify() {
    const clean = digitsOnly(code);
    if (clean.length !== 6) { setErr(ar.errors.bad_code || 'رمز غير صحيح'); return; }
    setBusy(true); setErr('');
    try {
      await otpVerify(phone, clean);
      // The AuthGate that queued us used navigation.replace, so on
      // success we pop this stack entry back to whichever screen
      // originally opened the AuthGate modal.
      navigation.goBack();
    } catch (e: any) {
      setErr((ar.errors as any)[e.message] || ar.errors.network);
    } finally { setBusy(false); }
  }

  async function resend() {
    if (cooldown > 0) return;
    setBusy(true); setErr('');
    try {
      await phoneLogin(phone);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e: any) {
      setErr((ar.errors as any)[e.message] || ar.errors.network);
    } finally { setBusy(false); }
  }

  const channelLabel = 'واتساب';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24, paddingHorizontal: 20,
      }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
            <View style={[{
              width: 36, height: 36, borderRadius: 10, backgroundColor: theme.accent,
              alignItems: 'center', justifyContent: 'center',
            }, shadowAccent]}>
              <Text style={{ color: '#fff', fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 14 }}>iQ</Text>
            </View>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>IQ Mobile</Text>
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
          fontFamily: fonts.arBold, fontSize: 26, color: theme.ink,
          letterSpacing: -0.5, lineHeight: 32, textAlign: 'right' }}>
          تحقّق من الرمز
        </Text>
        <Text style={{
          marginTop: 6, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, lineHeight: 21, textAlign: 'right',
        }}>
          أرسلنا لك رمزاً عبر {channelLabel} إلى الرقم {phone}
        </Text>

        {/* 6-digit code input. LTR so digits read naturally even in an
            RTL container. Large font so it's usable one-handed. */}
        <View style={{
          marginTop: 22,
          backgroundColor: theme.surface,
          borderRadius: radius.lg,
          borderWidth: 1.5,
          borderColor: code ? theme.accent : theme.line,
          paddingHorizontal: 16,
          minHeight: 64,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(v) => setCode(digitsOnly(v).slice(0, 6))}
            placeholder="- - - - - -"
            placeholderTextColor={theme.subtle}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoCorrect={false}
            style={{
              width: '100%',
              fontFamily: fonts.ltrBold,
              fontSize: 28,
              fontWeight: '700',
              color: theme.accentDeep,
              textAlign: 'center',
              letterSpacing: 8,
              paddingVertical: 12,
            }}
          />
        </View>

        {/* The whole defence against the commonest marketplace scam: a
            "buyer" says they will send a code to check the seller is real,
            then asks them to read it out. We cannot put this line in the
            WhatsApp message — that body is a Meta template on the provider's
            side — so this screen is where it has to live. Always visible,
            never dismissible. */}
        <View style={{
          marginTop: 16, padding: 12, borderRadius: radius.lg,
          backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
        }}>
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink, textAlign: 'right',
          }}>
            لا تشارك هذا الرمز مع أي شخص
          </Text>
          <Text style={{
            marginTop: 4, fontFamily: fonts.ar, fontSize: 11.5,
            color: theme.subtle, textAlign: 'right', lineHeight: 18,
          }}>
            لن يطلبه منك موظفو iQ Mobile ولا أي مشترٍ أو بائع. من يطلب الرمز يحاول سرقة حسابك.
          </Text>
        </View>

        {err ? (
          <Text style={{ marginTop: 14, fontFamily: fonts.ar, fontSize: 13, color: theme.danger, textAlign: 'right' }}>
            {err}
          </Text>
        ) : null}

        <View style={{ marginTop: 22 }}>
          <Btn kind="accent" full onPress={verify} busy={busy}>
            تأكيد
          </Btn>
        </View>

        {/* Resend only. The "send by SMS instead" button is gone: it
            promised a channel switch the provider does not expose, so it
            re-sent the identical WhatsApp message under a different label. */}
        <View style={{ marginTop: 22, gap: 8 }}>
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={cooldown > 0 || busy}
            onPress={() => resend()}
            style={{ paddingVertical: 8 }}
          >
            <Text style={{
              fontFamily: fonts.ar, fontSize: 13.5,
              color: cooldown > 0 ? theme.subtle : theme.accentDeep,
              textAlign: 'center',
            }}>
              {cooldown > 0 ? `إعادة إرسال الرمز بعد ${cooldown} ثانية` : 'إعادة إرسال الرمز'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
