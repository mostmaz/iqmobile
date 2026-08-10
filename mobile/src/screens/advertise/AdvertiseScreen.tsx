// "أعلن معنا" — banner reservation lead form. No in-app payment: the user
// enters their shop/company name + mobile, taps submit, and we open WhatsApp
// to the owner with a prefilled message carrying those details. The owner
// arranges the banner + payment manually from there.

import React, { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../../theme';
import { Header, Btn, Input, FieldLabel } from '../../components/ui';
import { IconSpark } from '../../components/icons';
import { openWhatsApp, OWNER_CONTACT_PHONE } from '../../lib/contact';

const BENEFITS = [
  'بانر إعلاني يظهر في أعلى الصفحة الرئيسية',
  'استهداف حسب المحافظة والماركة',
  'رابط مباشر لإعلانك أو موقعك',
];

export default function AdvertiseScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  function submit() {
    if (name.trim().length < 2) { Alert.alert('الاسم مطلوب', 'أدخل اسم المتجر أو الشركة.'); return; }
    if (phone.replace(/\D/g, '').length < 10) { Alert.alert('رقم غير صحيح', 'أدخل رقم هاتف صحيح.'); return; }
    const message =
      'Hi - i want to reserve a banner for promoting my business in iq mobile app.\n' +
      `الاسم: ${name.trim()}\n` +
      `الهاتف: ${phone.trim()}`;
    openWhatsApp(OWNER_CONTACT_PHONE, message);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="أعلن معنا" badge="SHOP" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <View style={{
          backgroundColor: theme.accentSoft, borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
          padding: 16, marginBottom: 16, flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 12,
        }}>
          <View style={{
            width: 40, height: 40, borderRadius: 12, backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <IconSpark size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'right' }}>
              روّج لمتجرك في تطبيق iQ
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, marginTop: 4, textAlign: 'right', lineHeight: 21 }}>
              احجز بانر إعلاني واوصل لآلاف المشترين في عموم العراق.
            </Text>
          </View>
        </View>

        <View style={{ marginBottom: 18, gap: 8 }}>
          {BENEFITS.map((b) => (
            <View key={b} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: theme.accent }} />
              <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right', flex: 1 }}>{b}</Text>
            </View>
          ))}
        </View>

        <FieldLabel>اسم المتجر / الشركة</FieldLabel>
        <Input value={name} onChangeText={setName} placeholder="مثال: متجر الفاروق للهواتف" />
        <View style={{ height: 12 }} />
        <FieldLabel>رقم الهاتف</FieldLabel>
        <Input value={phone} onChangeText={setPhone} placeholder="07XXXXXXXXX" numeric ltr />

        <View style={{ height: 20 }} />
        <Btn kind="success" full onPress={submit}>التواصل عبر واتساب</Btn>
        <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, marginTop: 12, textAlign: 'center', lineHeight: 20 }}>
          سيتم فتح واتساب برسالة جاهزة تحتوي بياناتك. نرتّب التفاصيل والدفع معك مباشرة.
        </Text>
      </ScrollView>
    </View>
  );
}
