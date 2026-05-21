import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { theme, fonts } from '../../theme';
import { Btn, Header, Pill } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { Listings, type ListingStatus } from '../../api/endpoints';
import { ar } from '../../i18n/ar';
import { useAuth } from '../../auth/AuthContext';

const TABS: Array<{ key: 'all' | ListingStatus; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'active', label: ar.listing.active },
  { key: 'reserved', label: ar.listing.reserved },
  { key: 'sold', label: ar.listing.sold },
  { key: 'expired', label: ar.listing.expired },
];

export default function MyListingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<'all' | ListingStatus>('all');
  // "My listings" is per-account — for a guest there's nothing to list
  // and the server would just 401 on every focus. Gate the query off
  // so we don't spam logs and so we can show a sign-in CTA below.
  const isGuest = !user || !!user.is_guest;
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['mine', tab],
    queryFn: () => Listings.mine(tab),
    enabled: !isGuest,
  });

  // Refresh on every focus so marking a listing as sold/reserved from
  // ListingDetail reflects here without forcing a pull-to-refresh.
  useFocusEffect(useCallback(() => {
    if (!isGuest) qc.invalidateQueries({ queryKey: ['mine'] });
  }, [isGuest, qc]));

  if (isGuest) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <Header title={ar.profile.listings} onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, fontWeight: '700', color: theme.ink, textAlign: 'center' }}>
            سجّل الدخول لرؤية إعلاناتك
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'center', lineHeight: 22 }}>
            بعد التسجيل تظهر هنا كل إعلاناتك ويمكنك تعديلها أو تحديدها كمباع.
          </Text>
          <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
            <Btn kind="accent" full onPress={() => (navigation as any).getParent()?.getParent?.()?.navigate('AuthGate')}>
              تسجيل الدخول
            </Btn>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.listings} onBack={() => navigation.goBack()} />
      <View style={{ paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => <Pill key={t.key} active={tab === t.key} onPress={() => setTab(t.key)}>{t.label}</Pill>)}
      </View>
      <FlatList
        data={data || []}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />}
        ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar }}>لا توجد إعلانات</Text>}
      />
    </View>
  );
}
