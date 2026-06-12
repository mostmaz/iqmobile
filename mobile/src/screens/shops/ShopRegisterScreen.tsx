// "سجّل متجرك" — free self-serve shop registration. Flips the account to a
// shop and stores the public profile shown in the directory + shop page. A
// WhatsApp-contact alternative is offered for users who'd rather we set it up.

import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Header, Btn, Input, FieldLabel } from '../../components/ui';
import { IconStore, IconMsgCall } from '../../components/icons';
import { GovPicker } from '../../components/GovPicker';
import { Shops } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { GOV_AR_TO_EN, GOV_EN_TO_AR } from '../../lib/governorates';
import { openWhatsApp, OWNER_CONTACT_PHONE } from '../../lib/contact';

export default function ShopRegisterScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const editing = user?.seller_type === 'shop';

  const [shopName, setShopName] = useState((user as any)?.shop_name || user?.display_name || '');
  const [bio, setBio] = useState((user as any)?.shop_bio || '');
  const [shopPhone, setShopPhone] = useState((user as any)?.shop_phone || user?.phone || '');
  const [shopWhatsapp, setShopWhatsapp] = useState((user as any)?.shop_whatsapp || '');
  const [address, setAddress] = useState((user as any)?.shop_address || '');
  const [govAr, setGovAr] = useState(user?.governorate ? (GOV_EN_TO_AR[user.governorate] || '') : '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (shopName.trim().length < 2) { Alert.alert('اسم المتجر مطلوب', 'أدخل اسماً واضحاً لمتجرك.'); return; }
    if (!shopPhone.trim() && !shopWhatsapp.trim()) {
      Alert.alert('وسيلة تواصل مطلوبة', 'أضف رقم هاتف أو واتساب ليتمكن المشترون من التواصل معك.');
      return;
    }
    setBusy(true);
    try {
      const result = await Shops.register({
        shop_name: shopName.trim(),
        shop_bio: bio.trim() || undefined,
        shop_phone: shopPhone.trim() || undefined,
        shop_whatsapp: shopWhatsapp.trim() || undefined,
        shop_address: address.trim() || undefined,
        governorate: govAr ? GOV_AR_TO_EN[govAr] : undefined,
      });
      await refresh();
      qc.invalidateQueries({ queryKey: ['shops'] });
      Alert.alert(editing ? 'تم حفظ متجرك ✅' : 'تم تسجيل متجرك 🎉', 'يظهر متجرك الآن في قسم المتاجر.', [
        { text: 'عرض متجري', onPress: () => navigation.replace('ShopDetail', { id: result.id }) },
      ]);
    } catch (e: any) {
      const code = e?.data?.error || e?.message;
      const map: Record<string, string> = {
        bad_shop_name: 'اسم المتجر غير صالح.',
        bad_shop_phone: 'رقم الهاتف غير صحيح.',
        bad_shop_whatsapp: 'رقم الواتساب غير صحيح.',
        contact_required: 'أضف رقم هاتف أو واتساب.',
        bad_governorate: 'اختر محافظة صحيحة.',
      };
      Alert.alert('تعذّر الحفظ', map[code] || 'حدث خطأ، حاول مجدداً.');
    } finally {
      setBusy(false);
    }
  }

  function contactUs() {
    openWhatsApp(OWNER_CONTACT_PHONE, 'مرحباً، أريد تسجيل متجري في تطبيق iQ.');
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={editing ? 'إدارة متجري' : 'سجّل متجرك'} badge="SHOP" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {!editing ? (
          <View style={{
            backgroundColor: theme.accentSoft, borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
            padding: 16, marginBottom: 16, flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
          }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
              <IconStore size={20} color="#fff" sw={1.8} />
            </View>
            <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right', lineHeight: 21 }}>
              التسجيل مجاني. سيظهر متجرك في دليل المتاجر مع كل إعلاناتك ووسائل التواصل.
            </Text>
          </View>
        ) : null}

        <FieldLabel>اسم المتجر</FieldLabel>
        <Input value={shopName} onChangeText={setShopName} placeholder="مثال: متجر الفاروق للهواتف" />

        <View style={{ height: 12 }} />
        <FieldLabel>المحافظة</FieldLabel>
        <GovPicker valueAr={govAr} onChangeAr={setGovAr} />

        <View style={{ height: 12 }} />
        <FieldLabel>رقم الهاتف</FieldLabel>
        <Input value={shopPhone} onChangeText={setShopPhone} placeholder="07XXXXXXXXX" numeric ltr />

        <View style={{ height: 12 }} />
        <FieldLabel>واتساب (اختياري)</FieldLabel>
        <Input value={shopWhatsapp} onChangeText={setShopWhatsapp} placeholder="07XXXXXXXXX" numeric ltr />

        <View style={{ height: 12 }} />
        <FieldLabel>العنوان (اختياري)</FieldLabel>
        <Input value={address} onChangeText={setAddress} placeholder="الشارع / المنطقة" />

        <View style={{ height: 12 }} />
        <FieldLabel>نبذة عن المتجر (اختياري)</FieldLabel>
        <Input value={bio} onChangeText={setBio} placeholder="ماذا تبيع؟ ما الذي يميّز متجرك؟" multiline />

        <View style={{ height: 22 }} />
        <Btn kind="accent" full busy={busy} onPress={submit}>{editing ? 'حفظ التغييرات' : 'تسجيل المتجر'}</Btn>

        <View style={{ height: 12 }} />
        <Btn kind="successSoft" full onPress={contactUs}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <IconMsgCall size={16} color={theme.success} />
            <Text style={{ color: theme.success, fontFamily: fonts.arBold, fontSize: 15, fontWeight: '600' }}>أو سجّل عبر واتساب</Text>
          </View>
        </Btn>
      </ScrollView>
    </View>
  );
}
