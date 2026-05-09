import React from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts } from '../../theme';
import { Header } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { Listings } from '../../api/endpoints';
import { ar } from '../../i18n/ar';

export default function SavedScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['saved'],
    queryFn: () => Listings.saved(),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.saved} />
      <FlatList
        data={data || []}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            saved
            onPress={() => navigation.navigate('ListingDetail', { id: item.id })}
            onToggleSave={async () => { await Listings.unsave(item.id); qc.invalidateQueries({ queryKey: ['saved'] }); }}
          />
        )}
        ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar }}>لا توجد مفضلات</Text>}
      />
    </View>
  );
}
