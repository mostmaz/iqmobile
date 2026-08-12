// Reports and device suggestions.
//
// Two queues, one screen. They are different data but the same job — read a
// short thing, then approve or dismiss it — and on a phone that is one
// screen with a switch, not two entries buried in a menu.

import React, { useState } from 'react';
import { View, Text, FlatList, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, deviceTitle } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, ChipRow, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';

type Report = {
  id: number; listing_id: number | null; reason: string; note: string | null;
  reporter_name: string | null; reporter_phone: string | null; created_at: number;
};
type Suggestion = {
  id: number; brand: string; model: string; device_type: string;
  user_name: string | null; user_phone: string | null; created_at: number;
};

const TABS = [
  { key: 'reports', label: 'البلاغات' },
  { key: 'devices', label: 'أجهزة مقترحة' },
] as const;

export default function ModerationScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'reports' | 'devices'>(route?.params?.tab || 'reports');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-reports'] });
    qc.invalidateQueries({ queryKey: ['admin-suggestions'] });
    qc.invalidateQueries({ queryKey: ['work-queue'] });
  };

  const reports = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => api<Report[]>('/admin/reports?status=open'),
    enabled: tab === 'reports',
  });
  const suggestions = useQuery({
    queryKey: ['admin-suggestions'],
    queryFn: () => api<Suggestion[]>('/admin/device-suggestions?status=pending'),
    enabled: tab === 'devices',
  });

  const resolveReport = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر التحديث', 'لم يتم تحديث البلاغ.'),
  });

  const decideDevice = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
      api(`/admin/device-suggestions/${id}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر التحديث', 'لم يتم تنفيذ القرار.'),
  });

  const active = tab === 'reports' ? reports : suggestions;
  const rows: any[] = (active.data as any[]) || [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="الإشراف" onBack={() => navigation.goBack()} />
      <ChipRow options={TABS as any} value={tab} onChange={setTab as any} />

      <FlatList
        data={rows}
        keyExtractor={(r) => `${tab}-${r.id}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={
          <RefreshControl refreshing={active.isRefetching} onRefresh={active.refetch} tintColor={theme.subtle} />
        }
        ListEmptyComponent={
          <ListState
            loading={active.isLoading}
            error={active.isError ? active.error : false}
            empty={!active.isLoading && !active.isError}
            emptyText={tab === 'reports' ? 'لا بلاغات مفتوحة.' : 'لا أجهزة مقترحة.'}
            onRetry={active.refetch}
          />
        }
        renderItem={({ item }) =>
          tab === 'reports' ? (
            <Card>
              <Title>{item.reason || 'بلاغ'}</Title>
              {item.note ? <Meta>{item.note}</Meta> : null}
              <Meta>
                {item.listing_id ? `إعلان #${item.listing_id} · ` : ''}
                من {item.reporter_name || '—'}{item.reporter_phone ? ` · ${item.reporter_phone}` : ''}
              </Meta>
              <ActionRow>
                <Action
                  label="تمت المراجعة"
                  tone="primary"
                  busy={resolveReport.isPending}
                  onPress={() => resolveReport.mutate({ id: item.id, status: 'reviewed' })}
                />
                <Action
                  label="تجاهل"
                  busy={resolveReport.isPending}
                  onPress={() => resolveReport.mutate({ id: item.id, status: 'dismissed' })}
                />
              </ActionRow>
            </Card>
          ) : (
            <Card>
              <Title>{deviceTitle(item.brand, item.model)}</Title>
              <Meta>{item.device_type === 'tablet' ? 'جهاز لوحي' : item.device_type === 'accessory' ? 'إكسسوار' : 'هاتف'}</Meta>
              <Meta>اقترحه {item.user_name || '—'}{item.user_phone ? ` · ${item.user_phone}` : ''}</Meta>
              <ActionRow>
                {/* Approving writes a row into the live catalogue that every
                    seller then picks from, so it asks first. */}
                <Action
                  label="إضافة للكتالوج"
                  tone="primary"
                  busy={decideDevice.isPending}
                  confirm={{ title: 'إضافة للكتالوج؟', body: `${item.brand} ${item.model}` }}
                  onPress={() => decideDevice.mutate({ id: item.id, action: 'approve' })}
                />
                <Action
                  label="رفض"
                  tone="danger"
                  busy={decideDevice.isPending}
                  onPress={() => decideDevice.mutate({ id: item.id, action: 'reject' })}
                />
              </ActionRow>
            </Card>
          )
        }
      />
    </View>
  );
}
