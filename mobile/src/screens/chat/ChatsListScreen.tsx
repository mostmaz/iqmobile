import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Header, Pill, fmtIQD } from '../../components/ui';
import { Chats } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { useAuth } from '../../auth/AuthContext';

export default function ChatsListScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [role, setRole] = useState<'all' | 'buyer' | 'seller'>('all');
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['chats', role],
    queryFn: () => Chats.list(role === 'all' ? undefined : role),
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title="المحادثات" />
      <View style={{ paddingHorizontal: 16, flexDirection: 'row-reverse', gap: 6, marginBottom: 8 }}>
        <Pill active={role === 'all'} onPress={() => setRole('all')}>الكل</Pill>
        <Pill active={role === 'buyer'} onPress={() => setRole('buyer')}>كمشتري</Pill>
        <Pill active={role === 'seller'} onPress={() => setRole('seller')}>كبائع</Pill>
      </View>
      <FlatList
        data={data || []}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => {
          const counter = user?.id === item.buyer_id ? item.seller : item.buyer;
          return (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Chat', { id: item.id })}
              style={{
                padding: 12, marginBottom: 8, borderRadius: radius.lg,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
                flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
              }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {counter?.profile_image_path ? (
                  <Image source={{ uri: fullImageUrl(counter.profile_image_path) }} style={{ width: 44, height: 44 }} />
                ) : (
                  <Text style={{ fontFamily: fonts.arBold, color: theme.subtle }}>{counter?.display_name?.[0] || '?'}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, fontWeight: '600', textAlign: 'right' }}>
                  {counter?.display_name || '...'}
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, marginTop: 2, textAlign: 'right' }} numberOfLines={1}>
                  {item.listing ? `${item.listing.brand} ${item.listing.model} · ${fmtIQD(item.listing.asking_price)} د.ع` : '—'}
                </Text>
              </View>
              {item.active_deal ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: theme.accentSoft, borderRadius: 999 }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.accentDeep }}>
                    {item.active_deal.status === 'seller_confirmed' ? 'مؤكد' : 'في تفاوض'}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar }}>لا توجد محادثات</Text>}
      />
    </View>
  );
}
