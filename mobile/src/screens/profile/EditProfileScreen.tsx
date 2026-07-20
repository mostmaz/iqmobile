// EditProfileScreen — post-onboarding profile editor for the account
// identity (name, governorate, city). Surfaces the per-field edit budget
// set up during CompleteProfile (each tracked field can change at most
// twice); when a field's budget is exhausted we lock the input and show
// how many edits were available.
//
// All shop-facing fields (banner, location, phones, WhatsApp, Facebook,
// Instagram, price-list images) live on the dedicated "إدارة متجري"
// screen (ShopRegisterScreen) so shop editing is not split across screens.

import React, { useState } from 'react';
import { View, ScrollView, Alert, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts } from '../../theme';
import { Btn, FieldLabel, Header, Input } from '../../components/ui';
import { Auth } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, DEFAULT_GOV_AR } from '../../lib/governorates';
import { GovPicker } from '../../components/GovPicker';
import { ar } from '../../i18n/ar';

export default function EditProfileScreen({ navigation }: any) {
  const { user, refresh } = useAuth();
  const insets = useSafeAreaInsets();

  // Local form state, seeded from current user values.
  const [name, setName] = useState(user?.display_name || '');
  const [govAr, setGovAr] = useState<string>(GOV_EN_TO_AR[user?.governorate || ''] || DEFAULT_GOV_AR);
  const [city, setCity] = useState(user?.city || '');
  const [busy, setBusy] = useState(false);

  // Edit budgets — server-issued counters. 0 means the field is locked.
  const nameLeft = user?.name_edits_remaining ?? 2;

  // Guard every mutation against guest sessions. EditProfile is reachable
  // from a stack-restored state on a guest token (e.g. after the user
  // logged out mid-edit), and previously `Auth.patchMe` from that path
  // either 401'd silently or — worse — wrote a guest identity to the
  // server's user row.
  function ensureRealUser(): boolean {
    if (!user || user.is_guest) {
      Alert.alert('تسجيل الدخول', 'سجّل الدخول لتعديل الملف الشخصي.');
      navigation.goBack();
      return false;
    }
    return true;
  }

  async function save() {
    if (!ensureRealUser()) return;
    setBusy(true);
    try {
      // Only include fields that BOTH the user can still edit AND that
      // actually changed. Previously governorate/city were always sent,
      // which on a server with a per-field edit budget would silently
      // burn an edit on every save tap.
      const body: any = {};
      const govEn = GOV_AR_TO_EN[govAr];
      if (govEn && govEn !== user?.governorate) body.governorate = govEn;
      const newCity = city || null;
      if (newCity !== (user?.city || null)) body.city = newCity;
      if (nameLeft > 0 && name !== user?.display_name) body.display_name = name;
      if (Object.keys(body).length > 0) { await Auth.patchMe(body); await refresh(); }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setBusy(false); }
  }

  function EditsLeft({ left, label }: { left: number; label: string }) {
    const color = left === 0 ? theme.danger : left === 1 ? theme.accentDeep : theme.subtle;
    const txt = left === 0
      ? `لا يمكن تغيير ${label} أكثر`
      : `${label} — يمكنك التغيير ${left} ${left === 1 ? 'مرة' : 'مرات'} أخرى`;
    return (
      <Text style={{ marginTop: 4, fontFamily: fonts.ar, fontSize: 11, color, textAlign: 'right' }}>
        {txt}
      </Text>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={ar.profile.edit} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <FieldLabel>{ar.auth.displayName}</FieldLabel>
        {/* When the name field is locked (budget exhausted) we previously
            kept it visually editable but silently swallowed keystrokes via
            an empty onChangeText. Users typed, hit save, and saw nothing
            change with no feedback. `editable={false}` flips it to the
            standard locked-input look so the EditsLeft message reads as
            the obvious reason. */}
        <Input value={name} onChangeText={setName} editable={nameLeft > 0} />
        <EditsLeft left={nameLeft} label="الاسم" />

        <FieldLabel style={{ marginTop: 16 }}>{ar.auth.governorate}</FieldLabel>
        <GovPicker valueAr={govAr} onChangeAr={setGovAr} />

        <FieldLabel style={{ marginTop: 14 }}>{ar.auth.city}</FieldLabel>
        <Input value={city} onChangeText={setCity} placeholder="القضاء (اختياري)" />

        <View style={{ marginTop: 24 }}>
          <Btn kind="primary" full onPress={save} busy={busy}>حفظ</Btn>
        </View>
      </ScrollView>
    </View>
  );
}
