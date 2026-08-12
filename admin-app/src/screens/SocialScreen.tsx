// Social publishing — the dashboard's Buffer flow, from a phone.
//
// The dashboard composes its branded share image on an HTML canvas; the app
// asks the server to do the same composition (POST social-preview) and then
// publishes exactly what it previewed (POST publish-hosted). Same daily cap,
// same Baghdad time slots, same audit trail — one pipeline, two clients.
//
// Flow: search a listing → pick one of its photos → the server returns the
// branded image + a generated Arabic caption → edit if wanted → publish.

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Image,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, iqd } from '../theme';
import { api, API_BASE } from '../api/client';
import { ScreenHeader, SearchBar } from '../components/kit';

type Listing = {
  id: number; brand: string; model: string; asking_price: number;
  status: string; governorate: string; cover_image: string | null; image_count: number;
};
type Preview = {
  image_path: string; image_url: string; caption: string;
  status: { configured: boolean; cap: number; used_today: number; remaining: number };
};
type SocialStatus = {
  configured: boolean; channels: { facebook: boolean; instagram: boolean };
  cap: number; used_today: number; remaining: number;
};

const abs = (p: string) => (p.startsWith('http') ? p : `${API_BASE}${p}`);

export default function SocialScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Listing | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [caption, setCaption] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['social-status'],
    queryFn: () => api<SocialStatus>('/admin/social/status'),
  });

  const search = useQuery({
    queryKey: ['social-listings', q],
    queryFn: () => api<Listing[]>(`/admin/listings?${new URLSearchParams({ q, status: 'active' })}`),
    enabled: q.trim().length >= 2,
  });

  // The listing's photos, for the picker. NOTE the shape: {images, max},
  // not a bare array — assuming an array here once blanked a whole
  // dashboard page.
  const photos = useQuery({
    queryKey: ['social-photos', picked?.id],
    queryFn: () => api<{ images: { id: number; image_path: string }[] }>(`/listings/${picked!.id}/images`),
    enabled: !!picked,
  });

  const compose = useMutation({
    mutationFn: (image_path: string) =>
      api<Preview>(`/admin/listings/${picked!.id}/social-preview`, {
        method: 'POST', body: JSON.stringify({ image_path }),
      }),
    onSuccess: (p) => { setPreview(p); setCaption(p.caption); },
    onError: (e: any) => Alert.alert('خطأ', e?.code === 'compose_failed'
      ? 'تعذّر تجهيز الصورة.' : String(e?.message || e)),
  });

  const publish = useMutation({
    mutationFn: () =>
      api<{ scheduled_for: string; remaining: number }>(`/admin/listings/${picked!.id}/publish-hosted`, {
        method: 'POST',
        body: JSON.stringify({ image_path: preview!.image_path, caption: caption.trim() }),
      }),
    onSuccess: (r) => {
      const when = new Date(r.scheduled_for).toLocaleString('ar-IQ', {
        timeZone: 'Asia/Baghdad', weekday: 'long', hour: 'numeric', minute: '2-digit',
      });
      setDone(`سيُنشر ${when} · بقي ${r.remaining} منشور اليوم`);
      void status.refetch();
    },
    onError: (e: any) => {
      const msg = e?.code === 'daily_cap_reached' ? 'بلغت الحد اليومي للنشر.'
        : e?.code === 'buffer_not_configured' ? 'ربط Buffer غير مفعّل — يُدار من إعدادات الخادم.'
        : e?.code === 'preview_expired' ? 'انتهت صلاحية المعاينة، جهّزها من جديد.'
        : e?.code === 'publish_failed' ? 'فشل النشر عبر Buffer — تحقّق من ربط الحسابات.'
        : String(e?.message || e);
      Alert.alert('لم يُنشر', msg);
    },
  });

  const st = status.data;
  const capLine = st
    ? `${st.remaining} من ${st.cap} منشورات متبقية اليوم · فيسبوك ${st.channels.facebook ? '✓' : '✗'} · انستغرام ${st.channels.instagram ? '✓' : '✗'}`
    : undefined;

  function reset() { setPreview(null); setDone(null); setCaption(''); }

  // ── preview / publish stage ──────────────────────────────────────────
  if (picked && preview) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          title="معاينة المنشور"
          subtitle={`${picked.brand} ${picked.model}`}
          onBack={() => reset()}
        />
        <Image
          source={{ uri: abs(preview.image_path) }}
          style={{ width: '100%', aspectRatio: 1, backgroundColor: theme.surface }}
          resizeMode="contain"
        />
        {done ? (
          <View style={{
            margin: 14, padding: 14, borderRadius: radius.lg,
            backgroundColor: 'rgba(95,190,146,0.12)', borderWidth: 1, borderColor: '#5FBE92',
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: '#5FBE92', textAlign: 'right' }}>
              تم الجدولة ✓
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.ink, textAlign: 'right', marginTop: 4 }}>
              {done}
            </Text>
            <TouchableOpacity
              onPress={() => { reset(); setPicked(null); }}
              style={{ marginTop: 10, alignSelf: 'flex-start' }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accent }}>
                نشر إعلان آخر
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ padding: 14 }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginBottom: 6 }}>
              النص — عدّله كما تريد قبل النشر
            </Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              multiline
              style={{
                backgroundColor: theme.surface, borderRadius: radius.lg,
                borderWidth: 1, borderColor: theme.line,
                padding: 12, minHeight: 180, textAlignVertical: 'top',
                fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right',
              }}
            />
            {capLine ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 8 }}>
                {capLine}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={() => publish.mutate()}
              disabled={publish.isPending || !caption.trim() || (st ? (!st.configured || st.remaining <= 0) : false)}
              style={{
                marginTop: 12, paddingVertical: 14, borderRadius: radius.lg,
                backgroundColor: theme.accent, alignItems: 'center',
                opacity: publish.isPending || (st && (!st.configured || st.remaining <= 0)) ? 0.5 : 1,
              }}
            >
              {publish.isPending ? <ActivityIndicator color="#fff" /> : (
                <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: '#fff' }}>
                  نشر على فيسبوك وانستغرام
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    );
  }

  // ── photo picker stage ───────────────────────────────────────────────
  if (picked) {
    const imgs = photos.data?.images || [];
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScreenHeader
          title="اختر الصورة"
          subtitle={`${picked.brand} ${picked.model} · ${iqd(picked.asking_price)} د.ع`}
          onBack={() => setPicked(null)}
        />
        {photos.isLoading || compose.isPending ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator color={theme.accent} />
            {compose.isPending ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
                جارِ تجهيز الصورة…
              </Text>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={imgs}
            numColumns={3}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ padding: 10 }}
            ListEmptyComponent={(
              <Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar, fontSize: 13 }}>
                لا صور لهذا الإعلان.
              </Text>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => compose.mutate(item.image_path)}
                style={{ flex: 1 / 3, aspectRatio: 1, padding: 3 }}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: abs(item.image_path) }}
                  style={{ flex: 1, borderRadius: radius.md, backgroundColor: theme.surface }}
                />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // ── search stage ─────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="النشر على السوشيال" subtitle={capLine} onBack={() => navigation.goBack()} />
      <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        <SearchBar value={q} onChangeText={setQ} placeholder="ابحث عن إعلان — ماركة، موديل، رقم…" />
      </View>
      <FlatList
        data={search.data || []}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 20 }}
        ListEmptyComponent={search.isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : (
          <Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar, fontSize: 13 }}>
            {q.trim().length >= 2 ? 'لا نتائج.' : 'اكتب حرفين على الأقل للبحث عن إعلان.'}
          </Text>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => setPicked(item)}
            activeOpacity={0.8}
            style={{
              flexDirection: 'row-reverse', gap: 10, alignItems: 'center',
              padding: 10, marginBottom: 8, borderRadius: radius.lg,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            }}
          >
            {item.cover_image ? (
              <Image source={{ uri: abs(item.cover_image) }} style={{ width: 54, height: 54, borderRadius: radius.md }} />
            ) : (
              <View style={{ width: 54, height: 54, borderRadius: radius.md, backgroundColor: theme.surfaceAlt }} />
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}>
                {item.brand} {item.model}
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                {iqd(item.asking_price)} د.ع · {item.image_count} صور
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
