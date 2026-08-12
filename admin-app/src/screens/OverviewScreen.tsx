// التحليلات — the marketplace's numbers.
//
// Read-only on purpose. The web dashboard draws charts here; a phone screen
// that tries to reproduce them ends up with something too small to read and
// too fiddly to interact with. What survives the trip is the figures
// themselves, which is what gets quoted in a conversation anyway.

import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, iqd } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, ChipRow, ListState } from '../components/kit';

const RANGES = [
  { key: '7', label: '7 أيام' },
  { key: '30', label: '30 يوم' },
  { key: '90', label: '90 يوم' },
] as const;

export default function OverviewScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<string>('30');

  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<any>('/admin/overview'),
  });
  const analytics = useQuery({
    queryKey: ['admin-analytics', days],
    queryFn: () => api<any>(`/admin/analytics?days=${days}`),
  });

  const loading = overview.isLoading || analytics.isLoading;
  const failed = overview.isError || analytics.isError;

  const o = overview.data || {};
  const a = analytics.data || {};

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="التحليلات" onBack={() => navigation.goBack()} />
      <ChipRow options={RANGES as any} value={days} onChange={setDays} />

      {loading || failed ? (
        <ListState
          loading={loading}
          error={failed ? (overview.error || analytics.error) : false}
          emptyText=""
          onRetry={() => { overview.refetch(); analytics.refetch(); }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 90 }}
          refreshControl={
            <RefreshControl
              refreshing={overview.isRefetching || analytics.isRefetching}
              onRefresh={() => { overview.refetch(); analytics.refetch(); }}
              tintColor={theme.subtle}
            />
          }
        >
          <Group label="المستخدمون">
            <Stat label="الإجمالي" value={String(o.users?.total ?? 0)} />
            {/* Guests are auto-provisioned, so a total that lumps them in
                overstates the real user base — the split is the useful part. */}
            <Stat label="حسابات حقيقية" value={String(o.users?.real ?? 0)} tone={theme.ok} />
            <Stat label="ضيوف" value={String(o.users?.guest ?? 0)} />
            <Stat label="موقوفون" value={String(o.users?.suspended ?? 0)} tone={theme.danger} />
          </Group>

          <Group label="الإعلانات">
            <Stat label="نشطة" value={String(o.listings?.active ?? 0)} tone={theme.ok} />
            <Stat label="مباعة" value={String(o.listings?.sold ?? 0)} />
            <Stat label="منتهية" value={String(o.listings?.expired ?? 0)} />
            <Stat label="محذوفة" value={String(o.listings?.removed ?? 0)} />
          </Group>

          {/* The analytics payload varies by what is instrumented, so this
              renders whatever numeric top-level keys came back rather than
              hard-coding names that may not exist. */}
          {Object.entries(a).some(([, v]) => typeof v === 'number') ? (
            <Group label={`آخر ${days} يوم`}>
              {Object.entries(a)
                .filter(([, v]) => typeof v === 'number')
                .slice(0, 12)
                .map(([k, v]) => (
                  <Stat key={k} label={AR[k] || k} value={iqd(v as number)} />
                ))}
            </Group>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

/** Known analytics keys in Arabic; anything unmapped falls back to its key. */
const AR: Record<string, string> = {
  searches: 'عمليات بحث',
  views: 'مشاهدات',
  calls: 'اتصالات',
  whatsapp: 'واتساب',
  chats: 'محادثات',
  new_listings: 'إعلانات جديدة',
  new_users: 'مستخدمون جدد',
  orders: 'طلبات',
  saves: 'حفظ',
  shares: 'مشاركة',
};

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.faint, textAlign: 'right', marginBottom: 8 }}>
        {label}
      </Text>
      <View style={{
        backgroundColor: theme.surface, borderRadius: radius.xl,
        borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
      }}>
        {children}
      </View>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center',
      paddingHorizontal: 15, paddingVertical: 12,
      borderTopWidth: 1, borderTopColor: theme.line,
    }}>
      <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'right' }}>
        {label}
      </Text>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: tone || theme.ink }}>
        {value}
      </Text>
    </View>
  );
}
