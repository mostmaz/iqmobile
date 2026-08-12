// البانرات · الصفقات · التحايل · المستخدمون يومياً
//
// Four low-traffic dashboard pages that share a shape: look at a list, and at
// most flip one switch. Individually none of them justifies a tab of its own
// on a phone; together they are the rest of the dashboard.

import React, { useState } from 'react';
import { View, Text, FlatList, ScrollView, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd, deviceTitle } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, ChipRow, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';

const TABS = [
  { key: 'banners', label: 'البانرات' },
  { key: 'deals', label: 'الصفقات' },
  { key: 'bypass', label: 'التحايل' },
  { key: 'daily', label: 'المستخدمون' },
] as const;
type Tab = typeof TABS[number]['key'];

export default function GrowthScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(route?.params?.tab || 'banners');

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="النمو والمتابعة" onBack={() => navigation.goBack()} />
      <ChipRow options={TABS as any} value={tab} onChange={setTab as any} />
      {tab === 'banners' ? <Banners bottom={insets.bottom} />
        : tab === 'deals' ? <Deals bottom={insets.bottom} />
        : tab === 'bypass' ? <Bypass bottom={insets.bottom} />
        : <Daily bottom={insets.bottom} />}
    </View>
  );
}

// ─── البانرات ────────────────────────────────────────────────────────
type Banner = {
  id: number; placement: string; image: string; enabled: number; position: number;
  link_type: string | null; link_value: string | null;
  brand: string | null; governorate: string | null;
};
const PLACEMENT_AR: Record<string, string> = {
  home: 'الرئيسية', browse: 'التصفح', search: 'البحث', store: 'المتجر',
};

function Banners({ bottom }: { bottom: number }) {
  const qc = useQueryClient();
  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['admin-banners'],
    queryFn: () => api<Banner[]>('/admin/banners'),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: number }) =>
      api(`/admin/banners/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-banners'] }),
    onError: () => Alert.alert('تعذّر التحديث', 'لم تتغيّر حالة البانر.'),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/admin/banners/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-banners'] }),
    onError: () => Alert.alert('تعذّر الحذف', 'حاول مجدداً.'),
  });

  const rows = Array.isArray(data) ? data : [];
  return (
    <FlatList
      data={rows}
      keyExtractor={(b) => String(b.id)}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: bottom + 90 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
      ListHeaderComponent={
        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.faint, textAlign: 'right', marginBottom: 8, lineHeight: 18 }}>
          رفع بانر جديد يحتاج صورة — يتم من لوحة التحكم على الويب.
        </Text>
      }
      ListEmptyComponent={
        <ListState loading={isLoading} error={isError ? error : false}
          empty={!isLoading && !isError} emptyText="لا بانرات." onRetry={refetch} />
      }
      renderItem={({ item: b }) => (
        <Card>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            <View style={{
              paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill,
              backgroundColor: b.enabled ? theme.ok : theme.surfaceAlt,
            }}>
              <Text style={{ fontSize: 10.5, fontWeight: '700', color: b.enabled ? '#fff' : theme.subtle }}>
                {b.enabled ? 'مفعّل' : 'متوقف'}
              </Text>
            </View>
            <Text style={{ flex: 1, textAlign: 'left', fontSize: 12, color: theme.subtle }}>
              ترتيب {b.position}
            </Text>
          </View>
          <View style={{ marginTop: 8 }}>
            <Title>{PLACEMENT_AR[b.placement] || b.placement}</Title>
            <Meta>{b.link_type ? `${b.link_type}: ${b.link_value || '—'}` : 'بدون رابط'}</Meta>
            <Meta>{[b.brand, b.governorate].filter(Boolean).join(' · ') || 'لكل المستخدمين'}</Meta>
          </View>
          <ActionRow>
            <Action
              label={b.enabled ? 'إيقاف' : 'تفعيل'}
              tone={b.enabled ? 'neutral' : 'ok'}
              busy={toggle.isPending}
              onPress={() => toggle.mutate({ id: b.id, enabled: b.enabled ? 0 : 1 })}
            />
            <Action
              label="حذف"
              tone="danger"
              busy={del.isPending}
              confirm={{ title: 'حذف البانر؟', body: 'لا يمكن التراجع.' }}
              onPress={() => del.mutate(b.id)}
            />
          </ActionRow>
        </Card>
      )}
    />
  );
}

// ─── الصفقات ─────────────────────────────────────────────────────────
type Deal = {
  id: number; status: string; price: number | null;
  brand: string; model: string;
  buyer_name: string | null; seller_name: string | null; created_at: number;
};
const DEAL_AR: Record<string, string> = {
  proposed: 'مقترحة', buyer_accepted: 'قبلها المشتري',
  seller_confirmed: 'أكّدها البائع', cancelled: 'ملغاة', completed: 'مكتملة',
};

function Deals({ bottom }: { bottom: number }) {
  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['admin-deals'],
    queryFn: () => api<Deal[]>('/admin/deals'),
  });
  const rows = Array.isArray(data) ? data : [];
  return (
    <FlatList
      data={rows}
      keyExtractor={(d) => String(d.id)}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: bottom + 90 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
      ListEmptyComponent={
        <ListState loading={isLoading} error={isError ? error : false}
          empty={!isLoading && !isError} emptyText="لا صفقات." onRetry={refetch} />
      }
      renderItem={({ item: d }) => (
        <Card>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>
              {DEAL_AR[d.status] || d.status}
            </Text>
            {d.price ? (
              <Text style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: '700', color: theme.accent }}>
                {iqd(d.price)} <Text style={{ fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
              </Text>
            ) : null}
          </View>
          <View style={{ marginTop: 8 }}>
            <Title>{deviceTitle(d.brand, d.model)}</Title>
            <Meta>المشتري {d.buyer_name || '—'} · البائع {d.seller_name || '—'}</Meta>
          </View>
        </Card>
      )}
    />
  );
}

// ─── التحايل ─────────────────────────────────────────────────────────
type Bypass = {
  id: number; chat_id: number; user_id: number;
  raw_text: string; matched_pattern: string;
  user_name: string | null; user_phone: string | null; created_at: number;
};

function Bypass({ bottom }: { bottom: number }) {
  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['admin-bypass'],
    queryFn: () => api<Bypass[]>('/admin/bypass-attempts'),
  });
  const rows = Array.isArray(data) ? data : [];
  return (
    <FlatList
      data={rows}
      keyExtractor={(b) => String(b.id)}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: bottom + 90 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
      ListHeaderComponent={
        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.faint, textAlign: 'right', marginBottom: 8, lineHeight: 18 }}>
          محاولات تمرير أرقام هاتف داخل المحادثات.
        </Text>
      }
      ListEmptyComponent={
        <ListState loading={isLoading} error={isError ? error : false}
          empty={!isLoading && !isError} emptyText="لا محاولات مسجّلة." onRetry={refetch} />
      }
      renderItem={({ item: b }) => (
        <Card>
          <Title>{b.user_name || '—'}</Title>
          <Meta>{b.user_phone || '—'} · محادثة #{b.chat_id}</Meta>
          <Text numberOfLines={3} style={{
            fontFamily: fonts.ar, fontSize: 13, color: theme.ink,
            textAlign: 'right', marginTop: 8, lineHeight: 20,
          }}>
            {b.raw_text}
          </Text>
          <Meta>طابق: {b.matched_pattern}</Meta>
        </Card>
      )}
    />
  );
}

// ─── المستخدمون يومياً ───────────────────────────────────────────────
function Daily({ bottom }: { bottom: number }) {
  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['admin-daily'],
    queryFn: () => api<any>('/admin/analytics/daily?days=14'),
  });

  if (isLoading || isError) {
    return <ListState loading={isLoading} error={isError ? error : false} emptyText="" onRetry={refetch} />;
  }

  const d = data || {};
  const days: any[] = Array.isArray(d.day) ? d.day : (Array.isArray(d.days) ? d.days : []);

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 90 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
    >
      <Box label="النشاط">
        <Line label="نشط اليوم" value={String(d.engaged_today ?? 0)} />
        <Line label="نشط أسبوعياً" value={String(d.wau ?? 0)} />
        {/* The gap between "opened the app" and "did something" is the
            signal here, which is why the ratio is shown rather than hidden. */}
        <Line label="يومي / شهري" value={`${d.dau_mau_pct ?? 0}%`} />
      </Box>

      {d.platforms ? (
        <Box label="المنصّات">
          {Object.entries(d.platforms).map(([k, v]) => (
            <Line key={k} label={k} value={String(v)} />
          ))}
        </Box>
      ) : null}

      {d.app_versions ? (
        <Box label="إصدارات التطبيق">
          {Object.entries(d.app_versions).slice(0, 8).map(([k, v]) => (
            <Line key={k} label={k} value={String(v)} />
          ))}
        </Box>
      ) : null}

      {days.length ? (
        <Box label="آخر الأيام">
          {days.slice(-10).reverse().map((row: any, i: number) => (
            <Line
              key={i}
              label={String(row.day ?? row.date ?? '')}
              value={`${row.opened ?? row.dau ?? 0} فتح · ${row.engaged ?? 0} تفاعل`}
            />
          ))}
        </Box>
      ) : null}
    </ScrollView>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.faint, textAlign: 'right', marginBottom: 8 }}>
        {label}
      </Text>
      <View style={{
        backgroundColor: theme.surface, borderRadius: radius.xl,
        borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
      }}>{children}</View>
    </View>
  );
}
function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center',
      paddingHorizontal: 15, paddingVertical: 11,
      borderTopWidth: 1, borderTopColor: theme.line,
    }}>
      <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'right' }}>{label}</Text>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink }}>{value}</Text>
    </View>
  );
}
