// Listings — moderate, reprice, remove.
//
// The three things that actually get done from a phone: fix a price someone
// fat-fingered, take a listing down, and mark one sold/reserved. Editing the
// full record (photos, description, specs) stays on the desktop, where there
// is room to see what you are changing.

import React, { useState } from 'react';
import { View, Text, Image, FlatList, RefreshControl, Modal, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd, deviceTitle } from '../theme';
import { api, API_BASE } from '../api/client';
import { ScreenHeader, SearchBar, ChipRow, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';
import { RecordEditor, type FieldSpec } from '../components/editor';
import { GOVERNORATES, CONDITIONS, LISTING_STATUSES, STORAGES } from '../lib/constants';

type Listing = {
  id: number; brand: string; model: string; asking_price: number;
  status: string; governorate: string; city: string | null;
  storage: string | null; color: string | null; condition?: string;
  description?: string | null;
  contact_phone?: string | null; contact_whatsapp?: string | null;
  cost_price?: number | null; stock_qty?: number | null;
  price_on_request?: number | null;
  seller_name?: string | null;
  cover_image?: string | null; image_count?: number;
  created_at: number;
};

// Upload paths come back relative ("/uploads/…"); the <Image> needs a URL.
const abs = (p: string) => (p.startsWith('http') ? p : `${API_BASE}${p}`);

// Every field PATCH /admin/listings/:id accepts. Kept in one list so the app
// cannot silently support a subset of what the web dashboard can edit.
const LISTING_FIELDS: FieldSpec[] = [
  { key: 'condition', label: 'الحالة', type: 'select', options: CONDITIONS },
  { key: 'storage', label: 'الذاكرة', type: 'select', options: STORAGES },
  { key: 'color', label: 'اللون', type: 'text' },
  { key: 'asking_price', label: 'السعر المطلوب (د.ع)', type: 'money' },
  {
    key: 'price_on_request', label: 'السعر عند الطلب', type: 'bool',
    hint: 'يخفي السعر ويطلب من الزبون الاتصال.',
  },
  {
    key: 'cost_price', label: 'كلفة الشراء (د.ع)', type: 'money',
    hint: 'لا تظهر للزبون أبداً — تُستخدم لحساب الهامش فقط.',
  },
  {
    key: 'stock_qty', label: 'الكمية', type: 'number',
    hint: 'اتركه فارغاً لغير محدود. صفر يعني نفد المخزون.',
  },
  { key: 'status', label: 'الحالة في السوق', type: 'select', options: LISTING_STATUSES },
  { key: 'governorate', label: 'المحافظة', type: 'select', options: GOVERNORATES },
  { key: 'city', label: 'القضاء / المنطقة', type: 'text' },
  { key: 'description', label: 'الوصف', type: 'multiline' },
  { key: 'contact_phone', label: 'هاتف التواصل', type: 'phone' },
  { key: 'contact_whatsapp', label: 'واتساب', type: 'phone' },
];

const STATUS_AR: Record<string, string> = {
  active: 'نشط', reserved: 'محجوز', sold: 'مباع', expired: 'منتهي', removed: 'محذوف',
};

const FILTERS = [
  { key: 'active', label: 'نشط' },
  { key: 'reserved', label: 'محجوز' },
  { key: 'sold', label: 'مباع' },
  { key: '', label: 'الكل' },
] as const;

export default function ListingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('active');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Listing | null>(null);

  // Real brands, so the editor offers a choice instead of a text box — a
  // free-text brand is exactly how "Apple POCO X7 Pro" reached the feed.
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api<{ name: string }[]>('/brands'),
    staleTime: 10 * 60 * 1000,
  });

  // brand: chips from the live brand list. model: free text PLUS a picker
  // over the device catalogue, filtered by whatever brand is currently
  // selected in the form (not the brand the record was opened with).
  const fields: FieldSpec[] = React.useMemo(() => [
    {
      key: 'brand', label: 'الماركة', type: 'select',
      options: (brands.data || []).map((b) => ({ value: b.name, label: b.name })),
    },
    {
      key: 'model', label: 'الموديل', type: 'text',
      picker: {
        title: 'اختر الجهاز من الكتالوج',
        load: async (query, vals) => {
          const brand = String(vals.brand || editing?.brand || '');
          if (!brand) return [];
          const rows = await api<{ id: number; model: string }[]>(
            `/device-catalog/devices?${new URLSearchParams({
              brand,
              type: (editing as any)?.product_type || 'phone',
              ...(query.trim() ? { q: query.trim() } : {}),
              limit: '60',
            })}`,
          );
          return rows.map((r) => ({ value: r.model }));
        },
      },
      hint: 'اكتب بحرّية أو اختر من الكتالوج — القائمة تتبع الماركة المحددة أعلاه.',
    },
    ...LISTING_FIELDS,
  ], [brands.data, editing]);

  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['admin-listings', status, q],
    // GET /admin/listings answers with a BARE ARRAY, not {listings}. Guessing
    // the wrapper cost a screen that rendered perfectly and always said "no
    // matching listings" — the worst kind of wrong, because nothing errors.
    queryFn: () => api<Listing[]>(
      `/admin/listings?${new URLSearchParams({
        ...(status ? { status } : {}),
        ...(q.trim() ? { q: q.trim() } : {}),
        limit: '50',
      })}`,
    ),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-listings'] });
    qc.invalidateQueries({ queryKey: ['work-queue'] });
  };

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      api(`/admin/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر الحفظ', 'لم يتم تطبيق التغيير.'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/admin/listings/${id}/remove`, { method: 'PATCH' }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر الحذف', 'لم يتم حذف الإعلان.'),
  });

  const rows = Array.isArray(data) ? data : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title="الإعلانات"
        subtitle={rows.length ? `${rows.length} إعلان` : undefined}
        onBack={() => navigation.goBack()}
      />
      <SearchBar value={q} onChangeText={setQ} placeholder="ابحث بالموديل أو الرقم…" />
      <ChipRow options={FILTERS as any} value={status} onChange={setStatus} />

      <FlatList
        data={rows}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState
            loading={isLoading}
            error={isError ? error : false}
            empty={!isLoading && !isError}
            emptyText="لا إعلانات مطابقة."
            onRetry={refetch}
          />
        }
        renderItem={({ item: l }) => (
          <Card>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <View style={{
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
                backgroundColor: l.status === 'active' ? theme.ok : theme.surfaceAlt,
              }}>
                <Text style={{ fontSize: 10.5, fontWeight: '700', color: l.status === 'active' ? '#fff' : theme.subtle }}>
                  {STATUS_AR[l.status] || l.status}
                </Text>
              </View>
              <Text style={{ flex: 1, textAlign: 'left', fontSize: 14.5, fontWeight: '700', color: theme.accent }}>
                {iqd(l.asking_price)} <Text style={{ fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
              </Text>
            </View>

            <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: 8, alignItems: 'center' }}>
              {l.cover_image ? (
                // Tap the photo to jump straight to this listing's images and
                // the social composer — no detour through the Social tab's
                // browse list.
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('Social', { listing: l })}
                >
                  <Image
                    source={{ uri: abs(l.cover_image) }}
                    style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: theme.surfaceAlt }}
                  />
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Title>{deviceTitle(l.brand, l.model)}</Title>
                <Meta>
                  {[l.storage, l.color, l.governorate, l.city].filter(Boolean).join(' · ')}
                </Meta>
                <Meta>
                  #{l.id}{l.contact_phone ? ` · ${l.contact_phone}` : ''}
                  {l.image_count ? ` · ${l.image_count} صور` : ' · بلا صور'}
                </Meta>
              </View>
            </View>

            <ActionRow>
              <Action label="تعديل" tone="primary" onPress={() => setEditing(l)} busy={patch.isPending} />
              {l.image_count ? (
                <Action label="نشر" onPress={() => navigation.navigate('Social', { listing: l })} />
              ) : null}
              {l.status !== 'sold' ? (
                <Action
                  label="مباع"
                  onPress={() => patch.mutate({ id: l.id, body: { status: 'sold' } })}
                  busy={patch.isPending}
                />
              ) : (
                <Action
                  label="تفعيل"
                  onPress={() => patch.mutate({ id: l.id, body: { status: 'active' } })}
                  busy={patch.isPending}
                />
              )}
              <Action
                label="حذف"
                tone="danger"
                busy={remove.isPending}
                confirm={{ title: 'حذف الإعلان؟', body: `${l.brand} ${l.model} — لا يمكن التراجع.` }}
                onPress={() => remove.mutate(l.id)}
              />
            </ActionRow>
          </Card>
        )}
      />

      <RecordEditor
        visible={!!editing}
        title="تعديل الإعلان"
        subtitle={editing ? `${deviceTitle(editing.brand, editing.model)} · #${editing.id}` : undefined}
        specs={fields}
        initial={(editing || {}) as any}
        busy={patch.isPending}
        onClose={() => setEditing(null)}
        onSave={(body) => {
          // Nothing changed — skip the round-trip rather than PATCHing an
          // empty object, which the server answers with `no_fields`.
          if (editing && Object.keys(body).length) patch.mutate({ id: editing.id, body });
          setEditing(null);
        }}
      />
    </View>
  );
}
