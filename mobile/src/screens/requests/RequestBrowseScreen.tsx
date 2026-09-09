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
import { Img } from '../../components/Img';
import { fullImageUrl } from '../../api/upload';
import { ListingListSkeleton } from '../../components/Skeleton';
import { LoadFailed } from '../../components/LoadFailed';
import { BrandListModal } from '../../components/BrandListModal';
import { RequestComposeSheet } from '../../components/RequestComposeSheet';
import { Listings, Brands, type BrandRow, type BrowseSort, type Condition } from '../../api/endpoints';
import { SortPills } from '../../components/SortPills';
import { CONDITIONS } from '../../lib/conditions';
import { ar } from '../../i18n/ar';
import { orderBrandsForFunnel, brandLabel, type FunnelBrand } from '../../lib/requestFunnel';
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
  // Kept across a model change on purpose, the way SearchScreen keeps its
  // sort: a buyer who asked for cheapest-first means it for the next device
  // too, and re-picking it every time is the annoyance the control removes.
  const [sort, setSort] = useState<BrowseSort | undefined>(undefined);
  const [condition, setCondition] = useState<Condition | null>(null);
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
    queryKey: ['request-funnel', brand, model, WINDOW_DAYS, sort ?? 'new', condition ?? 'any'],
    queryFn: ({ pageParam = 0 }) => Listings.browse({
      brand: brand!, model: model!, model_exact: true,
      max_age_days: WINDOW_DAYS, available_only: true,
      ...(sort ? { sort } : {}),
      ...(condition ? { condition } : {}),
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
      {/* Brand grid, 2-up. Cards rather than a rail so the logo has somewhere
          to live and the tap target is a whole card.
          
          Once a brand is chosen the grid collapses to a single-row rail of
          pills: the cards are ~96pt tall, and three rows of them would push
          the model chips and every listing below the fold on a 390pt screen.
          The grid is for choosing; the rail is for changing your mind. */}
      {brand ? (
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
      ) : (
        <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }}>
          {head.map((b) => <BrandCard key={b.name} brand={b} onPress={() => pickBrand(b.name)} />)}
          <BrandCard more onPress={() => setMoreOpen(true)} />
        </View>
      )}

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

      {/* Order and condition, once there is a list to apply them to. An
          inert control above nothing reads as a broken one — the same reason
          SearchScreen gates its sort on a chosen brand. */}
      {listEnabled ? (
        <View style={{ gap: 4 }}>
          <SortPills value={sort} onChange={setSort} label={null} />

          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}
          >
            <Pill active={!condition} onPress={() => setCondition(null)}>كل الحالات</Pill>
            {/* All FOUR conditions, from the shared taxonomy. Offering three
                is what once made a مصلح device postable but unfindable —
                see lib/conditions.ts. */}
            {CONDITIONS.map((c) => (
              <Pill
                key={c}
                active={condition === c}
                onPress={() => setCondition(condition === c ? null : c)}
              >
                {(ar.listing as any)[c] || c}
              </Pill>
            ))}
          </ScrollView>

          <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
            {/* «يبدأ من» comes from the UNFILTERED top-models row, so it is
                only true while no condition is selected. Showing it beside a
                filtered list would quote a price the list does not contain. */}
            {!condition && items.length > 0
              && (topModels.data?.find((m) => m.model === model)?.min_price ?? null) != null
              ? `المعروض خلال ${WINDOW_DAYS} يوماً · يبدأ من ${fmtIQD(topModels.data!.find((m) => m.model === model)!.min_price!)} د.ع`
              : `المعروض خلال ${WINDOW_DAYS} يوماً`}
          </Text>
        </View>
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
                  {condition ? `لا يوجد ${model} ${(ar.listing as any)[condition]} معروض حالياً` : `لا يوجد ${model} معروض حالياً`}
                </Text>
                {/* A filter that empties the list must say so, or the buyer
                    reads "this device does not exist here" and leaves. */}
                <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', lineHeight: 20 }}>
                  {condition
                    ? 'جرّب حالة أخرى، أو اطلبه وتصلك عروض المتاجر.'
                    : `اطلبه — يصل طلبك للمتاجر التي تبيع ${brand} وترد عليك بعروضها.`}
                </Text>
                {condition ? (
                  <TouchableOpacity onPress={() => setCondition(null)} hitSlop={8} style={{ marginTop: 4 }}>
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accent }}>
                      اعرض كل الحالات
                    </Text>
                  </TouchableOpacity>
                ) : null}
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
        // The funnel IS the place that shows them, so selecting is enough.
        onSeeAvailable={(b, m) => { setBrand(b); setModel(m); }}
        onCreated={(created) => {
          setComposeOpen(false);
          navigation.navigate('RequestDetail', { id: created.id });
        }}
      />
    </View>
  );
}

/**
 * One brand in the chooser grid.
 *
 * The logo is optional and always will be: the app ships no brand images —
 * they are manufacturer trademarks an operator uploads — so a brand without
 * one must still look deliberate. The fallback is the brand's initial in the
 * same tile, not an empty box or a broken-image glyph.
 */
function BrandCard({ brand, more, onPress }: {
  brand?: FunnelBrand;
  /** The «أخرى» card — the rest of the brands, not the catalogue's "Other". */
  more?: boolean;
  onPress: () => void;
}) {
  const label = more ? 'أخرى' : brandLabel(brand!);
  const logo = brand?.logo_path ? fullImageUrl(brand.logo_path) : null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      // Two per row with a 10pt gutter inside 16pt page padding.
      style={{
        width: '48%', backgroundColor: theme.surface, borderRadius: radius.lg,
        borderWidth: 1, borderColor: theme.line, padding: 10, gap: 8,
      }}
    >
      <View style={{
        height: 64, borderRadius: radius.md, backgroundColor: theme.chipBg,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {logo ? (
          <Img source={{ uri: logo }} contentFit="contain" style={{ width: '78%', height: '72%' }} />
        ) : (
          <Text style={{ fontFamily: fonts.ltrBold, fontSize: 22, color: theme.subtle }}>
            {more ? '⋯' : (brand!.name || '?').trim().charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
          {label}
        </Text>
        {!more && (brand!.count ?? 0) > 0 ? (
          <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: theme.subtle, writingDirection: 'ltr' }}>
            {brand!.count}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
