// ضمان iQ — the guarantee pipeline, phone-first.
//
// Same shape as Orders: every stage is a call, so the card leads with TWO
// call buttons (buyer and seller — this pipeline runs on both) and then the
// single legal next step. The one stage with data entry is الفحص: the card
// expands in place for the report text + العربون, because Alert.prompt can't
// take two fields (and doesn't exist on Android anyway).

import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, Linking, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd, deviceTitle } from '../theme';
import { api } from '../api/client';

type GOrder = {
  id: number; code: string; listing_id: number | null;
  brand: string; model: string; storage: string | null;
  asking_price: number; fee_pct: number; fee: number; total: number;
  buyer_phone: string; seller_phone: string | null; seller_opted_in: number;
  status: string; front_payment: number | null; inspection_report: string | null;
  cancel_reason: string | null; cancelled_stage: string | null;
  governorate: string | null; created_at: number;
};

const STATUS_AR: Record<string, string> = {
  new: 'جديد',
  buyer_confirmed: 'المشتري مؤكّد',
  seller_confirmed: 'البائع موافق',
  picked_up: 'الجهاز عندنا',
  inspected: 'تم الفحص',
  front_paid: 'العربون مدفوع',
  shipped: 'قيد التوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};
const STATUS_TONE: Record<string, string> = {
  new: theme.urgent,
  buyer_confirmed: theme.info,
  seller_confirmed: theme.info,
  picked_up: theme.warn,
  inspected: theme.warn,
  front_paid: theme.ok,
  shipped: theme.warn,
  delivered: theme.ok,
  cancelled: theme.faint,
};
// Mirrors GUARANTEE_NEXT on the server.
const NEXT: Record<string, string[]> = {
  new: ['buyer_confirmed', 'cancelled'],
  buyer_confirmed: ['seller_confirmed', 'cancelled'],
  seller_confirmed: ['picked_up', 'cancelled'],
  picked_up: ['inspected', 'cancelled'],
  inspected: ['front_paid', 'cancelled'],
  front_paid: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [], cancelled: [],
};
// Button labels read as the ACTION, not the resulting state.
const ACTION_AR: Record<string, string> = {
  buyer_confirmed: 'تأكيد المشتري',
  seller_confirmed: 'البائع وافق',
  picked_up: 'استلمنا الجهاز',
  inspected: 'تسجيل الفحص',
  front_paid: 'العربون وصل',
  shipped: 'شُحن',
  delivered: 'سُلّم',
};
const CANCEL_REASONS = ['رفض البائع', 'رفض المشتري', 'فشل الفحص', 'أخرى'];

const FILTERS: { key: string; label: string }[] = [
  { key: 'new', label: 'جديد' },
  { key: 'picked_up', label: 'للفحص' },
  { key: 'inspected', label: 'مفحوص' },
  { key: '', label: 'الكل' },
];

export default function GuaranteeScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [status, setStatus] = useState('new');
  // Inspection entry, inline on one card at a time.
  const [inspecting, setInspecting] = useState<number | null>(null);
  const [report, setReport] = useState('');
  const [deposit, setDeposit] = useState('');

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['admin-guarantee', status],
    queryFn: () => api<{ orders: GOrder[] }>(
      `/admin/guarantee${status ? `?status=${status}` : ''}`,
    ),
  });

  const move = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      api(`/admin/guarantee/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      setInspecting(null);
      qc.invalidateQueries({ queryKey: ['admin-guarantee'] });
      qc.invalidateQueries({ queryKey: ['work-queue'] });
    },
    onError: () => Alert.alert('تعذّر التحديث', 'لم يتم تغيير حالة الطلب. حاول مجدداً.'),
  });

  const call = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {});
  }, []);

  function askCancel(o: GOrder) {
    // Canned reasons keep the funnel data queryable — free text only behind أخرى.
    Alert.alert('سبب الإلغاء؟', o.code, [
      ...CANCEL_REASONS.map((r) => ({
        text: r,
        onPress: () => move.mutate({ id: o.id, body: { status: 'cancelled', cancel_reason: r } }),
      })),
      { text: 'رجوع', style: 'cancel' as const },
    ]);
  }

  const orders = data?.orders || [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 19, fontWeight: '700', color: theme.ink,
        textAlign: 'right', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10,
      }}>
        🛡️ ضمان iQ
      </Text>

      <View style={{ flexDirection: 'row-reverse', gap: 7, paddingHorizontal: 16, paddingBottom: 10 }}>
        {FILTERS.map((f) => {
          const active = status === f.key;
          return (
            <TouchableOpacity
              key={f.key || 'all'}
              onPress={() => setStatus(f.key)}
              activeOpacity={0.8}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
                backgroundColor: active ? theme.ink : theme.surface,
                borderWidth: 1, borderColor: active ? theme.ink : theme.line,
              }}
            >
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: active ? theme.bg : theme.subtle }}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={orders}
        keyExtractor={(o) => String(o.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : (
            <Text style={{
              fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
              textAlign: 'center', paddingVertical: 50,
            }}>
              {isError ? 'تعذّر تحميل الطلبات.' : 'لا طلبات ضمان في هذه الحالة.'}
            </Text>
          )
        }
        renderItem={({ item: o }) => (
          <View style={{
            backgroundColor: theme.surface, borderRadius: radius.xl,
            borderWidth: 1, borderColor: theme.line, padding: 15, marginBottom: 11,
          }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 9 }}>
              <View style={{
                paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill,
                backgroundColor: STATUS_TONE[o.status] || theme.faint,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>
                  {STATUS_AR[o.status] || o.status}
                </Text>
              </View>
              <Text style={{ fontSize: 12.5, color: theme.subtle }}>{o.code}</Text>
              <Text style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: '700', color: theme.ink }}>
                {iqd(o.total)} <Text style={{ fontSize: 11, color: theme.subtle }}>د.ع</Text>
              </Text>
            </View>

            <Text style={{
              fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ink,
              textAlign: 'right', marginTop: 10,
            }}>
              {deviceTitle(o.brand, o.model)}{o.storage ? ` · ${o.storage}` : ''}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
              السعر {iqd(o.asking_price)} + رسوم {o.fee_pct}٪ = {iqd(o.total)} د.ع
              {o.seller_opted_in ? ' · البائع موافق مسبقاً ✅' : ''}
            </Text>
            {o.front_payment != null ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
                العربون {iqd(o.front_payment)} · المتبقي {iqd(o.total - o.front_payment)} د.ع
              </Text>
            ) : null}
            {o.inspection_report ? (
              <Text style={{
                fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
                textAlign: 'right', marginTop: 5,
              }}>
                📋 {o.inspection_report}
              </Text>
            ) : null}
            {o.cancel_reason ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.danger, textAlign: 'right', marginTop: 5 }}>
                أُلغي: {o.cancel_reason}{o.cancelled_stage ? ` (عند ${STATUS_AR[o.cancelled_stage] || o.cancelled_stage})` : ''}
              </Text>
            ) : null}

            {/* Two calls per order — label who answers. */}
            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 13 }}>
              <TouchableOpacity
                onPress={() => call(o.buyer_phone)}
                activeOpacity={0.85}
                style={{
                  flex: 1, paddingVertical: 11, borderRadius: radius.lg,
                  backgroundColor: theme.ok, alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, fontWeight: '700', color: '#fff' }}>
                  📞 المشتري
                </Text>
              </TouchableOpacity>
              {o.seller_phone ? (
                <TouchableOpacity
                  onPress={() => call(o.seller_phone!)}
                  activeOpacity={0.85}
                  style={{
                    flex: 1, paddingVertical: 11, borderRadius: radius.lg,
                    backgroundColor: theme.info, alignItems: 'center',
                  }}
                >
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13, fontWeight: '700', color: '#fff' }}>
                    📞 البائع
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* الفحص entry — expands in place. */}
            {inspecting === o.id ? (
              <View style={{ marginTop: 10 }}>
                <TextInput
                  value={report}
                  onChangeText={setReport}
                  multiline
                  placeholder="تقرير الفحص — الشاشة، البطارية، الهيكل، مطابقة الوصف…"
                  placeholderTextColor={theme.faint}
                  style={{
                    backgroundColor: theme.bg, borderRadius: radius.lg,
                    borderWidth: 1, borderColor: theme.line, minHeight: 84,
                    paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top',
                    fontSize: 13.5, color: theme.ink, textAlign: 'right', fontFamily: fonts.ar,
                  }}
                />
                <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <TextInput
                    value={deposit}
                    onChangeText={(v) => setDeposit(v.replace(/[^\d]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="العربون د.ع"
                    placeholderTextColor={theme.faint}
                    style={{
                      flex: 1, backgroundColor: theme.bg, borderRadius: radius.lg,
                      borderWidth: 1, borderColor: theme.line,
                      paddingHorizontal: 12, paddingVertical: 10,
                      fontSize: 14, color: theme.ink, textAlign: 'right',
                    }}
                  />
                  <TouchableOpacity
                    disabled={move.isPending}
                    onPress={() => move.mutate({
                      id: o.id,
                      body: { status: 'inspected', inspection_report: report, front_payment: Number(deposit) },
                    })}
                    activeOpacity={0.85}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.lg,
                      backgroundColor: theme.accent, opacity: move.isPending ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: '#fff' }}>حفظ وإشعار</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setInspecting(null)} style={{ paddingHorizontal: 8 }}>
                    <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}>إغلاق</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 10 }}>
              {(NEXT[o.status] || []).filter((n) => n !== 'cancelled').map((next) => (
                <TouchableOpacity
                  key={next}
                  disabled={move.isPending}
                  onPress={() => {
                    if (next === 'inspected') {
                      setInspecting(o.id);
                      setReport(o.inspection_report || '');
                      setDeposit(o.front_payment != null ? String(o.front_payment) : '');
                      return;
                    }
                    move.mutate({ id: o.id, body: { status: next } });
                  }}
                  activeOpacity={0.85}
                  style={{
                    flex: 1, paddingVertical: 12, borderRadius: radius.lg,
                    alignItems: 'center', opacity: move.isPending ? 0.5 : 1,
                    backgroundColor: theme.accent,
                  }}
                >
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, fontWeight: '700', color: '#fff' }}>
                    {ACTION_AR[next] || STATUS_AR[next]}
                  </Text>
                </TouchableOpacity>
              ))}
              {(NEXT[o.status] || []).includes('cancelled') ? (
                <TouchableOpacity
                  disabled={move.isPending}
                  onPress={() => askCancel(o)}
                  activeOpacity={0.85}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.lg,
                    alignItems: 'center', borderWidth: 1.5, borderColor: theme.line,
                  }}
                >
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.danger }}>إلغاء</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
      />
    </View>
  );
}
