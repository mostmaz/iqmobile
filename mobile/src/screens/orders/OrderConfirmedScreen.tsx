import { deviceTitle } from '../../lib/format';
// Post-checkout receipt. Its whole job is to make the order feel real: show
// the reference the customer can quote on the phone, what the courier will
// collect, and where it's going.

import React from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Btn, fmtIQD } from '../../components/ui';
import { IconCheck } from '../../components/icons';
import { Orders } from '../../api/endpoints';
import { arOf } from '../../lib/governorates';

export default function OrderConfirmedScreen({ route, navigation }: any) {
  const { id } = route.params as { id: number };
  const insets = useSafeAreaInsets();
  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => Orders.get(id),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 30, paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', marginBottom: 22 }}>
          <View style={{
            width: 62, height: 62, borderRadius: 999, backgroundColor: theme.successSoft,
            alignItems: 'center', justifyContent: 'center', marginBottom: 12,
          }}>
            <IconCheck size={30} color={theme.success} sw={2.4} />
          </View>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 19, fontWeight: '700', color: theme.ink }}>
            تم استلام طلبك
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'center', marginTop: 6 }}>
            راح نتصل بيك لتأكيد الطلب وتحديد وقت التوصيل.
          </Text>
        </View>

        {isLoading ? <ActivityIndicator color={theme.accent} /> : order ? (
          <View style={{
            backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
            borderColor: theme.line, padding: 16,
          }}>
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>رقم الطلب</Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: 20, color: theme.ink, marginTop: 2 }}>{order.code}</Text>
            </View>

            {order.items.map((it) => (
              <View key={it.id} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}>
                  {deviceTitle(it.brand, it.model)}{it.qty > 1 ? ` × ${it.qty}` : ''}
                </Text>
                <Text style={{ fontFamily: fonts.ltr, fontSize: 13.5, color: theme.ink }}>{fmtIQD(it.line_total)}</Text>
              </View>
            ))}

            <View style={{ height: 1, backgroundColor: theme.line, marginVertical: 10 }} />
            <Line label="أجور التوصيل" value={fmtIQD(order.shipping_fee)} />
            <Line label="المجموع (عند الاستلام)" value={`${fmtIQD(order.total)} د.ع`} bold />

            <View style={{ height: 1, backgroundColor: theme.line, marginVertical: 10 }} />
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
              {order.customer_name} · {order.customer_phone}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
              {arOf(order.governorate)} — {order.address}
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: 20, gap: 8 }}>
          <Btn kind="primary" full onPress={() => navigation.navigate('MyOrders')}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: theme.buttonInk }}>
              طلباتي
            </Text>
          </Btn>
          <TouchableOpacity onPress={() => navigation.popToTop()} style={{ padding: 12, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.subtle }}>العودة للتسوق</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 4 }}>
      <Text style={{ fontFamily: bold ? fonts.arBold : fonts.ar, fontSize: bold ? 15 : 13, color: theme.ink }}>{label}</Text>
      <Text style={{ fontFamily: bold ? fonts.ltrBold : fonts.ltr, fontSize: bold ? 15 : 13, color: bold ? theme.accentDeep : theme.ink }}>{value}</Text>
    </View>
  );
}
