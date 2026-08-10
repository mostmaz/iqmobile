// "سجّل متجرك" / "إدارة متجري" — the single self-serve shop manager. Flips the
// account to a shop and owns every shop-facing field: contact channels
// (phones list, WhatsApp), social links (Facebook, Instagram), the shop banner,
// map location, and the price-list image gallery shops post from Facebook.
//
// Text fields are collected at first registration; the image/banner/location
// controls need a shop row to attach to, so they only appear once the account
// is already a shop (edit mode). A WhatsApp-contact alternative is offered for
// users who'd rather we set it up.

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { theme, fonts, radius } from '../../theme';
import { Header, Btn, Input, FieldLabel } from '../../components/ui';
import { Img } from '../../components/Img';
import { IconStore, IconMsgCall, IconPin, IconCheck } from '../../components/icons';
import { GovPicker } from '../../components/GovPicker';
import { Auth, Shops, ShopImage } from '../../api/endpoints';
import { updateShopImage, uploadShopImages, fullImageUrl } from '../../api/upload';
import { compressForAvatar, compressForListing } from '../../lib/imageCompress';
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
  // Public phone numbers (branch lines) — each becomes a call button on the
  // shop page. Seeded from the phones list, falling back to the legacy single
  // shop_phone / the account phone.
  const [phones, setPhones] = useState<string[]>(
    (user as any)?.shop_phones?.length
      ? (user as any).shop_phones
      : ((user as any)?.shop_phone ? [(user as any).shop_phone] : (user?.phone ? [user.phone] : [''])),
  );
  const [whatsapp, setWhatsapp] = useState((user as any)?.shop_whatsapp || '');
  const [facebook, setFacebook] = useState((user as any)?.shop_facebook || '');
  const [instagram, setInstagram] = useState((user as any)?.shop_instagram || '');
  const [address, setAddress] = useState((user as any)?.shop_address || '');
  const [govAr, setGovAr] = useState(user?.governorate ? (GOV_EN_TO_AR[user.governorate] || '') : '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    (user as any)?.shop_lat != null && (user as any)?.shop_lng != null
      ? { lat: (user as any).shop_lat, lng: (user as any).shop_lng } : null,
  );
  // Price-list images are managed immediately (upload/delete), not on save.
  const [shopImages, setShopImages] = useState<ShopImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);

  // Edit budgets — server-issued counters. 0 means the field is locked.
  const shopImgLeft = user?.shop_image_edits_remaining ?? 2;
  const shopLocLeft = user?.shop_location_edits_remaining ?? 2;

  useEffect(() => {
    let alive = true;
    if (editing && user?.id) {
      Shops.get(user.id).then((d) => { if (alive) setShopImages(d.shop_images || []); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [editing, user?.id]);

  async function submit() {
    if (shopName.trim().length < 2) { Alert.alert('اسم المتجر مطلوب', 'أدخل اسماً واضحاً لمتجرك.'); return; }
    const cleanPhones = phones.map((p) => p.trim()).filter(Boolean);
    if (!cleanPhones.length && !whatsapp.trim()) {
      Alert.alert('وسيلة تواصل مطلوبة', 'أضف رقم هاتف أو واتساب ليتمكن المشترون من التواصل معك.');
      return;
    }
    setBusy(true);
    try {
      const result = await Shops.register({
        shop_name: shopName.trim(),
        shop_bio: bio.trim() || undefined,
        shop_phones: cleanPhones,
        shop_whatsapp: whatsapp.trim() || undefined,
        shop_address: address.trim() || undefined,
        governorate: govAr ? GOV_AR_TO_EN[govAr] : undefined,
        shop_facebook: facebook.trim() || null,
        shop_instagram: instagram.trim() || null,
      });
      // Map location (edit mode only, when changed and budget remains).
      if (editing && shopLocLeft > 0 && coords &&
        (coords.lat !== (user as any)?.shop_lat || coords.lng !== (user as any)?.shop_lng)) {
        await Auth.patchMe({ shop_lat: coords.lat, shop_lng: coords.lng });
      }
      await refresh();
      qc.invalidateQueries({ queryKey: ['shops'] });
      if (editing) {
        Alert.alert('تم حفظ متجرك ✅', 'تم تحديث معلومات متجرك.', [{ text: 'تم' }]);
      } else {
        // New shop — refresh() has flipped the screen into edit mode, so the
        // banner / price-image controls are now visible below. Let them add
        // images here, or jump straight to the public page.
        Alert.alert('تم تسجيل متجرك 🎉', 'يمكنك الآن إضافة صور قائمة الأسعار وشعار المتجر من نفس الصفحة.', [
          { text: 'إضافة الصور', style: 'default' },
          { text: 'عرض متجري', onPress: () => navigation.replace('ShopDetail', { id: result.id }) },
        ]);
      }
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

  async function pickAndUploadBanner() {
    if (shopImgLeft === 0) { Alert.alert('انتهت التعديلات', 'لقد استنفذت تعديلات شعار المتجر.'); return; }
    if (bannerBusy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('الصور', 'فعّل إذن الصور من إعدادات الجهاز.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1, allowsEditing: true,
    });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    setBannerBusy(true);
    try {
      const compressed = await compressForAvatar(r.assets[0].uri);
      await updateShopImage(compressed);
      await refresh();
    } catch (e: any) {
      Alert.alert('خطأ', 'تعذر رفع الصورة، حاول مجدداً.');
    } finally { setBannerBusy(false); }
  }

  async function fetchLocation() {
    if (shopLocLeft === 0) { Alert.alert('انتهت التعديلات', 'لقد استنفذت تعديلات موقع المتجر.'); return; }
    setLocBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('الموقع', 'فعّل إذن الموقع من إعدادات الجهاز.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert('خطأ', 'تعذر تحديد الموقع.');
    } finally { setLocBusy(false); }
  }

  async function pickAndAddPriceImages() {
    if (imgBusy) return;
    if (shopImages.length >= 12) { Alert.alert('الحد الأقصى', 'يمكنك إضافة حتى 12 صورة.'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('الصور', 'فعّل إذن الصور من إعدادات الجهاز.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1,
      allowsMultipleSelection: true, selectionLimit: 12 - shopImages.length,
    });
    if (r.canceled || !r.assets?.length) return;
    setImgBusy(true);
    try {
      const uris: string[] = [];
      for (const a of r.assets) { if (a.uri) uris.push(await compressForListing(a.uri)); }
      const res = await uploadShopImages(uris);
      setShopImages(res.images);
    } catch (e: any) {
      Alert.alert('خطأ', 'تعذر رفع الصور، حاول مجدداً.');
    } finally { setImgBusy(false); }
  }

  async function removePriceImage(imageId: number) {
    if (imgBusy) return;
    setImgBusy(true);
    try {
      const res = await Shops.removeImage(imageId);
      setShopImages(res.images);
    } catch (e: any) {
      Alert.alert('خطأ', 'تعذر حذف الصورة، حاول مجدداً.');
    } finally { setImgBusy(false); }
  }

  function EditsLeft({ left, label }: { left: number; label: string }) {
    const color = left === 0 ? theme.danger : left === 1 ? theme.accentDeep : theme.subtle;
    const txt = left === 0
      ? `لا يمكن تغيير ${label} أكثر`
      : `${label} — يمكنك التغيير ${left} ${left === 1 ? 'مرة' : 'مرات'} أخرى`;
    return (
      <Text style={{ marginTop: 4, fontFamily: fonts.ar, fontSize: 11, color, textAlign: 'right' }}>{txt}</Text>
    );
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

        {/* Public phone numbers (branch lines). Each becomes a call button on
            the shop page. */}
        <FieldLabel style={{ marginTop: 12 }}>أرقام الهاتف</FieldLabel>
        {phones.map((p, i) => (
          <View key={i} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: i ? 8 : 0 }}>
            <View style={{ flex: 1 }}>
              <Input value={p} onChangeText={(v: string) => setPhones((arr) => arr.map((x, j) => (j === i ? v : x)))} placeholder="07XXXXXXXXX" numeric ltr />
            </View>
            {phones.length > 1 ? (
              <TouchableOpacity onPress={() => setPhones((arr) => arr.filter((_, j) => j !== i))} style={{ padding: 8 }}>
                <Text style={{ color: theme.danger, fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {phones.length < 6 ? (
          <TouchableOpacity onPress={() => setPhones((arr) => [...arr, ''])} style={{ marginTop: 8 }}>
            <Text style={{ color: theme.accent, fontFamily: fonts.arBold, fontSize: 13, textAlign: 'right' }}>+ إضافة رقم آخر</Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ height: 12 }} />
        <FieldLabel>واتساب (اختياري)</FieldLabel>
        <Input value={whatsapp} onChangeText={setWhatsapp} placeholder="07XXXXXXXXX" numeric ltr />

        <View style={{ height: 12 }} />
        <FieldLabel>رابط فيسبوك (اختياري)</FieldLabel>
        <Input value={facebook} onChangeText={setFacebook} placeholder="facebook.com/yourpage" ltr />

        <View style={{ height: 12 }} />
        <FieldLabel>رابط انستغرام (اختياري)</FieldLabel>
        <Input value={instagram} onChangeText={setInstagram} placeholder="instagram.com/yourpage" ltr />

        <View style={{ height: 12 }} />
        <FieldLabel>العنوان (اختياري)</FieldLabel>
        <Input value={address} onChangeText={setAddress} placeholder="الشارع / المنطقة" />

        <View style={{ height: 12 }} />
        <FieldLabel>نبذة عن المتجر (اختياري)</FieldLabel>
        <Input value={bio} onChangeText={setBio} placeholder="ماذا تبيع؟ ما الذي يميّز متجرك؟" multiline />

        {editing ? (
          <>
            {/* Shop banner / logo. */}
            <FieldLabel style={{ marginTop: 22 }}>شعار المتجر</FieldLabel>
            <TouchableOpacity onPress={pickAndUploadBanner} activeOpacity={0.85} disabled={shopImgLeft === 0 || bannerBusy} style={{
              height: 160, borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed',
              borderColor: shopImgLeft === 0 ? theme.line : theme.accent, backgroundColor: theme.surface,
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden', opacity: shopImgLeft === 0 ? 0.5 : 1,
            }}>
              {bannerBusy ? (
                <ActivityIndicator color={theme.accent} />
              ) : (user as any)?.shop_image_path ? (
                <Img source={{ uri: fullImageUrl((user as any).shop_image_path) }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}>اضغط لاختيار صورة</Text>
              )}
            </TouchableOpacity>
            <EditsLeft left={shopImgLeft} label="شعار المتجر" />

            {/* Map location. */}
            <FieldLabel style={{ marginTop: 18 }}>موقع المتجر</FieldLabel>
            <TouchableOpacity onPress={fetchLocation} activeOpacity={0.85} disabled={shopLocLeft === 0 || locBusy} style={{
              paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.lg,
              borderWidth: 1, borderColor: coords ? theme.success : theme.line,
              backgroundColor: coords ? theme.successSoft : theme.surface,
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10, opacity: shopLocLeft === 0 ? 0.5 : 1,
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
            <EditsLeft left={shopLocLeft} label="موقع المتجر" />

            {/* Price-list images — uploaded/removed immediately (not on save). */}
            <FieldLabel style={{ marginTop: 22 }}>قائمة الأسعار (صور)</FieldLabel>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }}>
              {shopImages.map((im) => (
                <View key={im.id} style={{ width: 92, height: 124 }}>
                  <Img source={{ uri: fullImageUrl(im.image_path) }} style={{ width: 92, height: 124, borderRadius: 12, backgroundColor: theme.chipBg }} />
                  <TouchableOpacity onPress={() => removePriceImage(im.id)} style={{ position: 'absolute', top: -6, left: -6, width: 24, height: 24, borderRadius: 999, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {shopImages.length < 12 ? (
                <TouchableOpacity onPress={pickAndAddPriceImages} disabled={imgBusy} style={{ width: 92, height: 124, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface }}>
                  {imgBusy ? <ActivityIndicator color={theme.accent} /> : <Text style={{ color: theme.accent, fontSize: 26 }}>＋</Text>}
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={{ marginTop: 6, fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right' }}>
              تظهر هذه الصور في صفحة متجرك، ويمكن للزبائن فتحها بملء الشاشة.
            </Text>
          </>
        ) : (
          <Text style={{ marginTop: 18, fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', lineHeight: 19 }}>
            بعد تسجيل المتجر يمكنك إضافة شعار المتجر وصور قائمة الأسعار من هذه الصفحة.
          </Text>
        )}

        <View style={{ height: 22 }} />
        <Btn kind="accent" full busy={busy} onPress={submit}>{editing ? 'حفظ التغييرات' : 'تسجيل المتجر'}</Btn>

        {!editing ? (
          <>
            <View style={{ height: 12 }} />
            <Btn kind="successSoft" full onPress={contactUs}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                <IconMsgCall size={16} color={theme.success} />
                <Text style={{ color: theme.success, fontFamily: fonts.arBold, fontSize: 15 }}>أو سجّل عبر واتساب</Text>
              </View>
            </Btn>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
