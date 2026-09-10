import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { launchLibrary, ensureLibraryPermission } from '../../lib/imagePicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Btn, FieldLabel, Header, Input } from '../../components/ui';
import { Img } from '../../components/Img';
import { Listings, type ListingImage } from '../../api/endpoints';
import { uploadListingImage, uploadListingVideo, fullImageUrl } from '../../api/upload';
import { compressForListing } from '../../lib/imageCompress';
import { compressVideo } from '../../lib/videoCompress';
import { ar } from '../../i18n/ar';
import { parsePrice } from '../../lib/format';

const MAX_IMAGES = 10;

export default function EditListingScreen({ route, navigation }: any) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [askingPrice, setAskingPrice] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  // ── media ────────────────────────────────────────────────────────────
  // This screen had no image or video handling at all, which made the
  // wizard's «يمكنك المحاولة لاحقاً» after a failed video upload a promise
  // with nowhere to keep it. Now that a publish can also succeed with photos
  // missing, "later" has to mean something.
  const [images, setImages] = useState<ListingImage[]>([]);
  const [hasVideo, setHasVideo] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);

  // Fetch the listing on mount with proper error handling. Without this,
  // a 404 (deleted listing) or network failure left the form blank forever
  // with no way for the user to recover other than backing out.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Listings.get(id)
      .then((l) => {
        if (!alive) return;
        setAskingPrice(String(l.asking_price));
        setDescription(l.description || '');
        setImages(l.images || []);
        setHasVideo(!!l.video || !!l.has_video);
        setLoadErr('');
      })
      .catch((e: any) => {
        if (!alive) return;
        setLoadErr((ar.errors as any)[e?.message] || (ar.errors as any).network);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const refreshMedia = useCallback(async () => {
    try {
      const l = await Listings.get(id);
      setImages(l.images || []);
      setHasVideo(!!l.video || !!(l as any).has_video);
    } catch {}
    qc.invalidateQueries({ queryKey: ['listing', id] });
    qc.invalidateQueries({ queryKey: ['mine'] });
  }, [id, qc]);

  // Photos upload one per request and report individually — the same shape
  // the wizard uses, so a single bad photo or a dropped packet costs one
  // photo rather than the batch.
  const addPhotos = useCallback(async () => {
    if (mediaBusy) return;
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) { Alert.alert('الحد الأقصى', `الحد الأقصى ${MAX_IMAGES} صور.`); return; }
    const granted = await ensureLibraryPermission();
    if (!granted) { Alert.alert('الصور', 'فعّل إذن الصور من إعدادات الجهاز.'); return; }
    const r = await launchLibrary({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, quality: 1, selectionLimit: remaining,
    });
    if (!r || r.canceled || !r.assets?.length) return;
    setMediaBusy(true);
    let failed = 0;
    try {
      for (const asset of r.assets) {
        try {
          const uri = await compressForListing(asset.uri);
          await uploadListingImage(id, uri);
        } catch { failed++; }
      }
      await refreshMedia();
      if (failed > 0) {
        Alert.alert('بعض الصور لم تُرفع', `${failed} من الصور لم تُرفع. تقدر تعيد المحاولة.`);
      }
    } finally { setMediaBusy(false); }
  }, [id, images.length, mediaBusy, refreshMedia]);

  const deletePhoto = useCallback((imageId: number) => {
    Alert.alert('حذف الصورة', 'سيتم حذفها من الإعلان.', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: async () => {
        setMediaBusy(true);
        try { await Listings.removeImage(id, imageId); await refreshMedia(); }
        catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network); }
        finally { setMediaBusy(false); }
      } },
    ]);
  }, [id, refreshMedia]);

  const addVideo = useCallback(async () => {
    if (mediaBusy) return;
    const granted = await ensureLibraryPermission('video');
    if (!granted) { Alert.alert('الفيديو', 'فعّل إذن الوصول للوسائط من إعدادات الجهاز.'); return; }
    const r = await launchLibrary({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false, videoMaxDuration: 60,
    }, 'video');
    if (!r || r.canceled || !r.assets?.length) return;
    setMediaBusy(true);
    try {
      const out = await compressVideo(r.assets[0].uri);
      await uploadListingVideo(id, out.uri);
      await refreshMedia();
      Alert.alert('تم رفع الفيديو', 'يظهر على إعلانك بعد موافقة الإدارة.');
    } catch (e: any) {
      Alert.alert('لم يُرفع الفيديو', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setMediaBusy(false); }
  }, [id, mediaBusy, refreshMedia]);

  async function save() {
    // Client-side price validation: empty / non-positive / non-numeric
    // input was silently shipped as `Number('')` = 0 to the server. We
    // now reject before the request goes out so the user sees a clear
    // Arabic error instead of a confusing 400 from the API.
    const price = parsePrice(askingPrice);
    if (price == null) {
      Alert.alert('خطأ', (ar.errors as any).bad_price);
      return;
    }
    setBusy(true);
    try {
      await Listings.patch(id, {
        asking_price: price,
        description: description || null,
      });
      qc.invalidateQueries({ queryKey: ['listing', id] });
      qc.invalidateQueries({ queryKey: ['mine'] });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Header title={ar.listing.edit} onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </View>
    );
  }

  if (loadErr) {
    // Surface the load failure with an explicit retry button. Previously
    // a load error left the form blank and the user could submit a zero-
    // price update against a possibly-deleted listing.
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Header title={ar.listing.edit} onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.danger, textAlign: 'center' }}>
            {loadErr}
          </Text>
          <Btn kind="ghost" onPress={() => navigation.goBack()}>رجوع</Btn>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={ar.listing.edit} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <FieldLabel>{ar.listing.asking} (د.ع)</FieldLabel>
        <Input value={askingPrice} onChangeText={setAskingPrice} numeric ltr />
        {Number(askingPrice) >= 1 && Number(askingPrice) < 1000 ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setAskingPrice(String(Number(askingPrice) * 1000))}
            style={{
              marginTop: 8, alignSelf: 'flex-end',
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
              backgroundColor: theme.accentSoft,
              borderWidth: 1, borderColor: theme.accent,
              borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
            }}
          >
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.accentDeep }}>
              هل تقصد {(Number(askingPrice) * 1000).toLocaleString('en-US')} د.ع؟
            </Text>
            <View style={{ backgroundColor: theme.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: '#fff' }}>نعم</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        <FieldLabel style={{ marginTop: 14 }}>{ar.listing.description}</FieldLabel>
        <Input value={description} onChangeText={setDescription} multiline />

        {/* ── media ──────────────────────────────────────────────────────
            Where a photo that failed at publish time actually gets fixed.
            Uploads are per-photo, so retrying one doesn't disturb the rest. */}
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 8 }}>
          <FieldLabel style={{ marginTop: 0 }}>الصور</FieldLabel>
          <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: images.length >= 3 ? theme.success : theme.subtle }}>
            {images.length} / {MAX_IMAGES}
          </Text>
        </View>
        <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
          {images.map((img) => (
            <View key={img.id} style={{ position: 'relative' }}>
              <Img
                source={{ uri: fullImageUrl(img.image_path) }}
                style={{ width: 96, height: 96, borderRadius: radius.md, backgroundColor: theme.surface }}
              />
              <TouchableOpacity
                onPress={() => deletePhoto(img.id)}
                disabled={mediaBusy}
                style={{ position: 'absolute', top: -6, left: -6, width: 22, height: 22, borderRadius: 999, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#fff' }}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          {images.length < MAX_IMAGES ? (
            <TouchableOpacity
              onPress={addPhotos}
              disabled={mediaBusy}
              style={{ width: 96, height: 96, borderRadius: radius.md, borderWidth: 2, borderColor: theme.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', opacity: mediaBusy ? 0.5 : 1 }}
            >
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'center' }}>
                {mediaBusy ? '…' : `+ ${ar.post.addImages}`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <FieldLabel style={{ marginTop: 18 }}>فيديو للجهاز (اختياري)</FieldLabel>
        {hasVideo ? (
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, padding: 12 }}>
            <Text style={{ fontSize: 22 }}>🎬</Text>
            <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
              الفيديو مرفوع
            </Text>
            <TouchableOpacity
              disabled={mediaBusy}
              onPress={() => Alert.alert('حذف الفيديو', 'سيُحذف من الإعلان.', [
                { text: 'إلغاء', style: 'cancel' },
                { text: 'حذف', style: 'destructive', onPress: async () => {
                  setMediaBusy(true);
                  try { await Listings.removeVideo(id); setHasVideo(false); await refreshMedia(); }
                  catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network); }
                  finally { setMediaBusy(false); }
                } },
              ])}
              hitSlop={8}
              style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: '#fff' }}>×</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={addVideo}
            disabled={mediaBusy}
            style={{ borderRadius: radius.lg, borderWidth: 2, borderColor: theme.line, borderStyle: 'dashed', paddingVertical: 16, alignItems: 'center', opacity: mediaBusy ? 0.6 : 1 }}
          >
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
              {mediaBusy ? 'جارٍ الرفع…' : '+ أضف فيديو (حتى ٦٠ ثانية)'}
            </Text>
          </TouchableOpacity>
        )}
        <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: '#B07A28', textAlign: 'right', marginTop: 6, lineHeight: 17 }}>
          ملاحظة: الفيديو لا يُنشر مباشرة — يظهر على إعلانك بعد موافقة الإدارة.
        </Text>
        <View style={{ marginTop: 20 }}>
          <Btn kind="primary" full onPress={save} busy={busy}>حفظ</Btn>
        </View>
      </ScrollView>
    </View>
  );
}
