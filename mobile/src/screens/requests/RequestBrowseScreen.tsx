// اطلب جهاز — but look first.
//
// This tab used to open on a board of other people's requests and a form.
// Most requests are for phones that are already for sale, so it now opens
// on a funnel — brand → that brand's most-listed models → those models'
// listings from the last 60 days — and the request form waits behind one
// floating button, pre-filled with whatever the buyer just looked at.
//
// It is SearchScreen's shape with two substitutions: the model step is
// /listings/top-models (ranked by real supply in the same window the next
// step shows, so a chip never opens onto nothing) instead of the catalogue
// picker; and the listing step asks for an exact-normalised model match
// instead of LIKE, so a chip for "iPhone 13" does not return every Pro Max.
//
// The old three-tab board is one tap away behind «طلباتي» in the header and
// is otherwise untouched.

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Btn, Header, Pill, fmtIQD } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { ListingListSkeleton } from '../../components/Skeleton';
import { LoadFailed } from '../../components/LoadFailed';
import { BrandListModal } from '../../components/BrandListModal';
import { RequestComposeSheet } from '../../components/RequestComposeSheet';
import { Listings, Brands, type BrandRow } from '../../api/endpoints';
import { orderBrandsForFunnel, brandLabel } from '../../lib/requestFunnel';
import { useTabBarClearance } from '../../lib/tabBarClearance';
import { arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';

const PAGE_SIZE = 15;
/** The window for both the ranking and the list — one number, on purpose. */
const WINDOW_DAYS = 60;

export default function RequestBrowseScreen({ navigation }: any) {
  const { user } = useAuth();
  const isReal = !!user && !(user as any).is_guest;
  const tabClearance = useTabBarClearance();
  const railRef = useRef<ScrollView>(null);

  const [brand, setBrand] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  // ── step 1: brands ──────────────────────────────────────────────────
  const { data: brandRows } = useQuery({
    queryKey: ['brands'],
    queryFn: () => Brands.list(),
    staleTime: 5 * 60 * 1000,
  });
  const { head, rest } = useMemo(() => orderBrandsForFunnel(brandRows as BrandRow[] | undefined), [brandRows]);
  // A brand picked from «أخرى» shows as a seventh, active pill — otherwise
  // the selection would be invisible and the rail would look unselected.
  const pickedFromRest = brand && !head.some((b) => b.name === brand)
    ? rest.find((b) => b.name === brand) : null;

  function pickBrand(name: string) {
    // Switching brand invalidates the model — models are brand-specific.
    // Tapping the active brand again clears it, the SearchScreen toggle.
    if (name === brand) { setBrand(null); setModel(null); return; }
    setBrand(name);
    setModel(null);
  }

  // ── step 2: that brand's most-listed models ─────────────────────────
  const topModels = useQuery({
    queryKey: ['top-models', brand, WINDOW_DAYS],
    queryFn: () => Listings.topModels(brand!, WINDOW_DAYS),
    enabled: !!brand,
    staleTime: 60_000,
  });

  // ── step 3: that model's listings, same window ──────────────────────
  const listEnabled = !!brand && !!model;
  const list = useInfiniteQuery({
    queryKey: ['request-funnel', brand, model, WINDOW_DAYS],
    queryFn: ({ pageParam = 0 }) => Listings.browse({
      brand: brand!, model: model!, model_exact: true,
      max_age_days: WINDOW_DAYS, sort: 'new', available_only: true,
      limit: PAGE_SIZE, offset: pageParam as number,
    }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length < PAGE_SIZE ? undefined : all.length * PAGE_SIZE),
    enabled: listEnabled,
  });
  const items = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);

  // ── the way out ─────────────────────────────────────────────────────
  function openCompose() {
    if (!isReal) {
      (navigation as any).getParent()?.getParent?.()?.navigate('AuthGate')
        ?? navigation.navigate('AuthGate' as never);
      return;
    }
    setComposeOpen(true);
  }

  const header = (
    <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 12 }}>
      {/* Brands. Six in the owner's order, then «أخرى». Scrolled to the end
          on layout so RTL lands on the first pill — the fix Browse and
          Search both carry. */}
      <ScrollView
        ref={railRef}
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}
        onContentSizeChange={() => railRef.current?.scrollToEnd({ animated: false })}
      >
        {head.map((b) => (
          <Pill key={b.name} active={brand === b.name} onPress={() => pickBrand(b.name)}>
            {brandLabel(b)}
          </Pill>
        ))}
        {pickedFromRest ? (
          <Pill active onPress={() => pickBrand(pickedFromRest.name)}>{brandLabel(pickedFromRest)}</Pill>
        ) : null}
        <Pill active={false} onPress={() => setMoreOpen(true)}>أخرى…</Pill>
      </ScrollView>

      {/* Models. Real supply, real counts. */}
      {brand ? (
        topModels.isLoading ? (
          <View style={{ flexDirection: 'row-reverse', gap: 6 }}>
            {[96, 72, 84].map((w, i) => (
              <View key={i} style={{ width: w, height: 34, borderRadius: radius.pill, backgroundColor: theme.chipBg }} />
            ))}
          </View>
        ) : topModels.isError ? (
          <LoadFailed compact error={topModels.error} retrying={topModels.isFetching} onRetry={() => topModels.refetch()} />
        ) : (topModels.data?.length ?? 0) === 0 ? (
          <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 20 }}>
            لا توجد إعلانات لهذه الماركة في آخر {WINDOW_DAYS} يوماً. اطلبه وتصلك عروض المتاجر.
          </Text>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle, textAlign: 'right' }}>
              الأكثر عرضاً خلال {WINDOW_DAYS} يوماً
            </Text>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
              {topModels.data!.map((m) => (
                <Pill
                  key={m.model_key}
                  active={model === m.model}
                  count={m.count}
                  onPress={() => setModel(model === m.model ? null : m.model)}
                >
                  {m.model}
                </Pill>
              ))}
            </View>
          </View>
        )
      ) : null}

      {listEnabled ? (
        <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right' }}>
          {items.length > 0 && (topModels.data?.find((m) => m.model === model)?.min_price ?? null) != null
            ? `المعروض خلال ${WINDOW_DAYS} يوماً · يبدأ من ${fmtIQD(topModels.data!.find((m) => m.model === model)!.min_price!)} د.ع`
            : `المعروض خلال ${WINDOW_DAYS} يوماً`}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header
        title="اطلب جهاز"
        eyebrow="شوف الموجود أولاً"
        right={(
          <TouchableOpacity
            onPress={() => navigation.navigate('RequestBoard')}
            hitSlop={8}
            accessibilityRole="button"
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink }}>طلباتي</Text>
          </TouchableOpacity>
        )}
      />

      <FlatList
        data={listEnabled ? items : []}
        keyExtractor={(it) => String(it.id)}
        ListHeaderComponent={header}
        // Room for the floating button AND the tab bar, from the hook rather
        // than the hardcoded 96 the old board used.
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabClearance + 64 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
        )}
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={list.isFetchingNextPage ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : null}
        ListEmptyComponent={
          !brand ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
                اختر الماركة لترى الأجهزة المعروضة الآن — وإن لم تجد ما تريد، اطلبه.
              </Text>
            </View>
          ) : !model ? null
            : list.isError ? (
              <LoadFailed error={list.error} retrying={list.isFetching} onRetry={() => list.refetch()} />
            ) : list.isLoading ? (
              <ListingListSkeleton count={4} />
            ) : (
              <View style={{ padding: 40, alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'center' }}>
                  لا يوجد {model} معروض حالياً
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', lineHeight: 20 }}>
                  اطلبه — يصل طلبك للمتاجر التي تبيع {brand} وترد عليك بعروضها.
                </Text>
              </View>
            )
        }
      />

      {/* The floating way out. bottom:16 and no insets.bottom on purpose —
          this screen's viewport already ends above the tab bar, and adding
          the inset double-counts the home indicator. See RequestsScreen. */}
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
        <Btn kind="primary" full onPress={openCompose}>اطلب جهاز آخر</Btn>
      </View>

      <BrandListModal
        visible={moreOpen}
        title="ماركات أخرى"
        brands={rest.map((b) => ({ name: b.name, label: brandLabel(b), count: b.count ?? undefined }))}
        value={pickedFromRest?.name ?? null}
        onClose={() => setMoreOpen(false)}
        onSelect={(name) => { setMoreOpen(false); if (name) pickBrand(name); }}
      />

      <RequestComposeSheet
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        defaultGovAr={user?.governorate ? arOf(user.governorate) : ''}
        initialBrand={brand}
        initialModel={model ?? ''}
        onCreated={(created) => {
          setComposeOpen(false);
          navigation.navigate('RequestDetail', { id: created.id });
        }}
      />
    </View>
  );
}
