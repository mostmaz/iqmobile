// Everything the dashboard has, and an honest label on what isn't here yet.
//
// A hub that silently omits half the dashboard is worse than one that lists
// it — the operator goes looking, doesn't find it, and stops trusting that
// the app has anything. So every section the web has is listed; the ones
// without a screen yet say so instead of pretending to be missing.

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../theme';
import { ScreenHeader } from '../components/kit';
import { useAuth } from '../lib/auth';

const DASHBOARD_URL = 'https://iqmobile.org/dashboard/';

type Item = { label: string; route?: string; params?: any; note?: string };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: 'العمل اليومي',
    items: [
      { label: 'الطلبات', route: 'Orders' },
      { label: 'الإعلانات', route: 'Listings' },
      { label: 'المتاجر', route: 'Shops' },
      { label: 'البلاغات', route: 'Moderation', params: { tab: 'reports' } },
      { label: 'الأجهزة المقترحة', route: 'Moderation', params: { tab: 'devices' } },
    ],
  },
  {
    label: 'المتجر',
    items: [
      { label: 'المخزون', note: 'على الويب' },
      { label: 'التجهيز', note: 'على الويب' },
      { label: 'الزبائن', note: 'على الويب' },
      { label: 'أداء المتجر', note: 'على الويب' },
      { label: 'بطاقة الرئيسية', note: 'على الويب' },
    ],
  },
  {
    label: 'الكتالوج',
    items: [
      { label: 'مراجعة الأسماء', note: 'على الويب' },
      { label: 'الماركات', note: 'على الويب' },
      { label: 'الأجهزة', note: 'على الويب' },
      { label: 'الاستيراد', note: 'ملفات — على الويب' },
    ],
  },
  {
    label: 'النمو والإعداد',
    items: [
      { label: 'المستخدمون', note: 'على الويب' },
      { label: 'البانرات', note: 'على الويب' },
      { label: 'الترويج', note: 'على الويب' },
      { label: 'التحليلات', note: 'رسوم — على الويب' },
      { label: 'الإعدادات', note: 'على الويب' },
    ],
  },
];

export default function MoreScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { admin, logout } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="كل الأقسام" subtitle={admin?.username} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90 }}>
        {GROUPS.map((g) => (
          <View key={g.label} style={{ marginBottom: 18 }}>
            <Text style={{
              fontFamily: fonts.arBold, fontSize: 12.5, color: theme.faint,
              textAlign: 'right', marginBottom: 8,
            }}>
              {g.label}
            </Text>
            <View style={{
              backgroundColor: theme.surface, borderRadius: radius.xl,
              borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
            }}>
              {g.items.map((it, i) => {
                const enabled = !!it.route;
                return (
                  <TouchableOpacity
                    key={it.label}
                    disabled={!enabled}
                    onPress={() => navigation.navigate(it.route!, it.params)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    style={{
                      flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
                      paddingHorizontal: 15, paddingVertical: 15,
                      borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.line,
                      opacity: enabled ? 1 : 0.55,
                    }}
                  >
                    <Text style={{
                      flex: 1, fontFamily: fonts.ar, fontSize: 14.5,
                      color: theme.ink, textAlign: 'right',
                    }}>
                      {it.label}
                    </Text>
                    {it.note ? (
                      <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.faint }}>
                        {it.note}
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 18, color: theme.faint }}>‹</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        {/* The sections above marked "على الويب" are reachable, just not
            native yet — a link beats a dead end. */}
        <TouchableOpacity
          onPress={() => Linking.openURL(DASHBOARD_URL).catch(() => {})}
          activeOpacity={0.85}
          style={{
            paddingVertical: 14, borderRadius: radius.lg, alignItems: 'center',
            borderWidth: 1.5, borderColor: theme.line, marginBottom: 10,
          }}
        >
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.subtle }}>
            فتح لوحة التحكم الكاملة
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={logout}
          activeOpacity={0.85}
          style={{ paddingVertical: 14, borderRadius: radius.lg, alignItems: 'center' }}
        >
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.danger }}>
            تسجيل الخروج
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
