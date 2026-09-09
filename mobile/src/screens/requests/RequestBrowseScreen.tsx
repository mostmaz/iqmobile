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
import { useTabBarClearance } from '../../lib/tabBarClearance';
import { arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';

const PAGE_SIZE = 15;
/** The window for both the ranking and the list — one number, on purpose. */
const WINDOW_DAYS = 60;
/**
 * Card corner from the Claude Design prototype. Deliberately off the shared
 * `radius` scale, whose largest step is 16: the funnel's chooser cards are
 * the only place in the app that uses it, and rounding them to 16 to stay on
 * the scale is what made the shipped screen read as a different design.
 */
const CARD_RADIUS = 18;

export default function RequestBrowseScreen({ navigation }: any) {
  const { user } = useAuth();
  const isReal = !!user && !(user as any).is_guest;
  const tabClearance = useTabBarClearance();
  const railRef = useRef<ScrollView>(null);

  const [brand, setBrand] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // The chooser collapses once a device is picked. Ten photo cards are ~650pt
  // of chooser, so leaving it open puts the listings the buyer just asked for
  // off the bottom of a 390pt screen. The prototype defaults it open because a
  // click-through has to show every state at once; a phone does not.
  const [selectorOpen, setSelectorOpen] = useState(false);
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

  function pickModel(name: string) {
    const next = model === name ? null : name;
    setModel(next);
    setSelectorOpen(false);
  }

  /** Brand and model rows are hidden behind the summary once a device is picked. */
  const selectorVisible = !model || selectorOpen;

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
      {/* The one line that explains the grid. It has to sit above the cards:
          below them it lands under the floating button on a 390pt screen,
          where an instruction nobody scrolls to is an instruction nobody
          reads. */}
      {!brand ? (
        <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 13, lineHeight: 20, textAlign: 'right' }}>
          اختر الماركة لترى الأجهزة المعروضة الآن — وإن لم تجد ما تريد، اطلبه.
        </Text>
      ) : null}

      {/* The collapsed chooser: what you picked, and the way back to picking. */}
      {model && !selectorVisible ? (
        <PickedBar
          brand={brand!}
          model={model}
          onChange={() => setSelectorOpen(true)}
        />
      ) : null}
      {/* Brands. Six in the owner's order, then «أخرى». Scrolled to the end
          on layout so RTL lands on the first item — the fix Browse and
          Search both carry.

          Two shapes, one language. Choosing is a 2-up grid of cards; once a
          brand is chosen that collapses to a rail of the same tile at 48pt
          with its name beneath, because three rows of 96pt cards would push
          the models and every listing below the fold on a 390pt screen.
          Text pills were the earlier shortcut here and they broke the
          design: the funnel is made of tiles the whole way down. */}
      {brand && selectorVisible ? (
        <ScrollView
          ref={railRef}
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 2, paddingBottom: 2 }}
          onContentSizeChange={() => railRef.current?.scrollToEnd({ animated: false })}
        >
          {head.map((b) => (
            <BrandRailItem key={b.name} brand={b} active={brand === b.name} onPress={() => pickBrand(b.name)} />
          ))}
          {pickedFromRest ? (
            <BrandRailItem brand={pickedFromRest} active onPress={() => pickBrand(pickedFromRest.name)} />
          ) : null}
          <BrandRailItem more onPress={() => setMoreOpen(true)} />
        </ScrollView>
      ) : brand ? null : (
        <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }}>
          {head.map((b) => <BrandCard key={b.name} brand={b} onPress={() => pickBrand(b.name)} />)}
          <BrandCard more onPress={() => setMoreOpen(true)} />
        </View>
      )}

      {/* Models. Real supply, real counts. */}
      {brand && selectorVisible ? (
        topModels.isLoading ? (
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ width: '48%', height: 130, borderRadius: CARD_RADIUS, backgroundColor: theme.surface }} />
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
            {/* 2-up cards with the device's own photo, not text chips. The
                photo is the newest listing's first image, which the ranking
                endpoint already returns — a buyer recognises the phone by
                sight long before they parse "Galaxy S24 Ultra". */}
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 }}>
              {topModels.data!.map((m) => (
                <ModelCard
                  key={m.model_key}
                  model={m}
                  active={model === m.model}
                  onPress={() => pickModel(m.model)}
                />
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
          !brand ? null
            : !model ? null
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
          <Img source={{ uri: logo }} contentFit="contain" style={{ width: '78%', height: '72%' }} />
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
 * The collapsed chooser — brand mark, the picked device, and the way back.
 *
 * It replaces the brand rail and the model grid once a device is chosen, so
 * the listings start near the top of the screen instead of below ~650pt of
 * chooser. «تغيير الجهاز» puts both rows back.
 */
function PickedBar({ brand, model, onChange }: {
  brand: string;
  model: string;
  onChange: () => void;
}) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      paddingVertical: 10, paddingHorizontal: 12,
      backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, borderRadius: radius.xl,
    }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <View style={{
          width: 38, height: 38, borderRadius: radius.md, backgroundColor: theme.chipBg,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.ltrBold, fontSize: 13, color: theme.chipInk }}
          >
            {(brand || '?').trim().slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}
          >
            {model}
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right' }}
          >
            {brand}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={onChange}
        activeOpacity={0.85}
        accessibilityRole="button"
        hitSlop={6}
        // flexShrink:0 on both the button and its label. The row's left group
        // is flex:1, and under that pressure the Arabic label silently drops
        // its trailing word — «تغيير الجهاز» renders as «تغيير». That is
        // shrink, not bidi: see project_rtl_text_clipping.
        style={{
          flexShrink: 0,
          flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
          paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill,
          backgroundColor: theme.bg, borderWidth: 1, borderColor: 'rgba(27,26,24,0.12)',
        }}
      >
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={FONT_SCALE_TIGHT}
          style={{ flexShrink: 0, fontFamily: fonts.arBold, fontSize: 12, color: theme.ink }}
        >
          تغيير الجهاز
        </Text>
        <Text
          maxFontSizeMultiplier={FONT_SCALE_TIGHT}
          style={{ fontFamily: fonts.ltr, fontSize: 11, color: theme.ink, marginTop: -1 }}
        >
          ▾
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * The same brand tile at rail size, for after a brand has been chosen.
 *
 * 48pt mark over a 10.5pt name, in a 62pt column — the shape the design uses
 * so the row still reads as the grid it replaced. Active inverts the tile to
 * ink, which is how every other selected control in the app reads.
 */
function BrandRailItem({ brand, more, active, onPress }: {
  brand?: FunnelBrand;
  /** The «أخرى» item — the rest of the brands, not the catalogue's "Other". */
  more?: boolean;
  active?: boolean;
  onPress: () => void;
}) {
  const label = more ? 'أخرى' : brandLabel(brand!);
  const logo = brand?.logo_path ? fullImageUrl(brand.logo_path) : null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={{ width: 62, alignItems: 'center', gap: 6 }}
    >
      <View style={{
        width: 48, height: 48, borderRadius: radius.xl,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        backgroundColor: active ? theme.ink : theme.surface,
        borderWidth: 1, borderColor: active ? theme.ink : theme.line,
      }}>
        {logo ? (
          <Img source={{ uri: logo }} contentFit="contain" style={{ width: '74%', height: '74%' }} />
        ) : (
          <Text
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.ltrBold, fontSize: 17, color: active ? theme.bg : theme.ink }}
          >
            {more ? '⋯' : (brand!.name || '?').trim().charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={FONT_SCALE_TIGHT}
        style={{ fontFamily: fonts.ar, fontSize: 10.5, color: active ? theme.ink : theme.subtle }}
      >
        {label}
      </Text>
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
    </TouchableOpacity>
  );
}
