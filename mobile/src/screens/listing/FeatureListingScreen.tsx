// "ميّز إعلانك" — feature-a-listing flow. No payment gateway: the seller
// transfers airtime to the owner's number, then submits this request (tier +
// carrier + the number they paid from). It lands as pending; an admin approves
// it from the dashboard, which pins the listing to the top for the tier's
// duration.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Header, Btn, Input, FieldLabel, Pill, fmtIQD } from '../../components/ui';
import { IconSpark, IconCheck } from '../../components/icons';
import { Features, type FeatureCarrier } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';

const CARRIER_LABEL: Record<FeatureCarrier, string> = { asiacell: 'آسياسيل', korek: 'كورك' };

export default function FeatureListingScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const listingId: number = route.params?.id;
  const label: string | undefined = route.params?.label;

  const { data, isLoading } = useQuery({ queryKey: ['feature-tiers'], queryFn: () => Features.tiers() });
  const { data: mine } = useQuery({ queryKey: ['features-mine'], queryFn: () => Features.mine() });

  const [tier, setTier] = useState<string | null>(null);
  const [carrier, setCarrier] = useState<FeatureCarrier>('asiacell');
  const [sender, setSender] = useState(user?.phone || '');
  const [note, setNote] = useState('');

  // Existing request for THIS listing (so we show status instead of a form
  // when one is already in flight or recently decided).
  const existing = useMemo(
    () => (mine || []).find((f) => f.listing_id === listingId),
    [mine, listingId],
  );

  const submit = useMutation({
    mutationFn: () => Features.request(listingId, { tier: tier!, carrier, sender_phone: sender.trim(), note: note.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['features-mine'] });
      Alert.alert('تم إرسال الطلب ✅', 'سنراجع التحويل ونفعّل إعلانك المميّز قريباً.', [
        { text: 'حسناً', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (e: any) => {
      const code = e?.data?.error || e?.message;
      const map: Record<string, string> = {
        request_pending: 'لديك طلب قيد المراجعة لهذا الإعلان بالفعل.',
        bad_tier: 'اختر باقة صحيحة.',
        bad_carrier: 'اختر شركة الاتصال.',
        bad_sender_phone: 'أدخل رقم الهاتف الذي حوّلت منه.',
        forbidden: 'هذا الإعلان ليس لك.',
        not_found: 'الإعلان غير موجود.',
      };
      Alert.alert('تعذّر الإرسال', map[code] || 'حدث خطأ، حاول مجدداً.');
    },
  });

  function onSubmit() {
    if (!tier) { Alert.alert('اختر الباقة', 'حدّد إحدى باقات التمييز أولاً.'); return; }
    if (sender.replace(/\D/g, '').length < 10) { Alert.alert('رقم غير صحيح', 'أدخل الرقم الذي حوّلت منه الرصيد.'); return; }
    submit.mutate();
  }

  const ownerPhone = data?.owner_phone || '07736969091';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="ميّز إعلانك" badge="SHOP" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {label ? (
          <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right', marginBottom: 12 }}>{label}</Text>
        ) : null}

        {existing && existing.status === 'pending' ? (
          <StatusCard
            tone="pending"
            title="طلبك قيد المراجعة"
            body="استلمنا طلبك وسنفعّل التمييز بعد تأكيد التحويل. شكراً لصبرك."
          />
        ) : existing && existing.status === 'approved' && existing.featured_until && existing.featured_until > Date.now() ? (
          <StatusCard
            tone="ok"
            title="إعلانك مميّز ✨"
            body={`سيظل في أعلى القائمة حتى ${new Date(existing.featured_until).toLocaleDateString()}.`}
          />
        ) : null}

        {isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : (
          <>
            <FieldLabel>اختر الباقة</FieldLabel>
            <View style={{ gap: 10, marginTop: 6 }}>
              {(data?.tiers || []).map((t) => {
                const active = tier === t.key;
                return (
                  <TouchableOpacity key={t.key} activeOpacity={0.85} onPress={() => setTier(t.key)} style={{
                    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
                    backgroundColor: active ? theme.accentSoft : theme.surface,
                    borderWidth: 1.5, borderColor: active ? theme.accent : theme.line,
                    borderRadius: radius.xxl, padding: 14,
                  }}>
                    <View style={{
                      width: 40, height: 40, borderRadius: 12,
                      backgroundColor: active ? theme.accent : theme.chipBg,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <IconSpark size={20} color={active ? '#fff' : theme.subtle} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: theme.ink, textAlign: 'right' }}>
                        {t.label_ar}
                      </Text>
                      <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                        {t.days} أيام · يُرفع لأعلى القائمة {t.boosts_per_day} مرات يومياً
                      </Text>
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 16, color: theme.accentDeep }}>{fmtIQD(t.amount)}</Text>
                      <Text style={{ fontFamily: fonts.ar, fontSize: 10, color: theme.subtle }}>د.ع</Text>
                    </View>
                    {active ? <IconCheck size={18} color={theme.accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Airtime instructions */}
            <View style={{
              marginTop: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
              borderRadius: radius.xxl, padding: 16,
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, fontWeight: '700', color: theme.ink, textAlign: 'right' }}>
                طريقة الدفع — تحويل رصيد
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', marginTop: 6, lineHeight: 22 }}>
                حوّل قيمة الباقة رصيداً (آسياسيل أو كورك) إلى الرقم التالي، ثم أكمل الطلب أدناه:
              </Text>
              <View style={{
                marginTop: 10, backgroundColor: theme.chipBg, borderRadius: radius.lg,
                paddingVertical: 12, alignItems: 'center',
              }}>
                <Text selectable style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 22, color: theme.ink, letterSpacing: 1 }}>
                  {ownerPhone}
                </Text>
              </View>
            </View>

            <View style={{ height: 16 }} />
            <FieldLabel>شركة الاتصال</FieldLabel>
            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 6 }}>
              {(data?.carriers || ['asiacell', 'korek']).map((c) => (
                <Pill key={c} active={carrier === c} onPress={() => setCarrier(c as FeatureCarrier)}>
                  {CARRIER_LABEL[c as FeatureCarrier] || c}
                </Pill>
              ))}
            </View>

            <View style={{ height: 14 }} />
            <FieldLabel>الرقم الذي حوّلت منه</FieldLabel>
            <Input value={sender} onChangeText={setSender} placeholder="07XXXXXXXXX" numeric ltr />

            <View style={{ height: 14 }} />
            <FieldLabel>ملاحظة (اختياري)</FieldLabel>
            <Input value={note} onChangeText={setNote} placeholder="أي تفاصيل تساعدنا في تأكيد التحويل" multiline />

            <View style={{ height: 22 }} />
            <Btn kind="accent" full busy={submit.isPending} onPress={onSubmit}>إرسال الطلب</Btn>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, marginTop: 12, textAlign: 'center', lineHeight: 20 }}>
              بعد تأكيد التحويل يدوياً، سيظهر إعلانك في أعلى القائمة مباشرة.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatusCard({ tone, title, body }: { tone: 'pending' | 'ok'; title: string; body: string }) {
  const bg = tone === 'ok' ? theme.successSoft : theme.accentSoft;
  const border = tone === 'ok' ? theme.success : theme.accent;
  return (
    <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: radius.xxl, padding: 16, marginBottom: 16 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: theme.ink, textAlign: 'right' }}>{title}</Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', marginTop: 4, lineHeight: 21 }}>{body}</Text>
    </View>
  );
}
