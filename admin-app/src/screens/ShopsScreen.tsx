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

type Shop = {
  id: number; phone: string; display_name: string; shop_name: string | null;
  governorate: string; city: string | null;
  shop_phone: string | null; verified: number | boolean;
  shop_hidden: number; listing_count: number; created_at: number;
};

export default function ShopsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [q, setQ] = useState('');

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
                <Action
                  label={s.shop_hidden ? 'إظهار' : 'إخفاء'}
                  tone={s.shop_hidden ? 'neutral' : 'danger'}
                  busy={patch.isPending}
                  confirm={s.shop_hidden ? undefined : {
                    title: 'إخفاء المتجر؟',
                    body: 'لن يظهر في دليل المتاجر.',
                  }}
                  onPress={() => patch.mutate({ id: s.id, body: { shop_hidden: !s.shop_hidden } })}
                />
              </ActionRow>
            </Card>
          );
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
