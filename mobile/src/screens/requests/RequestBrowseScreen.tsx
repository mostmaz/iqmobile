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

import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, Header, Pill, fmtIQD } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { Img } from '../../components/Img';
import { fullImageUrl } from '../../api/upload';
import { ListingListSkeleton } from '../../components/Skeleton';
import { LoadFailed } from '../../components/LoadFailed';
import { BrandListModal } from '../../components/BrandListModal';
import { RequestComposeSheet } from '../../components/RequestComposeSheet';
import { Listings, Brands, type BrandRow, type BrowseSort, type Condition, type TopModel } from '../../api/endpoints';
import { SortPills } from '../../components/SortPills';
import { CONDITIONS } from '../../lib/conditions';
import { ar } from '../../i18n/ar';
import { orderBrandsForFunnel, brandLabel, type FunnelBrand } from '../../lib/requestFunnel';
import { bundledBrandLogo } from '../../lib/brandLogos';
import { formatPriceRange } from '../../lib/priceRange';
import { useTabBarClearance } from '../../lib/tabBarClearance';
import { arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';

const PAGE_SIZE = 15;
// The window for both the ranking and the list — one number, on purpose.
//
// A year, not two months. Which devices a brand is known for is a slow fact,
// and a 60-day ranking let one busy fortnight decide the top ten. The list
// under it uses the SAME number, which is the guarantee the whole funnel
// rests on: a device card can never open onto an empty list. Every listing
// shown is still active or reserved — sold and expired are excluded by the
// endpoint — so a wider window means more stock, not stale stock.
const WINDOW_DAYS = 365;
const WINDOW_AR = 'سنة';
/**
 * Card corner from the Claude Design prototype. Deliberately off the shared
 * `radius` scale, whose largest step is 16: the funnel's chooser cards are
 * the only place in the app that uses it, and rounding them to 16 to stay on
 * the scale is what made the shipped screen read as a different design.
 */
const CARD_RADIUS = 18;

export default function RequestBrowseScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const isReal = !!user && !(user as any).is_guest;
  const tabClearance = useTabBarClearance();

  // «شوف المعروض الآن» in the compose sheet arrives here already knowing
  // both, and walking the buyer back through two steps they just completed
  // is what made the link feel like a dead end rather than an answer.
  const [brand, setBrand] = useState<string | null>(route?.params?.brand ?? null);
  const [model, setModel] = useState<string | null>(route?.params?.model ?? null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Kept across a model change on purpose, the way SearchScreen keeps its
  // sort: a buyer who asked for cheapest-first means it for the next device
  // too, and re-picking it every time is the annoyance the control removes.
  const [sort, setSort] = useState<BrowseSort | undefined>(undefined);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const conditionRailRef = React.useRef<ScrollView>(null);

  // ── step 1: brands ──────────────────────────────────────────────────
  const { data: brandRows } = useQuery({
    queryKey: ['brands'],
    queryFn: () => Brands.list(),
    staleTime: 5 * 60 * 1000,
  });
  const { head, rest } = useMemo(() => orderBrandsForFunnel(brandRows as BrandRow[] | undefined), [brandRows]);
  const pickedFromRest = brand && !head.some((b) => b.name === brand)
    ? rest.find((b) => b.name === brand) : null;
  /** The chosen brand's row, wherever it came from — for the picked summary. */
  const brandRow = pickedFromRest ?? head.find((b) => b.name === brand) ?? null;

  function pickBrand(name: string) {
    setBrand(name);
    setModel(null);
  }

  // ── one step at a time ──────────────────────────────────────────────
  //
  // Brands, then that brand's devices, then that device's listings. Each
  // step REPLACES the one before it rather than stacking under it: three
  // rows of brand cards plus five rows of device cards is ~1100pt of chooser,
  // and the listings a buyer asked for would open below all of it.
  //
  // The header's own back arrow walks it back, so there is exactly one way
  // out of a step and it sits where every other screen in the app puts it.
  const step: 'brand' | 'model' | 'list' = !brand ? 'brand' : !model ? 'model' : 'list';
  function goBack() {
    if (model) { setModel(null); return; }
    if (brand) { setBrand(null); return; }
  }

  // ── step 2: that brand's most-listed models ─────────────────────────
  // The condition filter applies HERE as well as to the listings, which is
  // the whole point of putting it on the device step: «مستعمل» should answer
  // "which devices have used stock", not just filter a list the buyer has
  // already committed to. The server filters rows before grouping, so a
  // card's count, price range and photo all describe the filtered set.
  const topModels = useQuery({
    queryKey: ['top-models', brand, WINDOW_DAYS, condition ?? 'any'],
    queryFn: () => Listings.topModels(brand!, WINDOW_DAYS, condition),
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

  /**
   * One control, two steps.
   *
   * Declared once and rendered on both the device grid and the listing list
   * so the selection survives the tap between them — a buyer who filtered to
   * «مستعمل» to find the device meant it for the listings too, and a filter
   * that silently resets on the next screen is the kind of thing people
   * blame themselves for.
   */
  const conditionRail = (
    <ScrollView
      ref={conditionRailRef}
      horizontal showsHorizontalScrollIndicator={false}
      // A row-reverse content box inside an LTR scroller puts the FIRST pill
      // at the far right of the content, and the scroller opens at x=0 —
      // the left. So «كل الحالات» sat off-screen and the rail looked like it
      // started at «مجدد». scrollToEnd lands on the real beginning; it must
      // re-run on every content change, because the pill set is the same but
      // its width is not once a filter is active.
      onContentSizeChange={() => conditionRailRef.current?.scrollToEnd({ animated: false })}
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
  );

  const header = (
    <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 12 }}>
      {/* The one line that explains the grid. It has to sit above the cards:
          below them it lands under the floating button on a 390pt screen,
          where an instruction nobody scrolls to is an instruction nobody
          reads. */}
      {step === 'brand' ? (
        <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 13, lineHeight: 20, textAlign: 'right' }}>
          اختر الماركة لترى الأجهزة المعروضة الآن — وإن لم تجد ما تريد، اطلبه.
        </Text>
      ) : null}

      {/* Step 1 — brands. The owner's order, then «أخرى» for the rest. */}
      {step === 'brand' ? (
        <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }}>
          {head.map((b) => <BrandCard key={b.name} brand={b} onPress={() => pickBrand(b.name)} />)}
          <BrandCard more onPress={() => setMoreOpen(true)} />
        </View>
      ) : null}

      {/* Step 2 — that brand's most-listed devices. Real supply, real counts.
          The filter sits ABOVE the grid it filters, where the numbers on the
          cards below it are the answer. */}
      {step === 'model' ? conditionRail : null}
      {step === 'model' ? (
        topModels.isLoading ? (
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ width: '48%', height: 152, borderRadius: CARD_RADIUS, backgroundColor: theme.surface }} />
            ))}
          </View>
        ) : topModels.isError ? (
          <LoadFailed compact error={topModels.error} retrying={topModels.isFetching} onRetry={() => topModels.refetch()} />
        ) : (topModels.data?.length ?? 0) === 0 ? (
          // Two different dead ends, and telling them apart is the difference
          // between "this brand has nothing" and "nothing MATCHES" — only one
          // of those is fixed by clearing a filter the buyer set.
          condition ? (
            <View style={{ gap: 8, alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 20 }}>
                لا توجد أجهزة {(ar.listing as any)[condition] || condition} من {brandRow ? brandLabel(brandRow) : brand} خلال {WINDOW_AR}.
              </Text>
              <TouchableOpacity onPress={() => setCondition(null)} accessibilityRole="button" hitSlop={8}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accent }}>
                  اعرض كل الحالات
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 20 }}>
              لا توجد إعلانات لهذه الماركة في آخر {WINDOW_AR}. اطلبه وتصلك عروض المتاجر.
            </Text>
          )
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle, textAlign: 'right' }}>
              {condition
                ? `الأكثر عرضاً خلال ${WINDOW_AR} · ${(ar.listing as any)[condition] || condition}`
                : `الأكثر عرضاً خلال ${WINDOW_AR}`}
            </Text>
            {/* 2-up cards with the device's own photo, not text chips. The
                photo is the newest listing's first image, which the ranking
                endpoint already returns — a buyer recognises the phone by
                sight long before they parse "Galaxy S24 Ultra". */}
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }}>
              {topModels.data!.map((m) => (
                <ModelCard
                  key={m.model_key}
                  model={m}
                  active={false}
                  onPress={() => setModel(m.model)}
                />
              ))}
            </View>
          </View>
        )
      ) : null}

      {/* Sort only appears once there is a list to apply it to — an inert
          control above nothing reads as a broken one, the same reason
          SearchScreen gates its sort on a chosen brand. Condition is
          different: it is meaningful on the device grid too, so the rail
          above renders on both steps and this one is the same element. */}
      {listEnabled ? (
        <View style={{ gap: 4 }}>
          <SortPills value={sort} onChange={setSort} label={null} />

          {conditionRail}

          <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
            {/* «يبدأ من» is safe beside a filtered list now: the top-models
                row it reads is fetched with the SAME condition, so the two
                describe one set. It used to be hidden whenever a condition
                was picked, because the row was unfiltered and would quote a
                price the list below did not contain. */}
            {items.length > 0
              && (topModels.data?.find((m) => m.model === model)?.min_price ?? null) != null
              ? `المعروض خلال ${WINDOW_AR} · يبدأ من ${fmtIQD(topModels.data!.find((m) => m.model === model)!.min_price!)} د.ع`
              : `المعروض خلال ${WINDOW_AR}`}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header
        // The header carries the identity of the step you are on, and is the
        // ONLY place that carries it. A summary card under a header that
        // already says «Samsung / Galaxy S25 Ultra» prints the same two lines
        // twice.
        title={step === 'list' ? model! : step === 'model' ? brandLabel(brandRow ?? { name: brand! }) : 'اطلب جهاز'}
        eyebrow={step === 'brand' ? 'شوف الموجود أولاً'
          : step === 'model' ? 'اختر الجهاز'
          : brandLabel(brandRow ?? { name: brand! })}
        // Back walks the funnel back a step. It takes the slot the iQ badge
        // normally holds — leading edge, beside the title.
        onBack={step === 'brand' ? undefined : goBack}
        // «الطلبات» sits on the TITLE row, not the nav row. Up there it was
        // a lone pill against an empty band, reading as a second back
        // button; level with the title it reads as the other thing this
        // screen does. It points at the tab root now that the feed IS the
        // tab root — popping back rather than pushing a second copy.
        titleRight={(
          <TouchableOpacity
            onPress={() => navigation.navigate('RequestsHome')}
            hitSlop={8}
            accessibilityRole="button"
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink }}>الطلبات</Text>
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
          step !== 'list' ? null
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
 * Where a brand's mark comes from, in order.
 *
 * An operator's upload wins, then the mark bundled with the app, then
 * nothing — and "nothing" is a rendered initial, never a broken-image box.
 */
function brandLogoSource(b: FunnelBrand): { uri: string } | number | null {
  if (b.logo_path) return { uri: fullImageUrl(b.logo_path) };
  return bundledBrandLogo(b.name);
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
  // Uploaded logo first, bundled mark second, initial last.
  const logo = brand ? brandLogoSource(brand) : null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      // Two per row with a 10pt gutter inside 16pt page padding. «أخرى» is
      // dashed and filled with the chip colour: it opens a list, it does not
      // pick a brand, and it should not look like a seventh brand.
      style={{
        width: '48%', backgroundColor: more ? theme.chipBg : theme.surface,
        borderRadius: CARD_RADIUS, borderWidth: 1.5,
        borderStyle: more ? 'dashed' : 'solid',
        borderColor: more ? 'rgba(27,26,24,0.22)' : theme.line,
        padding: 12, gap: 10,
      }}
    >
      <View style={{
        height: 76, borderRadius: radius.lg, backgroundColor: more ? 'transparent' : theme.chipBg,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {logo ? (
          <Img source={logo} contentFit="contain" style={{ width: '78%', height: '72%' }} />
        ) : (
          <Text
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.ltrBold, fontSize: more ? 26 : 24, color: theme.subtle }}
          >
            {more ? '⋯' : (brand!.name || '?').trim().charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={FONT_SCALE_TIGHT}
          style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right' }}
        >
          {label}
        </Text>
        {!more && (brand!.count ?? 0) > 0 ? (
          <Text
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, writingDirection: 'ltr' }}
          >
            {brand!.count}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

/**
 * One of the brand's most-listed models.
 *
 * A card, not a chip: same 2-up grid, same corner and border weight as the
 * brand step, with the newest listing's photo where the brand's logo sat.
 * `image_path` comes from the ranking endpoint, so the photo costs no extra
 * request — and a model with no image on any listing still renders a filled
 * well rather than a hole.
 */
function ModelCard({ model, active, onPress }: {
  model: TopModel;
  active: boolean;
  onPress: () => void;
}) {
  const photo = model.image_path ? fullImageUrl(model.image_path) : null;
  const range = formatPriceRange(model.min_price, model.max_price);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        width: '48%', backgroundColor: active ? theme.ink : theme.surface,
        borderRadius: CARD_RADIUS, borderWidth: 1.5,
        borderColor: active ? theme.ink : theme.line,
        padding: 12, gap: 10,
      }}
    >
      <View style={{
        height: 78, borderRadius: radius.md, backgroundColor: theme.chipBg,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {photo ? (
          <Img source={{ uri: photo }} contentFit="cover" style={{ width: '100%', height: '100%' }} />
        ) : (
          <Text
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.ltrBold, fontSize: 18, color: theme.subtle }}
          >
            {(model.model || '?').trim().charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ gap: 3 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
          <Text
            numberOfLines={2}
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 12, lineHeight: 16, color: active ? theme.bg : theme.ink, textAlign: 'right' }}
          >
            {model.model}
          </Text>
          <Text
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.mono, fontSize: 10.5, opacity: 0.6, color: active ? theme.bg : theme.ink, writingDirection: 'ltr' }}
          >
            {model.count}
          </Text>
        </View>
        {/* The range, when there is a real one. A group where every listing
            is call-for-price sends null for both ends and gets no line —
            better than a dash between two blanks. */}
        {range ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.ar, fontSize: 10.5, color: active ? theme.bg : theme.subtle, opacity: active ? 0.75 : 1, textAlign: 'right' }}
          >
            {range} د.ع
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
