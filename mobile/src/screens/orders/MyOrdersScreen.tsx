import { deviceTitle } from '../../lib/format';
// The customer's own order history.
//
// Cancel is offered only while an order is still 'pending', matching the
// server: once the shop has confirmed it, the device may already be with a
// courier and cancelling becomes a phone call, not a button.

import React from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarClearance } from '../../lib/tabBarClearance';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { fmtIQD } from '../../components/ui';
import { IconChevronLeft } from '../../components/icons';
import { Orders, type Order, type OrderStatus } from '../../api/endpoints';
import { arOf } from '../../lib/governorates';

const STATUS_AR: Record<OrderStatus, string> = {
  pending: 'قيد المراجعة',
  confirmed: 'مؤكّد',
  shipped: 'قيد التوصيل',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};
const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: '#E0A33E', confirmed: '#2F6FB5', shipped: '#5B52B8',
  delivered: theme.success, cancelled: theme.danger,
};

export default function MyOrdersScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const tabClearance = useTabBarClearance();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['orders', 'mine'],
    queryFn: () => Orders.mine(),
  });
  const orders = data || [];

  function cancel(o: Order) {
    Alert.alert('إلغاء الطلب', `تريد إلغاء الطلب ${o.code}؟`, [
      { text: 'رجوع', style: 'cancel' },
      {
        text: 'إلغاء الطلب',
        style: 'destructive',
        onPress: async () => {
          try {
            await Orders.cancel(o.id);
            qc.invalidateQueries({ queryKey: ['orders', 'mine'] });
          } catch {
            Alert.alert('خطأ', 'تعذّر إلغاء الطلب. ربما تم تأكيده من المتجر.');
          }
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 10,
        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
        borderBottomWidth: 1, borderBottomColor: theme.line,
      }}>
        {/* Back sits at the RIGHT, first in the reading order, matching
            Header and therefore Notifications, Saved Searches, My Listings
            and Wishlist. Orders and the cart each had it on the left, which
            made three back patterns across one app. */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}
        >
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconChevronLeft size={20} color={theme.ink} sw={2} />
          </View>
        </TouchableOpacity>
        <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}>
          طلباتي
        </Text>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(o) => String(o.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: tabClearance }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : (
          <View style={{ padding: 48, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.subtle }}>لا توجد طلبات بعد.</Text>
          </View>
        )}
        renderItem={({ item: o }) => (
          <View style={{
            backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
            borderColor: theme.line, padding: 14, marginBottom: 10,
          }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <View style={{ backgroundColor: STATUS_COLOR[o.status], borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 11, color: '#fff' }}>
                  {STATUS_AR[o.status]}
                </Text>
              </View>
              {/* The order ID was the only monospace text on the card, which
                  read as a different app's component dropped in. */}
              <Text style={{ fontFamily: fonts.ltr, fontSize: 12.5, color: theme.subtle, letterSpacing: 0.3 }}>{o.code}</Text>
              <Text style={{ flex: 1, textAlign: 'left', fontFamily: fonts.ltrBold, fontSize: 15, color: theme.accentDeep }}>
                {fmtIQD(o.total)}
                {/* Every other price in the app carries its currency. */}
                <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle }}> د.ع</Text>
              </Text>
            </View>

            <View style={{ marginTop: 8 }}>
              {o.items.map((it) => (
                <Text key={it.id} numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
                  {deviceTitle(it.brand, it.model)}{it.qty > 1 ? ` × ${it.qty}` : ''}
                </Text>
              ))}
            </View>

            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 6 }}>
              {arOf(o.governorate)} — {o.address}
            </Text>

            {o.status === 'pending' ? (
              <TouchableOpacity onPress={() => cancel(o)} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.danger }}>إلغاء الطلب</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}
