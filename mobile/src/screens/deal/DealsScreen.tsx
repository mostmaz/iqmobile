import React from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Header, fmtIQD } from '../../components/ui';
import { RowListSkeleton } from '../../components/Skeleton';
import { Deals } from '../../api/endpoints';
import { ar } from '../../i18n/ar';
import { useAuth } from '../../auth/AuthContext';
import { callPhone } from '../../lib/contact';

export default function DealsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['deals'],
    queryFn: () => Deals.mine(undefined, 'all'),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.deals} onBack={() => navigation.goBack()} />
      <FlatList
        data={data || []}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => {
          const isBuyer = user?.id === item.buyer_id;
          const counterparty = isBuyer ? item.seller : item.buyer;
          return (
            // Chat tab is hidden in the active nav stack (see
            // navigation/index.tsx) — the previous onPress tried to
            // navigate('Chat', …) and threw "action NAVIGATE not handled"
            // on every tap. Until chat ships, deals are a read-only card
            // — the Call + Rate buttons inside the card cover the only
            // meaningful actions a confirmed deal needs.
            <View
              style={{
                padding: 12, marginBottom: 8, borderRadius: radius.lg,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
              }}
            >
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, fontWeight: '600' }}>
                  {item.listing ? `${item.listing.brand} ${item.listing.model}` : '—'}
                </Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: item.status === 'seller_confirmed' ? theme.successSoft : theme.chipBg, borderRadius: 999 }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: item.status === 'seller_confirmed' ? theme.success : theme.subtle }}>
                    {(ar.deal as any)[item.status] || item.status}
                  </Text>
                </View>
              </View>
              <Text style={{ fontFamily: fonts.ltrBold, fontSize: 18, color: theme.accentDeep, marginTop: 6 }}>
                {fmtIQD(item.final_price)} د.ع
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, marginTop: 2, textAlign: 'right' }}>
                {isBuyer ? `البائع: ${counterparty?.display_name}` : `المشتري: ${counterparty?.display_name}`}
              </Text>
              {item.status === 'seller_confirmed' && isBuyer && item.seller?.phone ? (
                <View style={{ marginTop: 8, flexDirection: 'row-reverse', gap: 6 }}>
                  {/* callPhone goes through the same Iraqi-phone normaliser
                      + .catch(Alert) the rest of the app uses, so a device
                      without a dialer doesn't redbox / unhandled-reject. */}
                  <TouchableOpacity onPress={() => callPhone(item.seller!.phone!)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: theme.success }}>
                    <Text style={{ color: '#fff', fontFamily: fonts.arBold }}>📞 {item.seller.phone}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => navigation.navigate('RateUser', { dealId: item.id })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: theme.accentSoft }}>
                    <Text style={{ color: theme.accentDeep, fontFamily: fonts.ar }}>{ar.listing.rate}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={isLoading ? (
          <RowListSkeleton count={4} />
        ) : (
          <Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar }}>لا توجد صفقات بعد</Text>
        )}
      />
    </View>
  );
}
