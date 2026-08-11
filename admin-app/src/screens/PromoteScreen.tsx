// الترويج — sellers asking to have a listing featured.
//
// Eight of these were sitting pending when the queue screen first loaded
// against production, which is exactly the kind of thing that rots when it
// only lives on a desktop someone opens twice a week.

import React from 'react';
import { View, Text, FlatList, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, iqd, deviceTitle } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';

type Req = {
  id: number; listing_id: number; tier?: string | null;
  brand: string; model: string; asking_price: number; governorate: string;
  user_name: string | null; user_phone: string | null; created_at: number;
};

export default function PromoteScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['admin-feature-requests'],
    queryFn: () => api<Req[]>('/admin/feature-requests?status=pending'),
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
      api(`/admin/feature-requests/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-feature-requests'] });
      qc.invalidateQueries({ queryKey: ['work-queue'] });
    },
    onError: () => Alert.alert('تعذّر التحديث', 'لم يتم تنفيذ القرار.'),
  });

  const rows = Array.isArray(data) ? data : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title="طلبات الترويج"
        subtitle={rows.length ? `${rows.length} بانتظار` : undefined}
        onBack={() => navigation.goBack()}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: insets.bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError} empty={!isLoading && !isError}
            emptyText="لا طلبات ترويج معلّقة." onRetry={refetch} />
        }
        renderItem={({ item: r }) => (
          <Card>
            <Title>{deviceTitle(r.brand, r.model)}</Title>
            <Meta>{iqd(r.asking_price)} د.ع · {r.governorate} · إعلان #{r.listing_id}</Meta>
            <Meta>{r.user_name || '—'}{r.user_phone ? ` · ${r.user_phone}` : ''}{r.tier ? ` · ${r.tier}` : ''}</Meta>
            <ActionRow>
              {/* Approving puts the listing in paid placement on the home
                  feed, so it confirms first. */}
              <Action
                label="موافقة"
                tone="primary"
                busy={decide.isPending}
                confirm={{ title: 'ترويج الإعلان؟', body: deviceTitle(r.brand, r.model) }}
                onPress={() => decide.mutate({ id: r.id, action: 'approve' })}
              />
              <Action
                label="رفض"
                tone="danger"
                busy={decide.isPending}
                onPress={() => decide.mutate({ id: r.id, action: 'reject' })}
              />
            </ActionRow>
          </Card>
        )}
      />
    </View>
  );
}
