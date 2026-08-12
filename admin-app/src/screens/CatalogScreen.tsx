// Catalogue: name review, brands, devices.
//
// Name review is the one with a queue behind it — sellers type "ايفون 13 برو
// ماكس" into a free-text box and the matcher proposes the catalogue device it
// actually is. Approving is one tap; the alternative is that the listing is
// invisible to every buyer searching the proper name.

import React, { useState } from 'react';
import { View, Text, FlatList, RefreshControl, Modal, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd, deviceTitle } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, ChipRow, Card, Action, ActionRow, ListState, Meta, Title, SearchBar } from '../components/kit';

type NameRow = {
  id: number; brand: string; model: string; asking_price: number; status: string;
  suggestion: string | null; suggested_brand: string | null; confidence: string;
};
type Brand = { id: number; name: string; display_ar?: string | null; position?: number; count?: number };
type Device = { id: number; brand: string; model: string; device_type: string; is_active: number };

const TABS = [
  { key: 'names', label: 'مراجعة الأسماء' },
  { key: 'brands', label: 'الماركات' },
  { key: 'devices', label: 'الأجهزة' },
] as const;
type Tab = typeof TABS[number]['key'];

export default function CatalogScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(route?.params?.tab || 'names');

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="الكتالوج" onBack={() => navigation.goBack()} />
      <ChipRow options={TABS as any} value={tab} onChange={setTab as any} />
      {tab === 'names' ? <Names bottom={insets.bottom} />
        : tab === 'brands' ? <Brands bottom={insets.bottom} />
        : <Devices bottom={insets.bottom} />}
    </View>
  );
}

// ─── مراجعة الأسماء ──────────────────────────────────────────────────
function Names({ bottom }: { bottom: number }) {
  const qc = useQueryClient();
  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['name-review'],
    queryFn: () => api<{ total: number; listings: NameRow[]; skipped: number }>('/admin/listings/name-review'),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['name-review'] });
    qc.invalidateQueries({ queryKey: ['work-queue'] });
  };

  const apply = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      api(`/admin/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: done,
    onError: () => Alert.alert('تعذّر التعديل', 'لم يتم تغيير الاسم.'),
  });
  const skip = useMutation({
    mutationFn: (id: number) => api(`/admin/listings/${id}/name-review-skip`, { method: 'PATCH' }),
    onSuccess: done,
    onError: () => Alert.alert('تعذّر التخطي', 'حاول مجدداً.'),
  });

  const rows = data?.listings || [];

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => String(r.id)}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: bottom + 90 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
      ListHeaderComponent={data?.skipped ? (
        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.faint, textAlign: 'right', marginBottom: 8 }}>
          {data.skipped} إعلان تم تخطيه سابقاً
        </Text>
      ) : null}
      ListEmptyComponent={
        <ListState loading={isLoading} error={isError ? error : false}
          empty={!isLoading && !isError} emptyText="لا أسماء بحاجة لمراجعة." onRetry={refetch} />
      }
      renderItem={({ item: r }) => (
        <Card>
          {/* Current name first, proposal second — the operator is judging a
              change, and they cannot judge it without seeing what it replaces. */}
          <Meta>الاسم الحالي</Meta>
          <Title>{r.brand} {r.model}</Title>
          {r.suggestion ? (
            <>
              <View style={{ height: 1, backgroundColor: theme.line, marginVertical: 10 }} />
              <Meta>المقترح ({r.confidence})</Meta>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ok, textAlign: 'right' }}>
                {r.suggested_brand || r.brand} {r.suggestion}
              </Text>
            </>
          ) : (
            <Meta>لا يوجد مقترح مطابق في الكتالوج</Meta>
          )}
          <Meta>{iqd(r.asking_price)} د.ع · #{r.id}</Meta>

          <ActionRow>
            {r.suggestion ? (
              <Action
                label="تطبيق"
                tone="primary"
                busy={apply.isPending}
                onPress={() => apply.mutate({
                  id: r.id,
                  body: {
                    model: r.suggestion,
                    ...(r.suggested_brand ? { brand: r.suggested_brand } : {}),
                  },
                })}
              />
            ) : null}
            <Action label="تخطي" busy={skip.isPending} onPress={() => skip.mutate(r.id)} />
          </ActionRow>
        </Card>
      )}
    />
  );
}

// ─── الماركات ────────────────────────────────────────────────────────
function Brands({ bottom }: { bottom: number }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['admin-brands'],
    queryFn: () => api<Brand[]>('/admin/brands'),
  });
  const done = () => qc.invalidateQueries({ queryKey: ['admin-brands'] });

  const create = useMutation({
    mutationFn: (n: string) => api('/admin/brands', { method: 'POST', body: JSON.stringify({ name: n }) }),
    onSuccess: () => { setName(''); setAdding(false); done(); },
    onError: (e: any) => Alert.alert('تعذّر الإضافة',
      e?.code === 'duplicate' ? 'هذه الماركة موجودة.' : 'حاول مجدداً.'),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/admin/brands/${id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: () => Alert.alert('تعذّر الحذف', 'قد تكون الماركة مستخدمة في إعلانات.'),
  });

  const rows = Array.isArray(data) ? data : [];

  return (
    <>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <TouchableOpacity
          onPress={() => setAdding(true)}
          activeOpacity={0.85}
          style={{
            paddingVertical: 12, borderRadius: radius.lg, alignItems: 'center',
            borderWidth: 1.5, borderColor: theme.line,
          }}
        >
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.accent }}>+ إضافة ماركة</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError ? error : false}
            empty={!isLoading && !isError} emptyText="لا ماركات." onRetry={refetch} />
        }
        renderItem={({ item: b }) => (
          <Card>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right' }}>
                {b.name}
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                {b.count != null ? `${b.count} إعلان` : ''}
              </Text>
            </View>
            <ActionRow>
              <Action
                label="حذف"
                tone="danger"
                busy={del.isPending}
                confirm={{ title: 'حذف الماركة؟', body: `${b.name} — ستختفي من قوائم النشر والبحث.` }}
                onPress={() => del.mutate(b.id)}
              />
            </ActionRow>
          </Card>
        )}
      />

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 26 }}>
          <View style={{ backgroundColor: theme.surface, borderRadius: radius.xl, padding: 20 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'right' }}>
              ماركة جديدة
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              autoCapitalize="words"
              placeholder="Samsung"
              placeholderTextColor={theme.faint}
              style={{
                marginTop: 14, backgroundColor: theme.bg, borderRadius: radius.lg,
                borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14, paddingVertical: 13,
                fontSize: 15, color: theme.ink, textAlign: 'left',
              }}
            />
            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 16 }}>
              <TouchableOpacity
                disabled={name.trim().length < 2 || create.isPending}
                onPress={() => create.mutate(name.trim())}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: radius.lg, backgroundColor: theme.accent,
                  alignItems: 'center', opacity: name.trim().length >= 2 && !create.isPending ? 1 : 0.45,
                }}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: '#fff' }}>إضافة</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setAdding(false); setName(''); }} style={{
                flex: 1, paddingVertical: 13, borderRadius: radius.lg,
                borderWidth: 1.5, borderColor: theme.line, alignItems: 'center',
              }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.subtle }}>إلغاء</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── الأجهزة ─────────────────────────────────────────────────────────
function Devices({ bottom }: { bottom: number }) {
  const qc = useQueryClient();
  const [brand, setBrand] = useState<string>('');
  const [q, setQ] = useState('');

  const brands = useQuery({ queryKey: ['admin-brands'], queryFn: () => api<Brand[]>('/admin/brands') });

  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['admin-devices', brand, q],
    queryFn: () => api<{ total: number; devices: Device[] }>(
      `/admin/device-catalog?${new URLSearchParams({
        ...(brand ? { brand } : {}), ...(q.trim() ? { q: q.trim() } : {}), limit: '200',
      })}`,
    ),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/admin/device-catalog/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-devices'] }),
    onError: () => Alert.alert('تعذّر الحذف', 'حاول مجدداً.'),
  });

  const rows = data?.devices || [];
  const brandOpts = [{ key: '', label: 'الكل' },
    ...((brands.data || []).slice(0, 8).map((b) => ({ key: b.name, label: b.name })))];

  return (
    <>
      <SearchBar value={q} onChangeText={setQ} placeholder="ابحث عن جهاز…" />
      <ChipRow options={brandOpts as any} value={brand} onChange={setBrand} />
      <FlatList
        data={rows}
        keyExtractor={(d) => String(d.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError ? error : false}
            empty={!isLoading && !isError} emptyText="لا أجهزة مطابقة." onRetry={refetch} />
        }
        renderItem={({ item: d }) => (
          <Card>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ink, textAlign: 'right' }}>
                {deviceTitle(d.brand, d.model)}
              </Text>
              {!d.is_active ? (
                <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.faint }}>معطّل</Text>
              ) : null}
            </View>
            <Meta>
              {d.device_type === 'tablet' ? 'جهاز لوحي' : d.device_type === 'accessory' ? 'إكسسوار' : 'هاتف'} · #{d.id}
            </Meta>
            <ActionRow>
              <Action
                label="حذف"
                tone="danger"
                busy={del.isPending}
                confirm={{ title: 'حذف من الكتالوج؟', body: deviceTitle(d.brand, d.model) }}
                onPress={() => del.mutate(d.id)}
              />
            </ActionRow>
          </Card>
        )}
      />
    </>
  );
}
