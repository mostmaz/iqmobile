// Orders — the screen the urgent notification opens into.
//
// A cash-on-delivery order is a person sitting by their phone waiting for a
// call back, so this screen is built around the two things an operator does
// standing up: ring the customer, and move the order one step forward.
// Everything else (fulfilment detail, returns, costs) stays on the desktop
// dashboard where there is room for it.

import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, Linking, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd } from '../theme';
import { api } from '../api/client';

type OrderItem = { id: number; brand: string; model: string; qty: number };
type Order = {
  id: number; code: string; status: string;
  customer_name: string; customer_phone: string;
  governorate: string; address: string; note: string | null;
  subtotal: number; shipping_fee: number; total: number;
  created_at: number;
  items?: OrderItem[];
};

const STATUS_AR: Record<string, string> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكّد',
  shipped: 'قيد التوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};
const STATUS_TONE: Record<string, string> = {
  pending: theme.urgent,
  confirmed: theme.info,
  shipped: theme.warn,
  delivered: theme.ok,
  cancelled: theme.faint,
};
// Mirrors the server's transition table — offering a move the API will
// reject is worse than offering none.
const NEXT: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'pending', label: 'بانتظار' },
  { key: 'confirmed', label: 'مؤكّد' },
  { key: 'shipped', label: 'توصيل' },
  { key: '', label: 'الكل' },
];

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['admin-orders', status],
    queryFn: () => api<{ orders: Order[] }>(
      `/admin/orders${status ? `?status=${status}` : ''}`,
    ),
  });

  const move = useMutation({
    mutationFn: ({ id, next }: { id: number; next: string }) =>
      api(`/admin/orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['work-queue'] });
    },
    onError: () => Alert.alert('تعذّر التحديث', 'لم يتم تغيير حالة الطلب. حاول مجدداً.'),
  });

  const call = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {});
  }, []);

  const orders = data?.orders || [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 19, fontWeight: '700', color: theme.ink,
        textAlign: 'right', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10,
      }}>
        الطلبات
      </Text>

      <View style={{ flexDirection: 'row-reverse', gap: 7, paddingHorizontal: 16, paddingBottom: 10 }}>
        {FILTERS.map((f) => {
          const active = status === f.key;
          return (
            <TouchableOpacity
              key={f.key || 'all'}
              onPress={() => setStatus(f.key)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
                backgroundColor: active ? theme.ink : theme.surface,
                borderWidth: 1, borderColor: active ? theme.ink : theme.line,
              }}
            >
              <Text style={{
                fontFamily: fonts.ar, fontSize: 12.5,
                color: active ? theme.bg : theme.subtle,
              }}>
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
              {isError ? 'تعذّر تحميل الطلبات.' : 'لا طلبات في هذه الحالة.'}
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
              <Text style={{
                flex: 1, textAlign: 'left', fontSize: 15, fontWeight: '700', color: theme.ink,
              }}>
                {iqd(o.total)} <Text style={{ fontSize: 11, color: theme.subtle }}>د.ع</Text>
              </Text>
            </View>

            <Text style={{
              fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ink,
              textAlign: 'right', marginTop: 10,
            }}>
              {o.customer_name}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
              {o.governorate} — {o.address}
            </Text>
            {o.items?.length ? (
              <Text numberOfLines={2} style={{
                fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
                textAlign: 'right', marginTop: 5,
              }}>
                {o.items.map((i) => `${i.brand} ${i.model}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join('، ')}
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 13 }}>
              {/* Calling comes first and is always available — it is the
                  actual job, and it stays possible on a cancelled order
                  when someone needs to explain why. */}
              <TouchableOpacity
                onPress={() => call(o.customer_phone)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`اتصال بـ ${o.customer_name}`}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: radius.lg,
                  backgroundColor: theme.ok, alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, fontWeight: '700', color: '#fff' }}>
                  اتصال
                </Text>
              </TouchableOpacity>

              {(NEXT[o.status] || []).map((next) => {
                const destructive = next === 'cancelled';
                return (
                  <TouchableOpacity
                    key={next}
                    disabled={move.isPending}
                    onPress={() => {
                      if (!destructive) { move.mutate({ id: o.id, next }); return; }
                      // Cancelling restores stock and cannot be undone from
                      // here, so it asks first.
                      Alert.alert('إلغاء الطلب؟', `${o.code} — لا يمكن التراجع.`, [
                        { text: 'رجوع', style: 'cancel' },
                        { text: 'إلغاء الطلب', style: 'destructive', onPress: () => move.mutate({ id: o.id, next }) },
                      ]);
                    }}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    style={{
                      flex: 1, paddingVertical: 12, borderRadius: radius.lg,
                      alignItems: 'center', opacity: move.isPending ? 0.5 : 1,
                      backgroundColor: destructive ? 'transparent' : theme.accent,
                      borderWidth: destructive ? 1.5 : 0,
                      borderColor: theme.line,
                    }}
                  >
                    <Text style={{
                      fontFamily: fonts.arBold, fontSize: 13.5, fontWeight: '700',
                      color: destructive ? theme.danger : '#fff',
                    }}>
                      {destructive ? 'إلغاء' : STATUS_AR[next]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      />
    </View>
  );
}
