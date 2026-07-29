// Dedicated search tab. The browse feed no longer carries a search bar —
// search lives here, reached from the bottom tab (which replaced Favorites).
// A focused text field over a paginated results list (same Listings.browse
// query + ListingCard the feed uses, keyed only on the query string).

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { IconSearch, IconClose, IconBell } from '../../components/icons';
import { ListingCard } from '../../components/ListingCard';
import { Listings } from '../../api/endpoints';
import { ar } from '../../i18n/ar';
import { useSaveSearch } from '../../lib/useSaveSearch';

const PAGE_SIZE = 15;

export default function SearchScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const { save: saveSearch, isPending: savingSearch } = useSaveSearch();

  // Debounce so we don't fire a request on every Arabic IME keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const enabled = q.length >= 1;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['search', q],
    queryFn: ({ pageParam = 0 }) => Listings.browse({ q, limit: PAGE_SIZE, offset: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE),
    enabled,
  });
  const items = useMemo(() => data?.pages.flat() ?? [], [data]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 14 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
          backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11,
          borderWidth: 1, borderColor: theme.line,
        }}>
          <IconSearch size={18} color={theme.subtle} sw={1.7} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={ar.browse.search}
            placeholderTextColor={theme.subtle}
            autoFocus
            returnKeyType="search"
            style={{ flex: 1, fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right', padding: 0 }}
          />
          {text ? (
            <TouchableOpacity onPress={() => setText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <IconClose size={16} color={theme.subtle} sw={1.7} />
            </TouchableOpacity>
          ) : null}
        </View>
        {/* Once there's a query, let the user save it as an alert: they'll get
            a push when a new listing matches this search. */}
        {enabled ? (
          <TouchableOpacity
            onPress={() => saveSearch({ q })}
            disabled={savingSearch}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
              marginTop: 10, paddingVertical: 10, borderRadius: radius.lg,
              borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.accentSoft,
              opacity: savingSearch ? 0.6 : 1,
            }}
          >
            <IconBell size={15} color={theme.accent} sw={1.8} />
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accent, fontWeight: '600' }}>
              نبّهني عند إضافة إعلان مطابق
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
        )}
        onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={isFetchingNextPage ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : null}
        ListEmptyComponent={
          <View style={{ padding: 48, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
              {!enabled ? 'ابحث عن موديل، ماركة، أو مواصفات' : (isLoading ? '' : ar.browse.none)}
            </Text>
          </View>
        }
      />
    </View>
  );
}
