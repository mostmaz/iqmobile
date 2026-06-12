import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowAccent } from '../../theme';
import { Btn, Pill } from '../../components/ui';
import { IconFilter, IconBell, IconCheck, IconPlus, IconMinus, IconPin, IconStore } from '../../components/icons';
import { fmtIQD } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { Banner } from '../../components/Banner';
import { Listings, Brands, Banners, type BrowseFilters, type Condition, type BrandRow, type BannerRow } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { ar } from '../../i18n/ar';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, arOf } from '../../lib/governorates';
import { GovPicker } from '../../components/GovPicker';

// Brand list comes from the server now (table-backed, admin-editable).
// We used to hardcode it here with illustrative counts; that meant adding
// a new brand required a code change + APK rebuild. Now the dashboard
// can add brands and the next /brands fetch picks them up.
// 'sealed' was retired from the UI — server still accepts it on legacy
// listings, just not surfaced as a picker option anymore.
const CONDITIONS: Condition[] = ['new', 'used', 'refurbished'];

// Price filter operates in 100,000 IQD steps across a 100K–2M range — the
// band where virtually the whole Iraqi phone market lives. Both ends are
// soft: the floor (100K) means "no minimum" (cheaper outliers still match)
// and the cap (2M, shown as "2,000,000+") means "no maximum", so pricier
// flagships aren't excluded — the bounds just keep the steppers short.
const PRICE_STEP = 100_000;
const PRICE_MIN = 100_000;
const PRICE_MAX = 2_000_000;
// Defaults shown in the steppers when the user opens the filter sheet
// without any price filter yet active. Tuned to the modal price band
// for used Iraqi phone sales (100K = bottom of the realistic market,
// 1M = where most flagships sit). Buyers can step outside this range
// in either direction to broaden the search.
const PRICE_DEFAULT_MIN = 100_000;
const PRICE_DEFAULT_MAX = 1_000_000;

// Initial page = 15 cards (fast first paint), then load 15 more each time
// the FlatList nears its end. Keeps the grid responsive on first tab open.
const PAGE_SIZE = 15;

export default function BrowseScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [filters, setFilters] = useState<BrowseFilters>({});
  // Search lives in its own dedicated tab now (it replaced Favorites in the
  // bottom bar). Browse is pure filtering — no inline search box here.
  const [showFilter, setShowFilter] = useState(false);
  const qc = useQueryClient();
  const { user } = useAuth();
  // Rotates which banner shows when a slot has several equally-specific
  // ones — bumped on pull-to-refresh, filter change, and re-opening the tab.
  const [bannerTick, setBannerTick] = useState(0);

  // Brand catalog — server-side now (table-backed, admin-editable).
  // staleTime 5min so we don't refetch on every focus; the dashboard
  // adding a brand is rare enough that a few minutes of stale UI is fine.
  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: () => Brands.list(),
    staleTime: 5 * 60 * 1000,
  });
  const brands = brandsData || [];

  // Brand rail order: a curated head (apple → tecno), then the remaining
  // brands in their server order, then the "Other" catch-all last. ("الكل"
  // is rendered separately as the first pill.) Head brands missing from the
  // server list are simply skipped — only existing brands ever render.
  const sortedBrands = useMemo(() => {
    const HEAD = ['apple', 'samsung', 'honor', 'xiaomi', 'realme', 'infinix', 'tecno'];
    const isOther = (b: BrandRow) => {
      const n = b.name.trim().toLowerCase();
      const a = (b.display_ar || '').trim();
      return n === 'other' || n === 'others' || a === 'أخرى' || a === 'اخرى' || a === 'آخر';
    };
    const rank = (b: BrandRow) => {
      if (isOther(b)) return 9999;                       // catch-all goes last
      const i = HEAD.indexOf(b.name.trim().toLowerCase());
      return i === -1 ? 500 : i;                         // head first, rest in the middle
    };
    return [...brands].sort((a, b) => {
      const d = rank(a) - rank(b);
      // Ties (the "rest" bucket) keep their server position order.
      return d !== 0 ? d : (a.position ?? 0) - (b.position ?? 0);
    });
  }, [brands]);

  // Any non-location filter active? Drives the little accent dot on the
  // compact filter button (governorate has its own chip, so it's excluded).
  const hasActiveFilters = !!(
    filters.brand || filters.condition || filters.min_price != null || filters.max_price != null
  );

  const {
    data, isLoading, refetch, isRefetching,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    // bannerTick doubles as the featured-slot rotation seed: it's part of
    // the key so a refresh/filter/focus starts a fresh pagination session,
    // and every page of that session sends the same seed — keeping the
    // server's featured-slot pick (and thus offsets) consistent across pages.
    queryKey: ['browse', filters, bannerTick],
    queryFn: ({ pageParam = 0 }) =>
      Listings.browse({ ...filters, seed: bannerTick, limit: PAGE_SIZE, offset: pageParam as number }),
    initialPageParam: 0,
    // Stop paginating when the server returns a partial page.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
  });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['browse'] }); setBannerTick((t) => t + 1); }, [qc]));

  // Auto-apply the user's governorate as the active filter on first mount.
  // This is what "show device of this governorate only when location is
  // detected" means in practice: the onboarding flow (or a manual gov
  // change from EditProfile) writes user.governorate; here we mirror it
  // into filters.governorate so opening Browse already shows just-local
  // listings. The user can still tap the picker → "كل المحافظات" to
  // broaden the view.
  //
  // We do this ONCE per session (govAutoApplied ref) so a user who
  // intentionally cleared the filter doesn't see it snap back the next
  // time the component re-renders.
  const govAutoApplied = useRef(false);
  useEffect(() => {
    if (govAutoApplied.current) return;
    if (!user?.governorate) return;
    govAutoApplied.current = true;
    setFilters((s) => (s.governorate ? s : { ...s, governorate: user.governorate }));
  }, [user?.governorate]);

  function patch(p: Partial<BrowseFilters>) { setFilters((s) => ({ ...s, ...p })); setBannerTick((t) => t + 1); }
  function clear() { setFilters({}); }

  // Translate the picker's Arabic value ↔ filters.governorate's English
  // canonical name. Empty string = "all governorates" (filter cleared).
  const govArValue = filters.governorate ? GOV_EN_TO_AR[filters.governorate] || '' : '';
  function onGovChange(ar: string) {
    if (!ar) {
      patch({ governorate: undefined });
    } else {
      patch({ governorate: GOV_AR_TO_EN[ar] || undefined });
    }
  }

  // Flatten paginated pages into one list for the FlatList.
  const items = useMemo(() => data?.pages.flat() ?? [], [data]);

  // Promo banners. The HOME banner is universal — it shows on every view
  // (the all-brands feed AND each brand filter). When a brand is selected we
  // ALSO pull that brand's banners; the two pools then rotate together at the
  // single slot. Geo target: an explicit governorate filter wins, otherwise
  // the user's own; nationwide banners (governorate=null) always match too.
  // Failures are non-fatal — the feed just renders without a banner.
  const bannerGov = filters.governorate ?? user?.governorate ?? undefined;
  const { data: homeBanners } = useQuery({
    queryKey: ['banners', 'home', bannerGov ?? '__all__'],
    queryFn: () => Banners.home(bannerGov),
    staleTime: 5 * 60 * 1000,
  });
  const { data: brandBanners } = useQuery({
    queryKey: ['banners', 'brand', filters.brand ?? '', bannerGov ?? '__all__'],
    queryFn: () => Banners.brand(filters.brand as string, bannerGov),
    enabled: !!filters.brand,
    staleTime: 5 * 60 * 1000,
  });

  // Pick which banner to show, rotating when several are eligible. Two rules:
  //   1. Brand specificity is a hard tier — on a Samsung view, a Samsung-
  //      targeted banner always beats an "every brand" one.
  //   2. Governorate is a 3:1 weighting, not a knockout — when a governorate-
  //      targeted banner competes with a nationwide one, the rotation schedule
  //      gives each gov-specific banner 3 impressions for every 1 nationwide
  //      impression (instead of hiding the nationwide banner entirely).
  // The home pool (always) and the brand pool (when a brand is filtered)
  // rotate together via bannerTick — advancing on refresh / filter change /
  // tab re-open.
  const banner: BannerRow | null = useMemo(() => {
    const schedule = (list?: BannerRow[]): BannerRow[] => {
      if (!list || list.length === 0) return [];
      // Hard tier on the brand dimension only (home banners all have
      // brand=null, so this is a no-op for the home pool).
      const hasBrandSpecific = list.some((b) => b.brand != null);
      const tier = hasBrandSpecific ? list.filter((b) => b.brand != null) : list;
      // 3:1 governorate weighting: three rounds of the gov-specific banners,
      // then one round of the nationwide ones. bannerTick walks this cycle.
      const specific = tier.filter((b) => b.governorate != null);
      const nationwide = tier.filter((b) => b.governorate == null);
      if (specific.length === 0 || nationwide.length === 0) return tier;
      const out: BannerRow[] = [];
      for (let round = 0; round < 3; round++) out.push(...specific);
      out.push(...nationwide);
      return out;
    };
    const pool = [...schedule(homeBanners), ...(filters.brand ? schedule(brandBanners) : [])];
    if (pool.length === 0) return null;
    return pool[bannerTick % pool.length];
  }, [homeBanners, brandBanners, filters.brand, bannerTick]);

  // Feed data with the banner pinned to the very top (first slot, above the
  // first listing). Banner items carry a __banner tag so renderItem and
  // keyExtractor can tell them apart from listings.
  const feedData = useMemo(() => {
    if (!banner) return items as any[];
    return [{ __banner: banner }, ...items];
  }, [items, banner]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 8 }}>
        {/* Top row: iQ logo + name + bell with red dot */}
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            <View style={[{
              width: 30, height: 30, borderRadius: 8, backgroundColor: theme.accent,
              alignItems: 'center', justifyContent: 'center',
            }, shadowAccent]}>
              <Text style={{ color: '#fff', fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 12 }}>iQ</Text>
            </View>
            <View>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, fontWeight: '700', color: theme.ink }}>
                {ar.app.name}
              </Text>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: theme.subtle, textTransform: 'uppercase' }}>
                العراق
              </Text>
            </View>
          </View>
          {/* Current scope chip — "all Iraq" or the picked governorate. Lives
              in the existing top row so it adds no vertical height. Tap to
              open the filter sheet (where the governorate is chosen). */}
          <TouchableOpacity
            onPress={() => setShowFilter(true)}
            activeOpacity={0.7}
            style={{
              flexShrink: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
              borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginHorizontal: 8,
            }}
          >
            <IconPin size={13} color={theme.accent} sw={1.7} />
            <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12, fontWeight: '600', color: theme.ink }}>
              {filters.governorate ? arOf(filters.governorate) : 'كل العراق'}
            </Text>
          </TouchableOpacity>
          {/* Trailing actions: filter + bell, side by side. The search box
              and brand rail that used to sit below were removed — search has
              its own tab, brand selection moved into the filter sheet. */}
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            {/* Shops directory entry. */}
            <TouchableOpacity
              onPress={() => navigation.navigate('Shops')}
              activeOpacity={0.85}
              style={{
                width: 38, height: 38, borderRadius: 999,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <IconStore size={18} color={theme.ink} sw={1.7} />
            </TouchableOpacity>
            {/* Filter button. Compact icon button matching the bell; the
                accent dot signals an active (non-location) filter, and the
                ink fill shows when the sheet is open. */}
            <TouchableOpacity
              onPress={() => setShowFilter((v) => !v)}
              activeOpacity={0.85}
              style={{
                width: 38, height: 38, borderRadius: 999,
                backgroundColor: showFilter ? theme.ink : theme.surface,
                borderWidth: 1, borderColor: theme.line,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <IconFilter size={17} color={showFilter ? theme.bg : theme.ink} sw={1.7} />
              {hasActiveFilters && !showFilter ? (
                <View style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 7, height: 7, borderRadius: 999, backgroundColor: theme.accent,
                  borderWidth: 1.5, borderColor: theme.surface,
                }} />
              ) : null}
            </TouchableOpacity>
            {/* Bell opens the notifications inbox. Previously the wrapper
                looked tappable (with a red unread dot!) but had no onPress —
                users tapped it expecting Notifications and got nothing. */}
            <TouchableOpacity
              onPress={() => navigation.navigate('Notifications')}
              style={{ padding: 4 }}
              activeOpacity={0.6}
            >
              <IconBell size={20} color={theme.ink} sw={1.7} />
              <View style={{
                position: 'absolute', top: 2, right: 2,
                width: 7, height: 7, borderRadius: 999, backgroundColor: theme.accent,
              }} />
            </TouchableOpacity>
          </View>
        </View>

        {showFilter ? (
          <View style={{
            marginTop: 2, padding: 14, backgroundColor: theme.surface,
            borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
          }}>
            <Section label="الماركة">
              <Pill active={!filters.brand} onPress={() => patch({ brand: undefined })}>الكل</Pill>
              {sortedBrands.map((b) => (
                <Pill key={b.name} active={filters.brand === b.name}
                  onPress={() => patch({ brand: filters.brand === b.name ? undefined : b.name })}
                  count={b.count}>
                  {b.display_ar || b.name}
                </Pill>
              ))}
            </Section>
            <Section label="الحالة">
              <Pill active={!filters.condition} onPress={() => patch({ condition: undefined })}>{ar.browse.allConditions}</Pill>
              {CONDITIONS.map((c) => <Pill key={c} active={filters.condition === c} onPress={() => patch({ condition: c })}>{(ar.listing as any)[c]}</Pill>)}
            </Section>
            {/* Governorate — same dropdown used by the compact chip
                above the brand rail, just rendered here in the full row
                variant so the filter sheet has its own self-contained
                "current location" surface. Two triggers, one source of
                truth (filters.governorate). */}
            <Text style={{ marginTop: 8, marginBottom: 6, fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, textTransform: 'uppercase', letterSpacing: 1.2, textAlign: 'right' }}>
              المحافظة
            </Text>
            <GovPicker
              valueAr={govArValue}
              onChangeAr={onGovChange}
              allowAll
              allLabel={ar.browse.allGovs}
            />
            <Text style={{ marginTop: 8, marginBottom: 6, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.subtle, textAlign: 'right' }}>
              السعر (د.ع)
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              <PriceStepper
                label="من"
                value={filters.min_price ?? PRICE_DEFAULT_MIN}
                onChange={(v) => {
                  // keep min ≤ max so the range stays valid
                  const max = filters.max_price ?? PRICE_DEFAULT_MAX;
                  const next = Math.min(v, max);
                  // Stepping down to the floor = "no minimum" (clear filter),
                  // so sub-100K outliers still match.
                  patch({ min_price: next <= PRICE_MIN ? undefined : next });
                }}
              />
              <PriceStepper
                label="إلى"
                value={filters.max_price ?? PRICE_DEFAULT_MAX}
                onChange={(v) => {
                  const min = filters.min_price ?? PRICE_DEFAULT_MIN;
                  const next = Math.max(v, min);
                  // Stepping up to the cap = "no maximum" (open-ended).
                  patch({ max_price: next === PRICE_MAX ? undefined : next });
                }}
                openEndedAtMax
              />
            </View>
            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 14 }}>
              <Btn kind="ghost" full onPress={clear}>{ar.browse.clear}</Btn>
              <Btn kind="primary" full onPress={() => setShowFilter(false)}>{ar.browse.apply}</Btn>
            </View>
          </View>
        ) : null}
      </View>

      <FlatList
        data={feedData}
        keyExtractor={(item) => (item.__banner ? `banner-${item.__banner.id}` : String(item.id))}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { setBannerTick((t) => t + 1); refetch(); }} />}
        renderItem={({ item }) => (
          item.__banner ? (
            <Banner banner={item.__banner} onOpenListing={(id) => navigation.navigate('ListingDetail', { id })} />
          ) : (
            <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
          )
        )}
        // Load the next 15 when the user has scrolled within ~half a screen
        // of the bottom. The guard avoids re-firing while a fetch is inflight
        // or when there are no more pages.
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={isFetchingNextPage ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : null}
        ListEmptyComponent={!isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 14 }}>{ar.browse.none}</Text>
          </View>
        ) : null}
      />
    </View>
  );
}

// Filter-sheet section. Same row-reverse layout as the brand rail, so
// same fix: scrollToEnd on content layout pins "الكل" (first child,
// laid out at the right edge) to the visible right side instead of
// burying it past the right scroll boundary.
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<ScrollView>(null);
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6, textAlign: 'right' }}>{label}</Text>
      <ScrollView
        ref={ref}
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}
        onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// Stepper-style price input — −/+ each adjusts by 100,000 IQD. We
// intentionally don't accept manual text input: Iraqi keyboards default
// to Arabic numerals and there's no reasonable way to validate "is this
// what the user meant" against a 5M-cap range. Steppers also reinforce
// that the filter only operates at 100K granularity.
function PriceStepper({
  label, value, onChange, openEndedAtMax,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  // Show "+" suffix when at the cap, signaling unlimited.
  openEndedAtMax?: boolean;
}) {
  const atCap = openEndedAtMax && value >= PRICE_MAX;
  const display = `${fmtIQD(value)}${atCap ? '+' : ''}`;
  const dec = () => onChange(Math.max(PRICE_MIN, value - PRICE_STEP));
  const inc = () => onChange(Math.min(PRICE_MAX, value + PRICE_STEP));
  const decDisabled = value <= PRICE_MIN;
  const incDisabled = value >= PRICE_MAX;
  return (
    <View style={{
      flex: 1,
      backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.line,
      borderRadius: radius.lg,
      padding: 10,
    }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right', marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <TouchableOpacity onPress={dec} disabled={decDisabled} activeOpacity={0.7} style={{
          width: 32, height: 32, borderRadius: 999,
          backgroundColor: theme.chipBg,
          alignItems: 'center', justifyContent: 'center',
          opacity: decDisabled ? 0.35 : 1,
        }}>
          <IconMinus size={14} color={theme.ink} sw={2.4} />
        </TouchableOpacity>
        <Text style={{
          flex: 1, textAlign: 'center',
          fontFamily: fonts.ltrBold, fontSize: 15, fontWeight: '700', color: theme.ink,
          writingDirection: 'ltr',
        }} numberOfLines={1} adjustsFontSizeToFit>
          {display}
        </Text>
        <TouchableOpacity onPress={inc} disabled={incDisabled} activeOpacity={0.7} style={{
          width: 32, height: 32, borderRadius: 999,
          backgroundColor: theme.chipBg,
          alignItems: 'center', justifyContent: 'center',
          opacity: incDisabled ? 0.35 : 1,
        }}>
          <IconPlus size={14} color={theme.ink} sw={2.4} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

