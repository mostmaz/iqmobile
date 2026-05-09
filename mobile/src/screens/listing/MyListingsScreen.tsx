import React, { useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts } from '../../theme';
import { Header, Pill } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { Listings, type ListingStatus } from '../../api/endpoints';
import { ar } from '../../i18n/ar';

const TABS: Array<{ key: 'all' | ListingStatus; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'active', label: ar.listing.active },
  { key: 'reserved', label: ar.listing.reserved },
  { key: 'sold', label: ar.listing.sold },
  { key: 'expired', label: ar.listing.expired },
];

export default function MyListingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'all' | ListingStatus>('all');
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['mine', tab],
    queryFn: () => Listings.mine(tab),
  });

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
