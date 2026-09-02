// Shops directory — businesses filterable by governorate and defaulting to
// the shopper's own, featured shops floated to the top (the server orders
// them). Tapping a shop opens its page (listings + contact). A "register my
// shop" CTA sits up top — free for now (self-serve), with a WhatsApp-contact
// alternative on the register screen.
//
// The screen has two modes. With the search box empty and no brand picked it
// shows the shop directory (above). The moment the shopper types a query or
// taps a brand it flips to a DEVICE search scoped to shops only — the results
// are ranked featured-first, then by shop rating, then cheapest (server
// sort='rank'), so a featured, well-reviewed shop's device leads.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Img } from '../../components/Img';
import { IconStore, IconStar, IconPin, IconSpark, IconPlus, IconChevronLeft, IconSearch, IconClose } from '../../components/icons';
import { Pill } from '../../components/ui';
import { GovPicker } from '../../components/GovPicker';
import { ListingCard } from '../../components/ListingCard';
import { ShopListSkeleton, ListingListSkeleton } from '../../components/Skeleton';
import { Shops, Listings, Brands, type ShopCard, type BrandRow } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';

const PAGE_SIZE = 15;

export default function ShopsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const brandRailRef = useRef<ScrollView>(null);

  // ── Device-search state ──────────────────────────────────────────────
  // `search` is the raw text; `q` is the debounced term actually sent to the
  // server (350ms) so typing doesn't fire a request per keystroke. A picked
  // brand OR a non-empty query flips the screen into search mode.
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  const searchActive = !!(q || brand);

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

  // Shop devices, ranked (featured → shop rating → price). Only runs in search
  // mode. seller_type='shop' scopes it to shops (the server also keeps the
  // hidden price-aggregator out).
  const {
    data: devData, isLoading: devLoading, isError: devError, refetch: devRefetch,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['shop-device-search', q, brand],
    queryFn: ({ pageParam = 0 }) =>
      Listings.browse({
        seller_type: 'shop',
        sort: 'rank',
        ...(q ? { q } : {}),
        ...(brand ? { brand } : {}),
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE),
    enabled: searchActive,
  });
  const devices = useMemo(() => devData?.pages.flat() ?? [], [devData]);

  function clearSearch() {
    setSearch(''); setQ(''); setBrand(null);
  }
  function pickBrand(b: string) {
    setBrand((cur) => (cur === b ? null : b));
  }

  // ── Directory state (default mode) ───────────────────────────────────
  // Open on the user's own governorate rather than the whole country — a
  // buyer in Mosul scrolling past Baghdad shops they can't reach is noise.
  // Read through GOV_EN_TO_AR rather than arOf(): arOf falls back to echoing
  // its input, and an unmapped value would set a filter the picker can't
  // round-trip back to English, silently emptying the list.
  const homeGovAr = (user?.governorate && GOV_EN_TO_AR[user.governorate]) || '';
  const [govAr, setGovAr] = useState(homeGovAr);
  // The default applies once. `user` may hydrate a frame or two after first
  // render, so it can't just be the initial state — but once the shopper has
  // touched the picker (or we've already applied it) we must never reach in
  // and change their filter underneath them.
  const govPinned = useRef(!!homeGovAr);
  useEffect(() => {
    if (govPinned.current || !homeGovAr) return;
    govPinned.current = true;
    setGovAr(homeGovAr);
  }, [homeGovAr]);
  const govEn = govAr ? GOV_AR_TO_EN[govAr] : undefined;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['shops', govEn ?? '__all__'],
    queryFn: () => Shops.list(govEn),
  });
  useFocusEffect(React.useCallback(() => { refetch(); }, [refetch]));
  const shops = useMemo(() => data ?? [], [data]);

  const isShop = user?.seller_type === 'shop';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
            <IconStore size={17} color="#fff" sw={1.8} />
          </View>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, flex: 1, textAlign: 'right' }}>
            المتاجر
          </Text>
        </View>

        {/* Device search across shops */}
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
          backgroundColor: theme.surface, borderRadius: radius.pill,
          borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14, height: 42,
        }}>
          <IconSearch size={17} color={theme.subtle} sw={1.8} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            placeholder="ابحث عن جهاز في المتاجر…"
            placeholderTextColor={theme.subtle}
            style={{ flex: 1, fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right', paddingVertical: 0 }}
          />
          {searchActive ? (
            <TouchableOpacity onPress={clearSearch} activeOpacity={0.6} style={{ padding: 2 }}>
              <IconClose size={15} color={theme.subtle} sw={2} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Brand rail — filters the device search. row-reverse puts the first
            brand at the RIGHT edge; a ScrollView opens at offset 0 (its LEFT),
            so scrollToEnd on layout lands on the first brand (Apple). Same fix
            the browse + search screens use. */}
        <ScrollView
          ref={brandRailRef}
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}
          onContentSizeChange={() => brandRailRef.current?.scrollToEnd({ animated: false })}
          style={{ marginTop: 10 }}
        >
          {brands.map((b) => (
            <Pill key={b.name} active={brand === b.name} onPress={() => pickBrand(b.name)}>
              {b.display_ar || b.name}
            </Pill>
          ))}
        </ScrollView>

        {/* Directory-only chrome: hidden in search mode to give results room */}
        {!searchActive ? (
          <>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('ShopRegister')}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
                backgroundColor: isShop ? theme.surface : theme.ink,
                borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg,
                paddingHorizontal: 14, paddingVertical: 12, marginTop: 12, marginBottom: 12,
              }}
            >
              <IconPlus size={18} color={isShop ? theme.ink : theme.buttonInk} sw={2} />
              <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 14, color: isShop ? theme.ink : theme.buttonInk, textAlign: 'right' }}>
                {isShop ? 'إدارة متجري' : 'سجّل متجرك مجاناً'}
              </Text>
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <IconChevronLeft size={14} color={isShop ? theme.subtle : theme.buttonInk} sw={2} />
              </View>
            </TouchableOpacity>

            <GovPicker
              valueAr={govAr}
              onChangeAr={(v) => { govPinned.current = true; setGovAr(v); }}
              allowAll
              allLabel="كل المحافظات"
            />
          </>
        ) : null}
      </View>

      {searchActive ? (
        <FlatList
          data={devices}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, paddingTop: 6 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
          )}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
          ) : null}
          ListEmptyComponent={devLoading ? (
            <ListingListSkeleton count={5} />
          ) : devError ? (
            <View style={{ padding: 40, alignItems: 'center', gap: 12 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'center' }}>تعذّر إجراء البحث</Text>
              <TouchableOpacity onPress={() => devRefetch()} activeOpacity={0.85}
                style={{ marginTop: 4, paddingHorizontal: 22, paddingVertical: 11, borderRadius: radius.pill, backgroundColor: theme.ink }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk }}>إعادة المحاولة</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ padding: 48, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
                لا توجد أجهزة مطابقة في المتاجر.
              </Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={shops}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, paddingTop: 6 }}
          renderItem={({ item }) => (
            <ShopRow shop={item} onPress={() => navigation.navigate('ShopDetail', { id: item.id })} />
          )}
          ListEmptyComponent={!isLoading ? (
            <View style={{ padding: 48, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 14, textAlign: 'center' }}>
                لا توجد متاجر {govAr ? `في ${govAr}` : 'بعد'}.
              </Text>
              {/* Landing on an empty screen because the default filter happens
                  to be a governorate with no shops yet is a dead end — offer the
                  way out explicitly rather than widening the filter silently. */}
              {govAr ? (
                <TouchableOpacity
                  onPress={() => { govPinned.current = true; setGovAr(''); }}
                  activeOpacity={0.85}
                  style={{
                    marginTop: 14, paddingHorizontal: 16, paddingVertical: 10,
                    borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
                    backgroundColor: theme.surface,
                  }}
                >
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink }}>
                    عرض متاجر كل المحافظات
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <ShopListSkeleton count={5} />
          )}
        />
      )}
    </View>
  );
}

function ShopRow({ shop, onPress }: { shop: ShopCard; onPress: () => void }) {
  const logo = shop.shop_image_path || shop.profile_image_path;
  const initial = (shop.shop_name || shop.display_name || '?').trim()[0] || '?';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
      borderColor: shop.is_featured ? theme.accent : theme.line, ...shadowSoft,
      padding: 12, marginBottom: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    }}>
      <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {logo ? (
          <Img source={{ uri: fullImageUrl(logo) }} style={{ width: 56, height: 56 }} />
        ) : (
          <Text style={{ fontFamily: fonts.arBold, fontSize: 22, color: theme.subtle }}>{initial}</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right', flexShrink: 1 }}>
            {shop.shop_name}
          </Text>
          {shop.is_featured ? (
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 2, backgroundColor: theme.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
              <IconSpark size={9} color="#fff" />
              <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 9 }}>مميّز</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <IconPin size={11} color={theme.subtle} />
          <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
            {arOf(shop.governorate)}{shop.city ? ` · ${shop.city}` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 5 }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>{shop.listing_count} إعلان</Text>
          {shop.rating_count > 0 && Number.isFinite(shop.rating_avg as any) ? (
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}>
              <IconStar size={11} filled color={theme.accent} />
              <Text style={{ fontFamily: fonts.ltr, fontSize: 11.5, color: theme.subtle }}>{Number(shop.rating_avg).toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {/* Drill-in: forward is leftward in RTL, so no flip. */}
      <IconChevronLeft size={16} color={theme.subtle} sw={2} />
    </TouchableOpacity>
  );
}
