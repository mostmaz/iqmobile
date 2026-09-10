// Search — typed, then narrowed.
//
// It used to be filter-ONLY: pick a brand, then an exact catalogue device, no
// free-typing, on the argument that identical device names make results
// match. That argument holds for the FILTERS and it is why they are still
// here — but it cost the buyer the one thing they arrive knowing how to do,
// which is type the name of the phone they want. The server folds `q` through
// the same Arabic/Latin vocabulary the catalogue uses (see savedSearches.norm),
// so «ايفون ١٣» and "iPhone 13" reach the same listings.
//
// So: a query on top, the brand/device/sort controls behind «فلترة», and the
// «ما لقيت جهازك؟» invitation pinned above the results — because a thin
// result list is the moment posting a request is worth more than another
// search (design 8c).

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { IconClose, IconBell, IconChevronDown, IconSearch, IconFilter, IconChevronRight } from '../../components/icons';
import { RequestInviteCard, RequestInviteFooter } from '../../components/RequestInviteCard';
import { useRequestHub } from '../../lib/requestHub';
import { invitePitch, resultsCountAr } from '../../lib/requestPulse';
import { Pill } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { ListingListSkeleton } from '../../components/Skeleton';
import { Listings, Brands, type BrandRow, type BrowseSort } from '../../api/endpoints';
import { SortPills } from '../../components/SortPills';
import { DevicePickerModal } from '../../components/DevicePickerModal';
import { useSaveSearch } from '../../lib/useSaveSearch';
import { ar } from '../../i18n/ar';

const PAGE_SIZE = 15;

/**
 * At or below this many settled results, the search has failed the buyer
 * enough to be worth offering the request instead. One page is fifteen; five
 * is "I can see all of them and none is it".
 */
const THIN_RESULTS = 5;

export default function SearchScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const brandRailRef = useRef<ScrollView>(null);
  const { pulse, openCompose } = useRequestHub();
  // Seeded from the Browse header's field, or from a saved search's deep
  // link. `draft` is what is being typed; `q` is what has been submitted —
  // separate, or every keystroke would fire a query and the list would
  // flicker through six wrong answers on the way to the right one.
  const [draft, setDraft] = useState<string>(route?.params?.q ?? '');
  const [q, setQ] = useState<string>(route?.params?.q ?? '');
  const [brand, setBrand] = useState<string | null>(route?.params?.brand ?? null);
  const [model, setModel] = useState(route?.params?.model ?? '');
  // The filters open by default only when there is nothing to filter YET.
  // Arriving with a query, the results are the answer and the controls are a
  // wall in front of them; arriving empty, the brand rail IS the search.
  const [showFilters, setShowFilters] = useState(!(route?.params?.q));
  // undefined = the server's default order. Kept across a brand change: a
  // buyer who asked for cheapest-first means it for the next brand too.
  const [sort, setSort] = useState<BrowseSort | undefined>(undefined);
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

  // Results load once there is a query OR a brand. Either alone is a real
  // search; before either there is nothing to ask the server.
  const enabled = !!brand || !!q;
  const {
    data, isLoading, isError, error, refetch, isFetching,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['search', q, brand, model, sort ?? 'new'],
    queryFn: ({ pageParam = 0 }) =>
      Listings.browse({
        ...(q ? { q } : {}), ...(brand ? { brand } : {}),
        ...(model ? { model } : {}), ...(sort ? { sort } : {}),
        limit: PAGE_SIZE, offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE),
    enabled,
  });
  const items = useMemo(() => data?.pages.flat() ?? [], [data]);

  const resultsLabel = resultsCountAr(items.length, !!hasNextPage);

  // "Thin" is the whole trigger for the request invitation: a settled list
  // with no further page and few enough rows that the buyer has plainly not
  // found what they came for.
  const thin = enabled && !isLoading && !hasNextPage && items.length <= THIN_RESULTS;
  const hasFilters = !!brand || !!model || !!sort;

  function pickBrand(b: string) {
    // Switching brand invalidates the chosen model (models are brand-specific).
    if (b === brand) { setBrand(null); setModel(''); return; }
    setBrand(b);
    setModel('');
  }

  const submit = (text: string) => {
    const term = text.trim();
    setQ(term);
    // A submitted query answers the question the filters were asking, so it
    // folds them away. Clearing back to nothing reopens them, because an
    // empty search screen with no controls is a dead end.
    setShowFilters(!term && !brand);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 14 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        {/* The query, and a way back to the feed it came from. */}
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {navigation.canGoBack() ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              accessibilityRole="button" accessibilityLabel="رجوع"
              style={{
                width: 44, height: 44, flexShrink: 0, borderRadius: radius.xl,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <IconChevronRight size={19} color={theme.ink} sw={2} />
            </TouchableOpacity>
          ) : null}
          {/* Accent outline while a query is live — the field is not an empty
              box waiting for input, it is the statement the list below is
              answering, and it has to look like the thing you can change. */}
          <View style={{
            flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
            backgroundColor: theme.surface,
            borderWidth: q ? 1.5 : 1, borderColor: q ? theme.accent : theme.line,
            borderRadius: radius.xl, paddingHorizontal: 13, height: 46,
          }}>
            <IconSearch size={18} color={q ? theme.accent : theme.subtle} sw={1.8} />
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={(e) => submit(e.nativeEvent.text)}
              placeholder="دوّر على جهاز، ماركة، موديل…"
              placeholderTextColor={theme.subtle}
              returnKeyType="search"
              autoFocus={!route?.params?.q && !route?.params?.brand}
              style={{
                flex: 1, minWidth: 0, textAlign: 'right',
                fontFamily: q ? fonts.arBold : fonts.ar, fontSize: 13, color: theme.ink, padding: 0,
              }}
            />
            {draft ? (
              <TouchableOpacity
                onPress={() => { setDraft(''); submit(''); }}
                hitSlop={8} accessibilityRole="button" accessibilityLabel="امسح البحث"
                style={{
                  width: 18, height: 18, borderRadius: 999, backgroundColor: theme.chipBg,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <IconClose size={11} color={theme.subtle} sw={2.2} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* How many, and the way to narrow it. The count is the honest
            version of the old silence: a buyer who sees «٣ نتائج» knows to
            take the request card seriously, and one who sees «٤٠+» knows to
            keep scrolling. */}
        {enabled ? (
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: showFilters ? 12 : 2,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink }}>
              {isLoading ? 'جاري البحث…' : resultsLabel}
            </Text>
            <TouchableOpacity
              onPress={() => setShowFilters((v) => !v)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ expanded: showFilters }}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
                borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 6,
                borderWidth: 1, borderColor: showFilters ? theme.accent : theme.line,
                backgroundColor: showFilters ? theme.accentSoft : theme.surface,
              }}
            >
              <IconFilter size={13} color={showFilters ? theme.accentDeep : theme.ink} sw={1.8} />
              <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: showFilters ? theme.accentDeep : theme.ink }}>
                فلترة
              </Text>
              {hasFilters && !showFilters ? (
                <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: theme.accent }} />
              ) : null}
            </TouchableOpacity>
          </View>
        ) : null}

        {showFilters ? (
        <>
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

        {/* Order the results. Only once a brand is chosen — there is nothing
            to order before that, and an inert control above an empty list
            reads as a broken one. */}
        {enabled ? (
          <View style={{ marginTop: 12 }}>
            <SortPills value={sort} onChange={setSort} label={null} />
          </View>
        ) : null}

        {/* Save this search → alert on new matching listing */}
        {enabled ? (
          <TouchableOpacity
            // The typed query is part of the search now, so it is part of
            // what gets saved — a saved «ايفون ١٣ بغداد» that quietly dropped
            // the words would alert on every Apple listing in the country.
            onPress={() => saveSearch({ ...(q ? { q } : {}), ...(brand ? { brand } : {}), ...(model ? { model } : {}) })}
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
        </>
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
        // Pinned ABOVE the results, not below them (design 8c). A buyer with
        // three results does not scroll to the bottom to look for a way out —
        // they go back and search again — so an invitation under the last
        // card is one nobody sees.
        ListHeaderComponent={thin ? (
          <RequestInviteCard
            style={{ marginBottom: 12 }}
            onPress={() => openCompose({ brand, model: model || draft.trim() })}
          />
        ) : null}
        onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={isFetchingNextPage ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : thin && items.length > 0 ? (
          // Only when the list really is thin. Under forty results this
          // sentence is help; under a full page it is nagging.
          <RequestInviteFooter
            pitch={invitePitch(pulse?.seller_reach ?? 0)}
            onPress={() => openCompose({ brand, model: model || draft.trim() })}
          />
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
                {!enabled ? 'اكتب اسم الجهاز، أو اختر الماركة' : ar.browse.none}
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
