// EditProfileScreen — post-onboarding profile editor. Surfaces the
// per-field edit budget set up during CompleteProfile (each tracked
// field can change at most twice). When a field's budget is exhausted
// we lock the input and show the user how many edits they had.

import React, { useState } from 'react';
import { View, ScrollView, Alert, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Img } from '../../components/Img';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { theme, fonts, radius } from '../../theme';
import { Btn, FieldLabel, Header, Input } from '../../components/ui';
import { IconPin, IconCheck } from '../../components/icons';
import { Auth } from '../../api/endpoints';
import { updateShopImage, fullImageUrl } from '../../api/upload';
import { compressForAvatar } from '../../lib/imageCompress';
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
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    user?.shop_lat != null && user?.shop_lng != null
      ? { lat: user.shop_lat, lng: user.shop_lng } : null,
  );
  const [busy, setBusy] = useState(false);
  const [shopBusy, setShopBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);

  // Edit budgets — server-issued counters. 0 means the field is locked.
  const nameLeft = user?.name_edits_remaining ?? 2;
  const shopImgLeft = user?.shop_image_edits_remaining ?? 2;
  const shopLocLeft = user?.shop_location_edits_remaining ?? 2;
  const isShop = user?.seller_type === 'shop';

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
      if (isShop && shopLocLeft > 0 && coords && (coords.lat !== user?.shop_lat || coords.lng !== user?.shop_lng)) {
        body.shop_lat = coords.lat;
        body.shop_lng = coords.lng;
      }
      // Bail with no network call if nothing changed.
      if (Object.keys(body).length === 0) {
        navigation.goBack();
        return;
      }
      await Auth.patchMe(body);
      await refresh();
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setBusy(false); }
  }

  async function pickAndUploadShopImage() {
    if (!ensureRealUser()) return;
    if (shopImgLeft === 0) {
      Alert.alert('انتهت التعديلات', 'لقد استنفذت تعديلات صورة لافتة المتجر.');
      return;
    }
    if (shopBusy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('الصور', 'فعّل إذن الصور من إعدادات الجهاز.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1, allowsEditing: true,
    });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    setShopBusy(true);
    try {
      const compressed = await compressForAvatar(r.assets[0].uri);
      await updateShopImage(compressed);
      await refresh();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setShopBusy(false); }
  }

  async function fetchLocation() {
    if (!ensureRealUser()) return;
    if (shopLocLeft === 0) {
      Alert.alert('انتهت التعديلات', 'لقد استنفذت تعديلات موقع المتجر.');
      return;
    }
    setLocBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('الموقع', 'فعّل إذن الموقع من إعدادات الجهاز.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert('خطأ', 'تعذر تحديد الموقع.');
    } finally { setLocBusy(false); }
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

        {/* Shop-only fields. Hidden entirely for individual accounts. */}
        {isShop ? (
          <>
            <FieldLabel style={{ marginTop: 22 }}>صورة لافتة المتجر</FieldLabel>
            <TouchableOpacity onPress={pickAndUploadShopImage} activeOpacity={0.85} disabled={shopImgLeft === 0 || shopBusy} style={{
              height: 160, borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed',
              borderColor: shopImgLeft === 0 ? theme.line : theme.accent,
              backgroundColor: theme.surface,
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              opacity: shopImgLeft === 0 ? 0.5 : 1,
            }}>
              {shopBusy ? (
                <ActivityIndicator color={theme.accent} />
              ) : user?.shop_image_path ? (
                <Img source={{ uri: fullImageUrl(user.shop_image_path) }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}>اضغط لاختيار صورة</Text>
              )}
            </TouchableOpacity>
            <EditsLeft left={shopImgLeft} label="صورة اللافتة" />

            <FieldLabel style={{ marginTop: 18 }}>موقع المتجر</FieldLabel>
            <TouchableOpacity onPress={fetchLocation} activeOpacity={0.85} disabled={shopLocLeft === 0 || locBusy} style={{
              paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.lg,
              borderWidth: 1, borderColor: coords ? theme.success : theme.line,
              backgroundColor: coords ? theme.successSoft : theme.surface,
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
              opacity: shopLocLeft === 0 ? 0.5 : 1,
            }}>
              <IconPin size={18} color={coords ? theme.success : theme.subtle} sw={1.7} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, fontWeight: '600', color: coords ? theme.success : theme.ink, textAlign: 'right' }}>
                  {coords ? 'تم تحديد الموقع' : 'استخدم موقعي الحالي'}
                </Text>
                {coords ? (
                  <Text style={{ marginTop: 2, fontFamily: fonts.mono, fontSize: 11, color: theme.subtle, textAlign: 'right', writingDirection: 'ltr' }}>
                    {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  </Text>
                ) : null}
              </View>
              {locBusy ? <ActivityIndicator color={theme.accent} size="small" /> : (
                coords ? <IconCheck size={18} color={theme.success} sw={2.2} /> : null
              )}
            </TouchableOpacity>
            <EditsLeft left={shopLocLeft} label="موقع المتجر" />
          </>
        ) : null}

        <View style={{ marginTop: 24 }}>
          <Btn kind="primary" full onPress={save} busy={busy}>حفظ</Btn>
        </View>
      </ScrollView>
    </View>
  );
}
