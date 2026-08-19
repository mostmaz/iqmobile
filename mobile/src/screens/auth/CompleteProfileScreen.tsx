// CompleteProfileScreen — first-login onboarding form. Triggered as a
// modal whenever an authenticated user has `profile_completed === false`.
// Required fields: display_name. If the user picks "shop" as the seller
// type, also required: storefront image upload + GPS location.
//
// Once submitted, the server flips profile_completed to true, the user's
// remaining edit budgets stay at 2 each (this initial setup doesn't count
// against them), and the modal pops itself.

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Img } from '../../components/Img';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useAuth } from '../../auth/AuthContext';
import { theme, fonts, radius } from '../../theme';
import { Btn, FieldLabel, Input } from '../../components/ui';
import { IconCheck, IconPin, IconID, IconStore, IconChevronLeft, IconArrowLeft } from '../../components/icons';
import { completeProfile } from '../../api/upload';
import { compressForAvatar } from '../../lib/imageCompress';
import { ar } from '../../i18n/ar';

export default function CompleteProfileScreen() {
  const { refresh } = useAuth();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  // Two-stage onboarding: the account-type choice is its own full window
  // FIRST (big person/shop cards), then the details form for that type.
  // The old layout buried the choice as a pill row inside the form and
  // most shop owners sailed past it as "individual".
  const [stage, setStage] = useState<'type' | 'details'>('type');
  const [sellerType, setSellerType] = useState<'individual' | 'shop'>('individual');
  const [shopImage, setShopImage] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  // Busy-lock on the picker so rapid taps don't launch multiple system
  // picker sheets in parallel — that races the setShopImage calls and on
  // some Android devices crashes the host activity.
  const [pickBusy, setPickBusy] = useState(false);

  async function pickShopImage() {
    if (pickBusy) return;
    setPickBusy(true);
    try {
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
        const compressed = await compressForAvatar(r.assets[0].uri);
        setShopImage(compressed);
      } catch (e: any) {
        Alert.alert('خطأ', e?.message || 'تعذر تحميل الصورة');
      }
    } finally {
      setPickBusy(false);
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
      // The post-completion redirect to the Sell tab happens in RootNav
      // (it watches `needsProfileCompletion` and fires once the swap to
      // MainTabs has actually mounted — a setTimeout from here would
      // race with React's re-render and silently no-op).
      await refresh();
    } catch (e: any) {
      setErr((ar.errors as any)[e.message] || e.message || 'فشل الحفظ');
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'type') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView contentContainerStyle={{
          paddingTop: insets.top + 18, paddingBottom: insets.bottom + 30, paddingHorizontal: 20,
        }}>
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 26, color: theme.ink,
            letterSpacing: -0.5, lineHeight: 32, textAlign: 'right' }}>
            أهلاً بك في iQ Mobile
          </Text>
          <Text style={{
            marginTop: 6, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, lineHeight: 21, textAlign: 'right',
          }}>
            اختر نوع الحساب للبدء.
          </Text>

          <ChoiceCard
            icon={<IconID size={26} color={theme.accentDeep} sw={1.8} />}
            title="شخص"
            subtitle="أبيع وأشتري الأجهزة الشخصية"
            onPress={() => { setSellerType('individual'); setErr(''); setStage('details'); }}
          />
          <ChoiceCard
            icon={<IconStore size={26} color={theme.accentDeep} sw={1.8} />}
            title="متجر"
            subtitle="عندي محل — لافتة وموقع وصفحة متجر خاصة"
            onPress={() => { setSellerType('shop'); setErr(''); setStage('details'); }}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 18, paddingBottom: insets.bottom + 30, paddingHorizontal: 20,
      }}>
        {/* Back to the type choice — a full round-trip keeps the shop
            fields' state, only the window changes. */}
        <TouchableOpacity
          onPress={() => { setErr(''); setStage('type'); }}
          hitSlop={8}
          style={{ alignSelf: 'flex-start', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 2, marginInlineStart: -10 }}
          activeOpacity={0.6}
        >
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
          </View>
        </TouchableOpacity>
        <Text style={{
          fontFamily: fonts.arBold, fontSize: 26, color: theme.ink,
          letterSpacing: -0.5, lineHeight: 32, textAlign: 'right' }}>
          {sellerType === 'shop' ? 'معلومات المتجر' : 'أكمل ملفك الشخصي'}
        </Text>
        <Text style={{
          marginTop: 6, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, lineHeight: 21, textAlign: 'right',
        }}>
          {sellerType === 'shop'
            ? 'سيظهر اسم متجرك ولافتته للمشترين. يمكنك التعديل مرتين فقط لاحقاً.'
            : 'سيظهر اسمك للمشترين على إعلاناتك. يمكنك تعديل الاسم مرتين فقط لاحقاً.'}
        </Text>

        {/* Name */}
        <View style={{ marginTop: 22 }}>
          <FieldLabel>{sellerType === 'shop' ? 'اسم المتجر' : 'الاسم'}</FieldLabel>
          <Input value={name} onChangeText={setName}
            placeholder={sellerType === 'shop' ? 'مثلاً: متجر الكرادة' : 'مثلاً: أحمد'} />
        </View>

        {/* Shop-only fields */}
        {sellerType === 'shop' ? (
          <>
            <View style={{ marginTop: 18 }}>
              <FieldLabel>صورة لافتة المتجر</FieldLabel>
              <TouchableOpacity onPress={pickShopImage} disabled={pickBusy} activeOpacity={0.85} style={{
                height: 160, borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed',
                borderColor: theme.line, backgroundColor: theme.surface,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                {shopImage ? (
                  <Img source={{ uri: shopImage }} style={{ width: '100%', height: '100%' }} />
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
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: coords ? theme.success : theme.ink, textAlign: 'right' }}>
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

function ChoiceCard({ icon, title, subtitle, onPress }: { icon: React.ReactNode; title: string; subtitle: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{
      marginTop: 14, padding: 18, borderRadius: radius.xl,
      borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface,
      flexDirection: 'row-reverse', alignItems: 'center', gap: 14,
    }}>
      <View style={{
        width: 52, height: 52, borderRadius: radius.lg, backgroundColor: theme.accentSoft,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}>
          {title}
        </Text>
        <Text style={{ marginTop: 3, fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', lineHeight: 18 }}>
          {subtitle}
        </Text>
      </View>
      <View style={{ transform: [{ scaleX: 1 }] }}>
        <IconChevronLeft size={16} color={theme.subtle} sw={2} />
      </View>
    </TouchableOpacity>
  );
}
