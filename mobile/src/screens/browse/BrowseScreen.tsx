import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowAccent } from '../../theme';
import { Btn, Input, Pill } from '../../components/ui';
import { IconSearch, IconFilter, IconBell, IconCheck, IconPlus, IconMinus } from '../../components/icons';
import { fmtIQD } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { Listings, type BrowseFilters, type Condition } from '../../api/endpoints';
import { ar } from '../../i18n/ar';
import { GOV_AR_LIST, GOV_AR_TO_EN } from '../../lib/governorates';

// Counts here are illustrative until we wire a real aggregate query —
// they help users gauge inventory density per brand at a glance.
const BRANDS: Array<{ name: string; count: number }> = [
  { name: 'Apple', count: 142 },
  { name: 'Samsung', count: 98 },
  { name: 'Xiaomi', count: 64 },
  { name: 'Google', count: 22 },
  { name: 'OnePlus', count: 18 },
  { name: 'Huawei', count: 31 },
];
// 'sealed' was retired from the UI — server still accepts it on legacy
// listings, just not surfaced as a picker option anymore.
const CONDITIONS: Condition[] = ['new', 'used', 'refurbished'];

// Price filter operates in 100,000 IQD steps. Range chosen to cover the
// realistic Iraqi phone market: cheapest used Androids are ~50K, top-spec
// new flagships rarely exceed ~3M, with some unusual outliers — so we cap
// at 5M and surface the cap as "+" (open-ended) on the max stepper.
const PRICE_STEP = 100_000;
const PRICE_MIN = 0;
const PRICE_MAX = 5_000_000;

// Initial page = 15 cards (fast first paint), then load 15 more each time
// the FlatList nears its end. Keeps the grid responsive on first tab open.
const PAGE_SIZE = 15;

export default function BrowseScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [filters, setFilters] = useState<BrowseFilters>({});
  const [showFilter, setShowFilter] = useState(false);
  const qc = useQueryClient();

  const {
    data, isLoading, refetch, isRefetching,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['browse', filters],
    queryFn: ({ pageParam = 0 }) =>
      Listings.browse({ ...filters, limit: PAGE_SIZE, offset: pageParam as number }),
    initialPageParam: 0,
    // Stop paginating when the server returns a partial page.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE,
  });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['browse'] }); }, [qc]));

  function patch(p: Partial<BrowseFilters>) { setFilters((s) => ({ ...s, ...p })); }
  function clear() { setFilters({}); }

  // Flatten paginated pages into one list for the FlatList.
  const items = useMemo(() => data?.pages.flat() ?? [], [data]);
  const resultsCount = items.length;

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
          <TouchableOpacity style={{ padding: 4 }} activeOpacity={0.6}>
            <IconBell size={20} color={theme.ink} sw={1.7} />
            <View style={{
              position: 'absolute', top: 2, right: 2,
              width: 7, height: 7, borderRadius: 999, backgroundColor: theme.accent,
            }} />
          </TouchableOpacity>
        </View>

        <Text style={{ fontFamily: fonts.arBold, fontSize: 28, fontWeight: '700', letterSpacing: -0.5, lineHeight: 34, color: theme.ink, textAlign: 'right' }}>
          {ar.browse.title}
        </Text>
        <Text style={{ marginTop: 4, fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right' }}>
          <Text style={{ fontFamily: fonts.ltrBold, color: theme.ink, fontWeight: '600' }}>{resultsCount}</Text> نتيجة · موبايلات في عموم العراق
        </Text>

        <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 14 }}>
          <View style={{
            flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
            backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11,
            borderWidth: 1, borderColor: theme.line,
          }}>
            <IconSearch size={18} color={theme.subtle} sw={1.7} />
            <Input value={filters.q || ''} onChangeText={(v) => patch({ q: v })} placeholder={ar.browse.search} bare />
          </View>
          {/* Pill button with both icon AND visible "فلتر" label so users
              never have to guess what the funnel glyph means. */}
          <TouchableOpacity onPress={() => setShowFilter(!showFilter)} activeOpacity={0.85} style={{
            height: 44, borderRadius: 999, paddingHorizontal: 14,
            backgroundColor: showFilter ? theme.ink : theme.surface,
            borderWidth: 1, borderColor: theme.line,
            flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
          }}>
            <IconFilter size={16} color={showFilter ? theme.bg : theme.ink} sw={1.7} />
            <Text style={{ fontFamily: fonts.arBold, fontWeight: '600', fontSize: 13, color: showFilter ? theme.bg : theme.ink }}>
              فلتر
            </Text>
          </TouchableOpacity>
        </View>

        {/* Brands rail */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ marginTop: 14, marginHorizontal: -16 }}
          contentContainerStyle={{ paddingHorizontal: 16, flexDirection: 'row-reverse', gap: 6 }}>
          <Pill active={!filters.brand} onPress={() => patch({ brand: undefined })}>الكل</Pill>
          {BRANDS.map((b) => (
            <Pill key={b.name} active={filters.brand === b.name}
              onPress={() => patch({ brand: filters.brand === b.name ? undefined : b.name })}
              count={b.count}>
              {b.name}
            </Pill>
          ))}
        </ScrollView>

        {showFilter ? (
          <View style={{
            marginTop: 12, padding: 14, backgroundColor: theme.surface,
            borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
          }}>
            <Section label="الحالة">
              <Pill active={!filters.condition} onPress={() => patch({ condition: undefined })}>{ar.browse.allConditions}</Pill>
              {CONDITIONS.map((c) => <Pill key={c} active={filters.condition === c} onPress={() => patch({ condition: c })}>{(ar.listing as any)[c]}</Pill>)}
            </Section>
            <Section label="المحافظة">
              <Pill active={!filters.governorate} onPress={() => patch({ governorate: undefined })}>{ar.browse.allGovs}</Pill>
              {GOV_AR_LIST.map((g) => {
                const en = GOV_AR_TO_EN[g];
                return <Pill key={g} active={filters.governorate === en} onPress={() => patch({ governorate: en })}>{g}</Pill>;
              })}
            </Section>
            <Text style={{ marginTop: 8, marginBottom: 6, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.subtle, textAlign: 'right' }}>
              السعر (د.ع)
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              <PriceStepper
                label="من"
                value={filters.min_price ?? 0}
                onChange={(v) => {
                  // keep min ≤ max so the range stays valid
                  const max = filters.max_price ?? PRICE_MAX;
                  const next = Math.min(v, max);
                  patch({ min_price: next === 0 ? undefined : next });
                }}
              />
              <PriceStepper
                label="إلى"
                value={filters.max_price ?? PRICE_MAX}
                onChange={(v) => {
                  const min = filters.min_price ?? 0;
                  const next = Math.max(v, min);
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
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6, textAlign: 'right' }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}>
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

