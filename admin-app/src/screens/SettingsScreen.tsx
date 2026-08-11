// الإعدادات — the switches that change how the marketplace behaves.
//
// Only the booleans and the notification mutes are here. The overlay copy
// and version gates are long free text that belongs on a keyboard, and
// getting one of them wrong is visible to every user on next launch, so they
// stay on the desktop rather than being fat-fingered from a phone.

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../theme';
import { api } from '../api/client';
import { ScreenHeader } from '../components/kit';
import { useAuth } from '../lib/auth';
import { setMutedKinds, KIND_LABEL, type AdminPushKind } from '../lib/push';

type Settings = {
  reserve_on_confirm: boolean;
  shops_unlimited_listings: boolean;
  listings_never_expire: boolean;
  listing_ttl_days: number;
};

const TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'listings_never_expire', label: 'الإعلانات لا تنتهي', hint: 'تجاهل مدة الصلاحية' },
  { key: 'reserve_on_confirm', label: 'حجز عند التأكيد', hint: 'يحجز الجهاز فور تأكيد الصفقة' },
  { key: 'shops_unlimited_listings', label: 'إعلانات غير محدودة للمتاجر', hint: 'رفع سقف النشر' },
];

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { muted, setMuted } = useAuth();
  const [savingKind, setSavingKind] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<Settings>('/admin/settings'),
  });

  const patch = useMutation({
    mutationFn: (body: any) => api('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-settings'] }),
    onError: () => Alert.alert('تعذّر الحفظ', 'لم يتم تطبيق الإعداد.'),
  });

  async function toggleKind(kind: AdminPushKind) {
    const next = muted.includes(kind) ? muted.filter((k) => k !== kind) : [...muted, kind];
    setSavingKind(kind);
    // Optimistic: the switch should move under the thumb, not after a
    // round-trip. Rolled back if the server disagrees.
    setMuted(next);
    try {
      setMuted(await setMutedKinds(next));
    } catch {
      setMuted(muted);
      Alert.alert('تعذّر الحفظ', 'لم يتم تغيير التنبيهات.');
    } finally {
      setSavingKind(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="الإعدادات" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90 }}>
        <Section label="التنبيهات على هذا الجهاز" />
        <Group>
          {(Object.keys(KIND_LABEL) as AdminPushKind[]).map((k, i) => (
            <Row
              key={k}
              label={KIND_LABEL[k]}
              hint={muted.includes(k) ? 'مكتوم' : 'مُفعّل'}
              value={!muted.includes(k)}
              busy={savingKind === k}
              first={i === 0}
              onChange={() => toggleKind(k)}
            />
          ))}
        </Group>

        <Section label="السوق" />
        {isLoading ? (
          <View style={{ paddingVertical: 30, alignItems: 'center' }}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : isError ? (
          <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', paddingVertical: 24 }}>
            تعذّر تحميل الإعدادات.
          </Text>
        ) : (
          <Group>
            {TOGGLES.map((t, i) => (
              <Row
                key={t.key}
                label={t.label}
                hint={t.hint}
                value={!!data?.[t.key]}
                busy={patch.isPending}
                first={i === 0}
                onChange={(v) => patch.mutate({ [t.key]: v })}
              />
            ))}
          </Group>
        )}

        <Text style={{
          fontFamily: fonts.ar, fontSize: 11.5, color: theme.faint,
          textAlign: 'right', marginTop: 14, lineHeight: 18,
        }}>
          نصوص الرسالة الترويجية وإعدادات إصدار التطبيق تُدار من لوحة التحكم على الويب.
        </Text>
      </ScrollView>
    </View>
  );
}

function Section({ label }: { label: string }) {
  return (
    <Text style={{
      fontFamily: fonts.arBold, fontSize: 12.5, color: theme.faint,
      textAlign: 'right', marginBottom: 8, marginTop: 8,
    }}>
      {label}
    </Text>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: theme.surface, borderRadius: radius.xl,
      borderWidth: 1, borderColor: theme.line, overflow: 'hidden', marginBottom: 10,
    }}>
      {children}
    </View>
  );
}

function Row({ label, hint, value, onChange, busy, first }: {
  label: string; hint?: string; value: boolean;
  onChange: (v: boolean) => void; busy?: boolean; first?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
      paddingHorizontal: 15, paddingVertical: 13,
      borderTopWidth: first ? 0 : 1, borderTopColor: theme.line,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.ar, fontSize: 14.5, color: theme.ink, textAlign: 'right' }}>{label}</Text>
        {hint ? (
          <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.faint, textAlign: 'right', marginTop: 2 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={busy}
        trackColor={{ true: theme.accent, false: theme.surfaceAlt }}
        thumbColor="#fff"
      />
    </View>
  );
}
