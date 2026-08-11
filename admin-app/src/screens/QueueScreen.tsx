// The home screen is the work queue, not a dashboard.
//
// The web dashboard learned this already: outstanding work leads the page so
// the first thing on screen is what needs a decision, rather than a vanity
// chart. On a phone that goes further — charts have no business being the
// first thing an operator sees when they open a notification.
//
// There is deliberately no dismiss. A count stays up until the work is
// actually done; device suggestions went unnoticed for weeks precisely
// because nothing persisted.

import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../theme';
import { api } from '../api/client';
import { useAuth } from '../lib/auth';

export type Queue = {
  orders: number;
  inspection: number;
  inspection_errors: number;
  devices: number;
  reports: number;
  feature_requests: number;
  new_shops: number;
};

type Card = {
  key: keyof Queue;
  label: string;
  hint: string;
  tone: 'urgent' | 'warn' | 'info';
  route?: string;
};

// Ordered by how long the person on the other end has been waiting, not by
// how the web nav happens to group them.
const CARDS: Card[] = [
  { key: 'orders', label: 'طلبات بانتظار الاتصال', hint: 'زبون ينتظر مكالمة', tone: 'urgent', route: 'Orders' },
  { key: 'reports', label: 'بلاغات مفتوحة', hint: 'محتوى مُبلَّغ عنه', tone: 'urgent' },
  { key: 'inspection', label: 'إعلانات للفحص', hint: 'بانتظار قرار', tone: 'warn' },
  { key: 'new_shops', label: 'متاجر جديدة', hint: 'خلال 7 أيام', tone: 'info' },
  { key: 'devices', label: 'أجهزة مقترحة', hint: 'لإضافتها للكتالوج', tone: 'info' },
  { key: 'feature_requests', label: 'طلبات ترويج', hint: 'بانتظار موافقة', tone: 'info' },
];

export default function QueueScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { admin, logout } = useAuth();

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['work-queue'],
    queryFn: () => api<Queue>('/admin/work-queue'),
    // Short, because this is the screen someone leaves open while working.
    refetchInterval: 30000,
  });

  const total = data
    ? CARDS.reduce((n, c) => n + (data[c.key] || 0), 0)
    : 0;

  const onRefresh = useCallback(() => { refetch(); }, [refetch]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center',
        paddingHorizontal: 18, paddingVertical: 14, gap: 10,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 19, fontWeight: '700', color: theme.ink, textAlign: 'right' }}>
            ما يحتاج انتباهك
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
            {admin?.username}
          </Text>
        </View>
        <TouchableOpacity
          onPress={logout}
          accessibilityRole="button"
          accessibilityLabel="تسجيل الخروج"
          hitSlop={8}
          style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
            borderWidth: 1, borderColor: theme.line,
          }}
        >
          <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>خروج</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={theme.subtle} />
        }
      >
        {isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: 'center' }}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : isError ? (
          <ErrorBlock onRetry={onRefresh} />
        ) : total === 0 ? (
          <View style={{ paddingVertical: 52, alignItems: 'center', paddingHorizontal: 24 }}>
            <Text style={{ fontSize: 34, marginBottom: 10 }}>✓</Text>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'center' }}>
              لا شيء معلّق
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>
              كل الطلبات والبلاغات مُعالَجة. سنُنبّهك فور وصول شيء جديد.
            </Text>
          </View>
        ) : (
          CARDS.map((c) => {
            const n = data?.[c.key] || 0;
            if (!n) return null;
            return (
              <QueueCard
                key={c.key}
                card={c}
                count={n}
                onPress={c.route ? () => navigation.navigate(c.route!) : undefined}
              />
            );
          })
        )}

        {/* Errored inspections are a system problem, not a work item — they
            mean the inspector itself failed, so they sit apart from the
            counts an operator can actually action. */}
        {data?.inspection_errors ? (
          <Text style={{
            fontFamily: fonts.ar, fontSize: 12, color: theme.faint,
            textAlign: 'right', marginTop: 14,
          }}>
            {data.inspection_errors} عملية فحص فشلت تقنياً
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function QueueCard({ card, count, onPress }: { card: Card; count: number; onPress?: () => void }) {
  const tone = card.tone === 'urgent' ? theme.urgent : card.tone === 'warn' ? theme.warn : theme.info;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.85}
      accessibilityRole={onPress ? 'button' : undefined}
      style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: 14,
        backgroundColor: theme.surface, borderRadius: radius.xl,
        borderWidth: 1, borderColor: theme.line,
        padding: 16, marginBottom: 10,
        opacity: onPress ? 1 : 0.75,
      }}
    >
      <View style={{
        minWidth: 44, height: 44, paddingHorizontal: 10, borderRadius: radius.md,
        backgroundColor: tone, alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>{count}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '600', color: theme.ink, textAlign: 'right' }}>
          {card.label}
        </Text>
        <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
          {card.hint}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', paddingHorizontal: 24 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'center' }}>
        تعذّر تحميل قائمة العمل
      </Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', marginTop: 6 }}>
        تحقّق من الاتصال بالإنترنت.
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.85}
        style={{
          marginTop: 16, paddingHorizontal: 22, paddingVertical: 11,
          borderRadius: radius.pill, backgroundColor: theme.accent,
        }}
      >
        <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: '#fff' }}>إعادة المحاولة</Text>
      </TouchableOpacity>
    </View>
  );
}
