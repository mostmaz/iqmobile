// Filter-based search: the buyer picks a brand, then an exact device from the
// same catalog the selling form uses — no free-typing. This keeps buyer
// queries and seller listings on identical device names, so the results
// actually match. Falls through to Listings.browse({ brand, model }): brand is
// an exact filter, model a LIKE on the listing's model field.

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { IconClose, IconBell, IconChevronDown } from '../../components/icons';
import { Pill } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { ListingListSkeleton } from '../../components/Skeleton';
import { Listings, Brands, type BrandRow } from '../../api/endpoints';
import { DevicePickerModal } from '../../components/DevicePickerModal';
import { useSaveSearch } from '../../lib/useSaveSearch';
import { ar } from '../../i18n/ar';

const PAGE_SIZE = 15;

export default function SearchScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const brandRailRef = useRef<ScrollView>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const { save: saveSearch, isPending: savingSearch } = useSaveSearch();

  // Brand rail — same source as the selling form + browse filter, minus the
  // "Other" catch-all (the catalog has no devices under it).
  const { data: brandRows } = useQuery({
    queryKey: ['brands'],
    queryFn: () => Brands.list(),
    staleTime: 5 * 60 * 1000,
  });
  const brands = useMemo(
    () => (brandRows || []).filter((b: BrandRow) => b.name.trim().toLowerCase() !== 'other'),
    [brandRows],
  );

  // Results load once a brand is chosen; model (if set) narrows further.
  const enabled = !!brand;
  const {
    data, isLoading, isError, error, refetch, isFetching,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['search', brand, model],
    queryFn: ({ pageParam = 0 }) =>
      Listings.browse({ brand: brand!, ...(model ? { model } : {}), limit: PAGE_SIZE, offset: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE),
    enabled,
  });
  const items = useMemo(() => data?.pages.flat() ?? [], [data]);

  function pickBrand(b: string) {
    // Switching brand invalidates the chosen model (models are brand-specific).
    if (b === brand) { setBrand(null); setModel(''); return; }
    setBrand(b);
    setModel('');
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 14 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        {/* Brand rail. row-reverse puts the first brand at the content's RIGHT
            edge, but a ScrollView opens at offset 0 — its LEFT edge — so the
            rail started on the last brands (Itel, Nubia…) instead of Apple.
            Scrolling to the end on layout lands on the first brand, same fix
            BrowseScreen already uses. */}
        <ScrollView
          ref={brandRailRef}
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}
          onContentSizeChange={() => brandRailRef.current?.scrollToEnd({ animated: false })}
        >
          {brands.map((b) => (
            <Pill key={b.name} active={brand === b.name} onPress={() => pickBrand(b.name)}>
              {b.display_ar || b.name}
            </Pill>
          ))}
        </ScrollView>

        {/* Device selector — enabled once a brand is chosen */}
        <TouchableOpacity
          onPress={() => brand && setPickerOpen(true)}
          disabled={!brand}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10,
            paddingHorizontal: 14, paddingVertical: 13, borderRadius: radius.lg,
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            opacity: brand ? 1 : 0.5,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              flex: 1, textAlign: 'right', writingDirection: model ? 'ltr' : 'rtl',
              fontFamily: model ? fonts.arBold : fonts.ar, fontSize: 14,
              color: model ? theme.ink : theme.subtle,
            }}
          >
            {model || (brand ? 'اختر الجهاز (اختياري)' : 'اختر الماركة أولاً')}
          </Text>
          {model ? (
            <TouchableOpacity onPress={() => setModel('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <IconClose size={15} color={theme.subtle} sw={1.7} />
            </TouchableOpacity>
          ) : (
            <IconChevronDown size={16} color={theme.subtle} sw={2} />
          )}
        </TouchableOpacity>

        {/* Save this search → alert on new matching listing */}
        {enabled ? (
          <TouchableOpacity
            onPress={() => saveSearch({ brand: brand!, ...(model ? { model } : {}) })}
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
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accent }}>
              احفظ البحث ونبّهني عند إعلان مطابق
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
        // Three states: no query yet → prompt; query inflight with no
        // results yet → shimmer cards (previously an empty string, which
        // made a slow search look like a dead one); settled and empty →
        // "no results".
        ListEmptyComponent={
          // A failed search used to be indistinguishable from a slow one:
          // the skeletons just stayed up. Now the error is its own state
          // with a way out, because the only previous escape was to change
          // a filter and hope.
          enabled && isError ? (
            <View style={{ padding: 40, alignItems: 'center', gap: 12 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'center' }}>
                {(error as any)?.isTimeout ? 'البحث استغرق وقتاً طويلاً' : 'تعذّر إجراء البحث'}
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', lineHeight: 20 }}>
                تحقّق من الاتصال بالإنترنت وحاول مرة أخرى.
              </Text>
              <TouchableOpacity
                onPress={() => refetch()}
                disabled={isFetching}
                activeOpacity={0.85}
                style={{
                  marginTop: 4, paddingHorizontal: 22, paddingVertical: 11,
                  borderRadius: radius.pill, backgroundColor: theme.ink,
                  opacity: isFetching ? 0.6 : 1,
                }}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk }}>
                  {isFetching ? 'جاري المحاولة…' : 'إعادة المحاولة'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : enabled && isLoading ? (
            <ListingListSkeleton count={5} />
          ) : (
            <View style={{ padding: 48, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
                {!enabled ? 'اختر الماركة ثم الجهاز للبحث' : ar.browse.none}
              </Text>
            </View>
          )
        }
      />

      {brand ? (
        <DevicePickerModal
          visible={pickerOpen}
          brand={brand}
          value={model}
          onClose={() => setPickerOpen(false)}
          onSelect={(m) => { setModel(m); setPickerOpen(false); }}
        />
      ) : null}
    </View>
  );
}
