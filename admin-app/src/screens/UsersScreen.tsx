// Users — find someone, verify them, suspend them, ring them.
//
// The support call is always the same shape: a phone number arrives, you
// look it up, and you either vouch for the account or stop it. That's the
// whole screen.

import React, { useState } from 'react';
import { View, Text, FlatList, RefreshControl, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, radius } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, SearchBar, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';

type User = {
  id: number; phone: string | null; display_name: string;
  governorate: string; city: string | null;
  rating_avg: number | null; rating_count: number;
  verified: number | boolean; suspended?: number | boolean;
  created_at: number;
};

export default function UsersScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [q, setQ] = useState('');

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['admin-users', q],
    queryFn: () => api<User[]>(`/admin/users${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
  });

  const done = () => qc.invalidateQueries({ queryKey: ['admin-users'] });

  const verify = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      api(`/admin/users/${id}/verify`, { method: 'PATCH', body: JSON.stringify({ verified: on }) }),
    onSuccess: done,
    onError: () => Alert.alert('تعذّر التوثيق', 'لم يتم تغيير الحالة.'),
  });
  const suspend = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      api(`/admin/users/${id}/suspend`, { method: 'PATCH', body: JSON.stringify({ suspended: on }) }),
    onSuccess: done,
    onError: () => Alert.alert('تعذّر الإيقاف', 'لم يتم تغيير الحالة.'),
  });

  const rows = Array.isArray(data) ? data : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="المستخدمون" subtitle={rows.length ? `${rows.length}` : undefined} onBack={() => navigation.goBack()} />
      <SearchBar value={q} onChangeText={setQ} placeholder="ابحث بالاسم أو رقم الهاتف…" />

      <FlatList
        data={rows}
        keyExtractor={(u) => String(u.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError} empty={!isLoading && !isError}
            emptyText="لا مستخدمين مطابقين." onRetry={refetch} />
        }
        renderItem={({ item: u }) => (
          <Card>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 7 }}>
              {u.verified ? <Pill text="موثّق" tone={theme.ok} /> : null}
              {u.suspended ? <Pill text="موقوف" tone={theme.danger} /> : null}
              <Text style={{ flex: 1, textAlign: 'left', fontSize: 12, color: theme.subtle }}>
                {u.rating_count ? `${Number(u.rating_avg || 0).toFixed(1)} · ${u.rating_count}` : ''}
              </Text>
            </View>
            <View style={{ marginTop: 8 }}>
              <Title>{u.display_name}</Title>
              <Meta>{u.phone || '—'}</Meta>
              <Meta>{[u.governorate, u.city].filter(Boolean).join(' · ')} · #{u.id}</Meta>
            </View>
            <ActionRow>
              <Action label="اتصال" tone="ok" onPress={() => u.phone && Linking.openURL(`tel:${u.phone}`).catch(() => {})} />
              <Action
                label={u.verified ? 'إلغاء التوثيق' : 'توثيق'}
                tone={u.verified ? 'neutral' : 'primary'}
                busy={verify.isPending}
                onPress={() => verify.mutate({ id: u.id, on: !u.verified })}
              />
              <Action
                label={u.suspended ? 'رفع الإيقاف' : 'إيقاف'}
                tone={u.suspended ? 'neutral' : 'danger'}
                busy={suspend.isPending}
                confirm={u.suspended ? undefined : { title: 'إيقاف الحساب؟', body: `${u.display_name} — لن يتمكن من النشر.` }}
                onPress={() => suspend.mutate({ id: u.id, on: !u.suspended })}
              />
            </ActionRow>
          </Card>
        )}
      />
    </View>
  );
}

function Pill({ text, tone }: { text: string; tone: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: tone }}>
      <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#fff' }}>{text}</Text>
    </View>
  );
}
