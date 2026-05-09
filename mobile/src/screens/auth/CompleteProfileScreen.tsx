// CompleteProfileScreen — first-login onboarding form. Triggered as a
// modal whenever an authenticated user has `profile_completed === false`.
// Required fields: display_name. If the user picks "shop" as the seller
// type, also required: storefront image upload + GPS location.
//
// Once submitted, the server flips profile_completed to true, the user's
// remaining edit budgets stay at 2 each (this initial setup doesn't count
// against them), and the modal pops itself.

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useAuth } from '../../auth/AuthContext';
import { theme, fonts, radius } from '../../theme';
import { Btn, FieldLabel, Input } from '../../components/ui';
import { IconCheck, IconPin, IconID } from '../../components/icons';
import { completeProfile } from '../../api/upload';
import { compressForChat } from '../../lib/imageCompress';
import { ar } from '../../i18n/ar';

export default function CompleteProfileScreen() {
  const { refresh } = useAuth();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [sellerType, setSellerType] = useState<'individual' | 'shop'>('individual');
  const [shopImage, setShopImage] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [locBusy, setLocBusy] = useState(false);

  async function pickShopImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('الصور', 'فعّل إذن الصور من إعدادات الجهاز.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1, allowsEditing: true,
    });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    try {
      const compressed = await compressForChat(r.assets[0].uri);
      setShopImage(compressed);
    } catch (e: any) {
      Alert.alert('خطأ', e.message);
    }
  }

  async function fetchLocation() {
    setLocBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('الموقع', 'فعّل إذن الموقع من إعدادات الجهاز.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e: any) {
      Alert.alert('خطأ', 'تعذر تحديد الموقع.');
    } finally {
      setLocBusy(false);
    }
  }

  async function submit() {
    setErr('');
    const trimmed = name.trim();
    if (trimmed.length < 2) { setErr('الاسم قصير جداً'); return; }
    if (sellerType === 'shop') {
      if (!shopImage) { setErr('أضف صورة لافتة المتجر'); return; }
      if (!coords) { setErr('حدد موقع المتجر'); return; }
    }
    setBusy(true);
    try {
      await completeProfile({
        display_name: trimmed,
        seller_type: sellerType,
        shopImageUri: sellerType === 'shop' ? shopImage! : undefined,
        shop_lat: sellerType === 'shop' ? coords!.lat : undefined,
        shop_lng: sellerType === 'shop' ? coords!.lng : undefined,
      });
      await refresh();
      // No explicit navigation — the gate in RootNav unmounts this modal
      // automatically when user.profile_completed flips to true.
    } catch (e: any) {
      setErr((ar.errors as any)[e.message] || e.message || 'فشل الحفظ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 18, paddingBottom: insets.bottom + 30, paddingHorizontal: 20,
      }}>
        <Text style={{
          fontFamily: fonts.arBold, fontWeight: '700', fontSize: 26, color: theme.ink,
          letterSpacing: -0.5, lineHeight: 32, textAlign: 'right',
        }}>
          أكمل ملفك الشخصي
        </Text>
        <Text style={{
          marginTop: 6, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, lineHeight: 21, textAlign: 'right',
        }}>
          سيظهر اسمك للمشترين على إعلاناتك. يمكنك تعديل الاسم مرتين فقط لاحقاً.
        </Text>

        {/* Name */}
        <View style={{ marginTop: 22 }}>
          <FieldLabel>الاسم أو اسم المتجر</FieldLabel>
          <Input value={name} onChangeText={setName} placeholder="مثلاً: أحمد · متجر الكرادة" />
        </View>

        {/* Seller type chooser */}
        <View style={{ marginTop: 18 }}>
          <FieldLabel>نوع الحساب</FieldLabel>
          <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
            <TypeBtn
              active={sellerType === 'individual'}
              onPress={() => setSellerType('individual')}
              title="شخص"
              subtitle="بيع وشراء"
            />
            <TypeBtn
              active={sellerType === 'shop'}
              onPress={() => setSellerType('shop')}
              title="متجر"
              subtitle="مع لافتة وموقع"
            />
          </View>
        </View>

        {/* Shop-only fields */}
        {sellerType === 'shop' ? (
          <>
            <View style={{ marginTop: 18 }}>
              <FieldLabel>صورة لافتة المتجر</FieldLabel>
              <TouchableOpacity onPress={pickShopImage} activeOpacity={0.85} style={{
                height: 160, borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed',
                borderColor: theme.line, backgroundColor: theme.surface,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                {shopImage ? (
                  <Image source={{ uri: shopImage }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}>
                      اضغط لاختيار صورة
                    </Text>
                    <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, color: theme.subtle }}>
                      JPG / PNG
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              <Text style={{ marginTop: 4, fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right' }}>
                يمكنك تغيير الصورة مرتين فقط لاحقاً.
              </Text>
            </View>

            <View style={{ marginTop: 18 }}>
              <FieldLabel>موقع المتجر</FieldLabel>
              <TouchableOpacity onPress={fetchLocation} activeOpacity={0.85} style={{
                paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.lg,
                borderWidth: 1, borderColor: coords ? theme.success : theme.line,
                backgroundColor: coords ? theme.successSoft : theme.surface,
                flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
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
              <Text style={{ marginTop: 4, fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right' }}>
                يمكنك تغيير الموقع مرتين فقط لاحقاً.
              </Text>
            </View>
          </>
        ) : null}

        {err ? (
          <Text style={{ marginTop: 14, fontFamily: fonts.ar, fontSize: 13, color: theme.danger, textAlign: 'right' }}>
            {err}
          </Text>
        ) : null}

        <View style={{ marginTop: 24 }}>
          <Btn kind="accent" full onPress={submit} busy={busy}>
            متابعة
          </Btn>
        </View>
      </ScrollView>
    </View>
  );
}

function TypeBtn({ active, onPress, title, subtitle }: { active: boolean; onPress: () => void; title: string; subtitle: string }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{
      flex: 1, paddingVertical: 14, paddingHorizontal: 12, borderRadius: radius.lg,
      borderWidth: active ? 2 : 1,
      borderColor: active ? theme.accent : theme.line,
      backgroundColor: active ? theme.accentSoft : theme.surface,
      alignItems: 'center',
    }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: active ? theme.accentDeep : theme.ink }}>
        {title}
      </Text>
      <Text style={{ marginTop: 2, fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}
