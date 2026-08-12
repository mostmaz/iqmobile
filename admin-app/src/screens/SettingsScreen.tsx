// الإعدادات — every setting the dashboard exposes, plus this device's mutes.
//
// Grouped by blast radius rather than by the order the API returns them. The
// marketplace toggles change behaviour for everyone the moment they are
// saved; the version gates can lock users out of the app entirely; the
// overlay is shown to every user on next launch. That ordering is the
// warning.

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../theme';
import { api } from '../api/client';
import { ScreenHeader } from '../components/kit';
import { useAuth } from '../lib/auth';
import { setMutedKinds, KIND_LABEL, type AdminPushKind } from '../lib/push';

type Settings = {
  listing_ttl_days: number;
  reserve_on_confirm: boolean;
  shops_unlimited_listings: boolean;
  listings_never_expire: boolean;
  min_supported_version: string | null;
  nag_below_version: string | null;
  overlay_enabled: boolean;
  overlay_title: string | null;
  overlay_body: string | null;
  overlay_image: string | null;
  overlay_cta_label: string | null;
  overlay_cta_url: string | null;
  overlay_version: string | null;
  overlay_frequency: string | null;
};
type InspectionStatus = {
  configured: boolean; enabled: boolean; enabled_setting: boolean;
  autoreject: boolean; pending: number; errors: number;
};

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { muted, setMuted } = useAuth();
  const [savingKind, setSavingKind] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<Settings>('/admin/settings'),
  });
  const inspection = useQuery({
    queryKey: ['inspection-status'],
    queryFn: () => api<InspectionStatus>('/admin/inspection/status'),
  });

  useEffect(() => { setDraft({}); }, [data]);

  const patch = useMutation({
    mutationFn: (body: any) => api('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      qc.invalidateQueries({ queryKey: ['inspection-status'] });
      setDraft({});
    },
    onError: (e: any) => Alert.alert('تعذّر الحفظ',
      e?.code === 'bad_ttl' ? 'مدة الصلاحية غير صالحة.' : 'لم يتم تطبيق الإعداد.'),
  });

  const val = (k: keyof Settings) => (k in draft ? draft[k] : (data as any)?.[k]);
  const setV = (k: string, v: any) => setDraft((p) => ({ ...p, [k]: v }));
  const dirty = Object.keys(draft).length > 0;

  async function toggleKind(kind: AdminPushKind) {
    const next = muted.includes(kind) ? muted.filter((k) => k !== kind) : [...muted, kind];
    setSavingKind(kind);
    setMuted(next); // optimistic — the switch should move under the thumb
    try {
      setMuted(await setMutedKinds(next));
    } catch {
      setMuted(muted);
      Alert.alert('تعذّر الحفظ', 'لم يتم تغيير التنبيهات.');
    } finally { setSavingKind(null); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="الإعدادات" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + (dirty ? 110 : 90) }}
        keyboardShouldPersistTaps="handled"
      >
        <Section label="التنبيهات على هذا الجهاز" />
        <Group>
          {(Object.keys(KIND_LABEL) as AdminPushKind[]).map((k, i) => (
            <Row key={k} first={i === 0} label={KIND_LABEL[k]} hint={muted.includes(k) ? 'مكتوم' : 'مُفعّل'}>
              <Switch
                value={!muted.includes(k)}
                onValueChange={() => toggleKind(k)}
                disabled={savingKind === k}
                trackColor={{ true: theme.accent, false: theme.surfaceAlt }}
                thumbColor="#fff"
              />
            </Row>
          ))}
        </Group>

        {isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : isError ? (
          <Retry onPress={refetch} />
        ) : (
          <>
            <Section label="السوق" />
            <Group>
              <Row first label="الإعلانات لا تنتهي" hint="تجاهل مدة الصلاحية بالكامل">
                <Switch value={!!val('listings_never_expire')}
                  onValueChange={(v) => setV('listings_never_expire', v)}
                  trackColor={{ true: theme.accent, false: theme.surfaceAlt }} thumbColor="#fff" />
              </Row>
              <Row label="مدة صلاحية الإعلان (أيام)" hint="تُتجاهَل عندما يكون الخيار أعلاه مفعّلاً">
                <Num value={val('listing_ttl_days')} onChange={(v) => setV('listing_ttl_days', v)} />
              </Row>
              <Row label="حجز عند التأكيد" hint="يحجز الجهاز فور تأكيد الصفقة">
                <Switch value={!!val('reserve_on_confirm')}
                  onValueChange={(v) => setV('reserve_on_confirm', v)}
                  trackColor={{ true: theme.accent, false: theme.surfaceAlt }} thumbColor="#fff" />
              </Row>
              <Row label="إعلانات غير محدودة للمتاجر" hint="رفع سقف النشر عن حسابات المتاجر">
                <Switch value={!!val('shops_unlimited_listings')}
                  onValueChange={(v) => setV('shops_unlimited_listings', v)}
                  trackColor={{ true: theme.accent, false: theme.surfaceAlt }} thumbColor="#fff" />
              </Row>
            </Group>

            <Section label="الفحص التلقائي" />
            <Group>
              <Row first label="الفحص مفعّل"
                hint={inspection.data?.configured === false
                  ? 'غير مُهيّأ على الخادم — التبديل لن يفعل شيئاً'
                  : `${inspection.data?.pending ?? 0} بانتظار · ${inspection.data?.errors ?? 0} فشل`}>
                <Switch value={!!inspection.data?.enabled_setting}
                  onValueChange={(v) => patch.mutate({ listing_inspection_enabled: v })}
                  disabled={patch.isPending}
                  trackColor={{ true: theme.accent, false: theme.surfaceAlt }} thumbColor="#fff" />
              </Row>
              <Row label="الرفض التلقائي" hint="يحذف الإعلان المرفوض دون مراجعة بشرية">
                <Switch value={!!inspection.data?.autoreject}
                  onValueChange={(v) => patch.mutate({ listing_inspection_autoreject: v })}
                  disabled={patch.isPending}
                  trackColor={{ true: theme.danger, false: theme.surfaceAlt }} thumbColor="#fff" />
              </Row>
            </Group>

            {/* A wrong value here locks users out of the app on next launch,
                so it sits apart with its own warning rather than blending in
                with the toggles above. */}
            <Section label="إصدارات التطبيق" />
            <Warn>تغيير هذه القيم يؤثر على كل المستخدمين عند فتح التطبيق.</Warn>
            <Group>
              <Row first label="أقل إصدار مدعوم" hint="أقل من هذا يُمنع من الاستخدام">
                <Txt value={val('min_supported_version')} onChange={(v) => setV('min_supported_version', v)} placeholder="0.3.0" />
              </Row>
              <Row label="تنبيه أقل من إصدار" hint="يظهر تذكيراً بالتحديث دون منع">
                <Txt value={val('nag_below_version')} onChange={(v) => setV('nag_below_version', v)} placeholder="0.3.0" />
              </Row>
            </Group>

            <Section label="الرسالة الترويجية" />
            <Warn>تظهر لكل مستخدم عند فتح التطبيق.</Warn>
            <Group>
              <Row first label="مفعّلة">
                <Switch value={!!val('overlay_enabled')}
                  onValueChange={(v) => setV('overlay_enabled', v)}
                  trackColor={{ true: theme.accent, false: theme.surfaceAlt }} thumbColor="#fff" />
              </Row>
            </Group>
            <Wide label="العنوان" value={val('overlay_title')} onChange={(v) => setV('overlay_title', v)} />
            <Wide label="النص" value={val('overlay_body')} onChange={(v) => setV('overlay_body', v)} multiline />
            <Wide label="رابط الصورة" value={val('overlay_image')} onChange={(v) => setV('overlay_image', v)} ltr />
            <Wide label="نص الزر" value={val('overlay_cta_label')} onChange={(v) => setV('overlay_cta_label', v)} />
            <Wide label="رابط الزر" value={val('overlay_cta_url')} onChange={(v) => setV('overlay_cta_url', v)} ltr />
            <Wide label="نسخة الرسالة" value={val('overlay_version')} onChange={(v) => setV('overlay_version', v)} ltr
              hint="غيّرها لإظهار الرسالة من جديد لمن أغلقها سابقاً." />
            <Wide label="التكرار" value={val('overlay_frequency')} onChange={(v) => setV('overlay_frequency', v)} ltr
              hint="once أو always" />
          </>
        )}
      </ScrollView>

      {/* The toggles above save on change; the typed fields batch into one
          PATCH so a half-typed version string is never sent. */}
      {dirty ? (
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12),
          backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.line,
          flexDirection: 'row-reverse', gap: 8,
        }}>
          <TouchableOpacity
            disabled={patch.isPending}
            onPress={() => patch.mutate(draft)}
            style={{
              flex: 1.4, paddingVertical: 14, borderRadius: radius.lg,
              backgroundColor: theme.accent, alignItems: 'center', opacity: patch.isPending ? 0.5 : 1,
            }}
          >
            {patch.isPending ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: '#fff' }}>
                  حفظ {Object.keys(draft).length} تغيير
                </Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setDraft({})} style={{
            flex: 1, paddingVertical: 14, borderRadius: radius.lg,
            borderWidth: 1.5, borderColor: theme.line, alignItems: 'center',
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.subtle }}>تراجع</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function Section({ label }: { label: string }) {
  return (
    <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.faint, textAlign: 'right', marginBottom: 8, marginTop: 14 }}>
      {label}
    </Text>
  );
}
function Warn({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.warn, textAlign: 'right', marginBottom: 8, lineHeight: 18 }}>
      {children}
    </Text>
  );
}
function Group({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: theme.surface, borderRadius: radius.xl,
      borderWidth: 1, borderColor: theme.line, overflow: 'hidden', marginBottom: 4,
    }}>{children}</View>
  );
}
function Row({ label, hint, children, first }: {
  label: string; hint?: string; children: React.ReactNode; first?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
      paddingHorizontal: 15, paddingVertical: 13,
      borderTopWidth: first ? 0 : 1, borderTopColor: theme.line,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right' }}>{label}</Text>
        {hint ? (
          <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.faint, textAlign: 'right', marginTop: 2, lineHeight: 17 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
function Num({ value, onChange }: { value: any; onChange: (v: number) => void }) {
  return (
    <TextInput
      value={String(value ?? '')}
      onChangeText={(t) => onChange(Number(t.replace(/\D/g, '')) || 0)}
      keyboardType="phone-pad"
      style={{
        width: 74, backgroundColor: theme.bg, borderRadius: radius.md,
        borderWidth: 1, borderColor: theme.line, paddingVertical: 8,
        fontSize: 15, color: theme.ink, textAlign: 'center',
      }}
    />
  );
}
function Txt({ value, onChange, placeholder }: { value: any; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <TextInput
      value={String(value ?? '')}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.faint}
      autoCapitalize="none"
      style={{
        width: 110, backgroundColor: theme.bg, borderRadius: radius.md,
        borderWidth: 1, borderColor: theme.line, paddingVertical: 8, paddingHorizontal: 8,
        fontSize: 14, color: theme.ink, textAlign: 'center',
      }}
    />
  );
}
function Wide({ label, value, onChange, multiline, ltr, hint }: {
  label: string; value: any; onChange: (v: string) => void;
  multiline?: boolean; ltr?: boolean; hint?: string;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginBottom: 5 }}>
        {label}
      </Text>
      <TextInput
        value={String(value ?? '')}
        onChangeText={onChange}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="—"
        placeholderTextColor={theme.faint}
        style={{
          backgroundColor: theme.surface, borderRadius: radius.lg,
          borderWidth: 1, borderColor: theme.line,
          paddingHorizontal: 14, paddingVertical: 12,
          minHeight: multiline ? 80 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
          fontSize: 14.5, color: theme.ink, textAlign: ltr ? 'left' : 'right',
        }}
      />
      {hint ? (
        <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.faint, textAlign: 'right', marginTop: 4 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
function Retry({ onPress }: { onPress: () => void }) {
  return (
    <View style={{ paddingVertical: 36, alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle }}>تعذّر تحميل الإعدادات.</Text>
      <TouchableOpacity onPress={onPress} style={{
        marginTop: 12, paddingHorizontal: 20, paddingVertical: 10,
        borderRadius: radius.pill, backgroundColor: theme.accent,
      }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: '#fff' }}>إعادة المحاولة</Text>
      </TouchableOpacity>
    </View>
  );
}
