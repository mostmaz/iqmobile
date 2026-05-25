import React, { useCallback, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { Img } from '../../components/Img';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { theme, fonts, radius } from '../../theme';
import { Header, fmtIQD } from '../../components/ui';
import { Chats } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { useAuth } from '../../auth/AuthContext';
import { subscribeSSE } from '../../sse/client';
import { ar } from '../../i18n/ar';

export default function ChatsListScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  // Two modes:
  //   - Filtered: arrived from a seller's own ListingDetail "view buyer
  //     chats" CTA → only chats for that listing.
  //   - Global: from the Chats tab → every chat the user has.
  const listingId: number | undefined = route?.params?.listing_id;

  // Chat is open to guests now. Their auto-provisioned guest user row
  // owns any chats they start; the inbox just lists them like any other
  // user's chats. First-launch guests with no chats yet see the empty
  // state copy from ar.chat.empty.
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['chats', listingId ?? 'all'],
    queryFn: () => (listingId ? Chats.listForListing(listingId) : Chats.list()),
    enabled: !!user,  // need any auth token (even a guest one) to call /chats
  });

  // Refetch on every focus so a message sent in another tab / from a push
  // tap reflects the moment the user comes back here.
  useFocusEffect(useCallback(() => {
    if (user) qc.invalidateQueries({ queryKey: ['chats'] });
  }, [user, qc]));

  // Live updates — SSE `chat.message` invalidates the inbox so the list
  // re-sorts the new conversation to the top without a manual refresh.
  useEffect(() => {
    const unsub = subscribeSSE((event) => {
      if (event === 'chat.message') qc.invalidateQueries({ queryKey: ['chats'] });
    });
    return () => { unsub(); };
  }, [qc]);

  // When the seller arrives via "view buyer chats for THIS listing",
  // surface the listing they're filtering on as a small chip so the
  // context is obvious. Derive label from the first row's listing
  // summary — all rows share the same listing_id by definition.
  const filterChip = listingId && data && data.length > 0 && data[0].listing
    ? `إعلان: ${data[0].listing.brand} ${data[0].listing.model}`
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header
        title={ar.tabs.chats}
        onBack={listingId ? () => navigation.goBack() : undefined}
      />
      {filterChip ? (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <View style={{
            alignSelf: 'flex-start',
            backgroundColor: theme.accentSoft,
            borderRadius: 999,
            paddingHorizontal: 12, paddingVertical: 6,
          }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.accentDeep }}>{filterChip}</Text>
          </View>
        </View>
      ) : null}
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
                  <Img source={{ uri: fullImageUrl(counter.profile_image_path) }} style={{ width: 44, height: 44 }} />
                ) : (
                  <Text style={{ fontFamily: fonts.arBold, color: theme.subtle }}>{counter?.display_name?.[0] || '?'}</Text>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, fontWeight: '600', textAlign: 'right' }}>
                  {counter?.display_name || '...'}
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, marginTop: 2, textAlign: 'right' }} numberOfLines={1}>
                  {item.listing ? `${item.listing.brand} ${item.listing.model} · ${fmtIQD(item.listing.asking_price)} د.ع` : '—'}
                </Text>
              </View>
              {/* Deal-status badge hidden for v1 — the propose-price /
                  confirm flow is gated off (DEAL_FLOW_ENABLED in
                  ChatScreen). When the flow returns, restore the
                  badge that lived here previously. */}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar, lineHeight: 22 }}>
            {listingId ? ar.chat.emptyForListing : ar.chat.empty}
          </Text>
        }
      />
    </View>
  );
}
