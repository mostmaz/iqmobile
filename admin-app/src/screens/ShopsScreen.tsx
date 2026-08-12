// Shops — verify, hide, call.
//
// The notification this screen backs is "متجر جديد", so it opens on the
// newest registrations: the operator's actual job here is to look at a shop
// that just signed up, ring them, and either verify it or hide it.

import React, { useState } from 'react';
import { View, Text, FlatList, RefreshControl, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, radius } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, SearchBar, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';
import { RecordEditor, type FieldSpec } from '../components/editor';
import { GOVERNORATES } from '../lib/constants';

type Shop = {
  id: number; phone: string; display_name: string; shop_name: string | null;
  governorate: string; city: string | null;
  shop_phone: string | null; shop_whatsapp?: string | null;
  shop_bio?: string | null; shop_address?: string | null;
  shop_facebook?: string | null; shop_instagram?: string | null;
  shop_manager_phone?: string | null;
  shop_orders_enabled?: number; shop_no_contact?: number;
  shop_shipping_fee?: number;
  shop_delivery_days_min?: number; shop_delivery_days_max?: number;
  verified: number | boolean;
  shop_hidden: number; listing_count: number; created_at: number;
};

// Every field PATCH /admin/shops/:id accepts.
const SHOP_FIELDS: FieldSpec[] = [
  { key: 'shop_name', label: 'اسم المتجر', type: 'text' },
  { key: 'shop_bio', label: 'نبذة', type: 'multiline' },
  { key: 'governorate', label: 'المحافظة', type: 'select', options: GOVERNORATES },
  { key: 'shop_address', label: 'العنوان', type: 'text' },
  { key: 'shop_phone', label: 'هاتف المتجر', type: 'phone' },
  { key: 'shop_whatsapp', label: 'واتساب', type: 'phone' },
  {
    key: 'shop_manager_phone', label: 'هاتف المدير', type: 'phone',
    hint: 'يمنح صاحبه صلاحية إدارة محادثات هذا المتجر.',
  },
  { key: 'shop_facebook', label: 'فيسبوك', type: 'text' },
  { key: 'shop_instagram', label: 'إنستغرام', type: 'text' },
  {
    key: 'shop_orders_enabled', label: 'الطلبات مفعّلة', type: 'bool',
    hint: 'يحوّل المتجر إلى واجهة بيع مع سلة ودفع عند الاستلام.',
  },
  { key: 'shop_shipping_fee', label: 'أجور التوصيل (د.ع)', type: 'money' },
  { key: 'shop_delivery_days_min', label: 'أقل مدة توصيل (أيام)', type: 'number' },
  { key: 'shop_delivery_days_max', label: 'أطول مدة توصيل (أيام)', type: 'number' },
  {
    key: 'shop_hidden', label: 'مخفي من الدليل', type: 'bool',
    hint: 'لا يظهر في قائمة المتاجر، لكن إعلاناته تبقى في السوق.',
  },
  {
    key: 'shop_no_contact', label: 'إخفاء أرقام التواصل', type: 'bool',
    hint: 'يمنع ظهور أرقام هذا البائع على إعلاناته.',
  },
  {
    key: 'featured_days', label: 'أيام الترويج', type: 'number',
    hint: 'عدد الأيام من الآن. صفر يلغي الترويج.',
  },
];

export default function ShopsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Shop | null>(null);

  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['admin-shops', q],
    queryFn: () => api<Shop[]>(`/admin/shops${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-shops'] });
    qc.invalidateQueries({ queryKey: ['work-queue'] });
  };

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      api(`/admin/shops/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر الحفظ', 'لم يتم تطبيق التغيير.'),
  });

  const verify = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      api(`/admin/users/${id}/verify`, { method: 'PATCH', body: JSON.stringify({ verified: on }) }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر التوثيق', 'لم يتم تغيير حالة التوثيق.'),
  });

  // Newest first — this screen exists to answer a "متجر جديد" notification.
  const rows = [...(data || [])].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title="المتاجر"
        subtitle={rows.length ? `${rows.length} متجر` : undefined}
        onBack={() => navigation.goBack()}
      />
      <SearchBar value={q} onChangeText={setQ} placeholder="ابحث بالاسم أو الرقم…" />

      <FlatList
        data={rows}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError ? error : false} empty={!isLoading && !isError}
            emptyText="لا متاجر مطابقة." onRetry={refetch} />
        }
        renderItem={({ item: s }) => {
          const phone = s.shop_phone || s.phone;
          return (
            <Card>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 7 }}>
                {s.verified ? <Badge text="موثّق" tone={theme.ok} /> : null}
                {s.shop_hidden ? <Badge text="مخفي" tone={theme.warn} /> : null}
                <Text style={{ flex: 1, textAlign: 'left', fontSize: 12, color: theme.subtle }}>
                  {s.listing_count} إعلان
                </Text>
              </View>

              <View style={{ marginTop: 8 }}>
                <Title>{s.shop_name || s.display_name}</Title>
                <Meta>{[s.governorate, s.city].filter(Boolean).join(' · ')}</Meta>
                <Meta>{phone || '—'}</Meta>
              </View>

              <ActionRow>
                <Action
                  label="اتصال"
                  tone="ok"
                  onPress={() => phone && Linking.openURL(`tel:${phone}`).catch(() => {})}
                />
                <Action
                  label={s.verified ? 'إلغاء التوثيق' : 'توثيق'}
                  tone={s.verified ? 'neutral' : 'primary'}
                  busy={verify.isPending}
                  onPress={() => verify.mutate({ id: s.id, on: !s.verified })}
                />
                <Action label="تعديل" tone="primary" onPress={() => setEditing(s)} busy={patch.isPending} />
              </ActionRow>
            </Card>
          );
        }}
      />

      <RecordEditor
        visible={!!editing}
        title="تعديل المتجر"
        subtitle={editing ? (editing.shop_name || editing.display_name) : undefined}
        specs={SHOP_FIELDS}
        initial={(editing || {}) as any}
        busy={patch.isPending}
        onClose={() => setEditing(null)}
        onSave={(body) => {
          if (editing && Object.keys(body).length) patch.mutate({ id: editing.id, body });
          setEditing(null);
        }}
      />
    </View>
  );
}

function Badge({ text, tone }: { text: string; tone: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: tone }}>
      <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#fff' }}>{text}</Text>
    </View>
  );
}
