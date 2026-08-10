// Storefront home — an e-commerce shop, not a listings feed.
//
// A marketplace shop page answers "who is this seller?". A storefront has to
// answer "what can I buy, and how do I pay for it?", so this screen is built
// around the product grid: search, brand categories, sort, then two columns of
// products with prices. Everything else (ratings, bio, contact links) is
// deliberately absent — it's noise between a shopper and a purchase.
//
// Products, not listings: the shop stocks the same model in three capacities
// as three listings, and showing them as three near-identical tiles reads as a
// bug. The server groups them, so one tile says "٣ خيارات" and the option is
// picked on the product page.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, TextInput, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Img } from '../../components/Img';
import { fmtIQD } from '../../components/ui';
import { SkBlock } from '../../components/Skeleton';
import {
  IconArrowLeft, IconSearch, IconClose, IconChevronDown, IconMsgCall, IconBox,
} from '../../components/icons';
import { Storefront, type StoreProductCard, type StoreSort, type StoreType } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { useCart } from '../../lib/cart';
import { callPhone } from '../../lib/contact';

const PAGE = 24;
// The store lives inside a tab stack, so the floating tab bar overlaps the
// bottom of the list — without this the last grid row is half-hidden.
const TAB_CLEARANCE = 100;

const TYPE_AR: Record<StoreType, string> = {
  phone: 'هواتف', tablet: 'أجهزة لوحية', accessory: 'أكسسوارات',
};

const SORT_LABELS: Record<StoreSort, string> = {
  newest: 'الأحدث',
  price_asc: 'الأرخص أولاً',
  price_desc: 'الأغلى أولاً',
};

export default function StoreHomeScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const shopId: number = route.params?.id;
  const cart = useCart();

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const [type, setType] = useState<StoreType | null>(null);
  const [sort, setSort] = useState<StoreSort>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const catRef = useRef<ScrollView>(null);

  const { data: home } = useQuery({
    queryKey: ['storefront', shopId],
    queryFn: () => Storefront.home(shopId),
  });

  const {
    data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, isRefetching,
  } = useInfiniteQuery({
    queryKey: ['storefront-products', shopId, q, brand, type, sort],
    queryFn: ({ pageParam = 0 }) => Storefront.products(shopId, {
      q: q || undefined,
      brand: brand || undefined,
      type: type || undefined,
      sort,
      limit: PAGE,
      offset: pageParam as number,
    }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.products.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const products = useMemo(
    () => (data?.pages || []).flatMap((p) => p.products),
    [data],
  );
  const total = data?.pages?.[0]?.total ?? 0;

  const shop = home?.shop;
  const typeCounts = home?.types || [];
  const cartHere = cart.count > 0 && cart.shop_id === shopId;

  // Debounce is unnecessary here — the catalogue is a few hundred rows and the
  // query is server-side paged, but firing on every keystroke would still
  // thrash the list. Search commits on submit or on the search icon.
  const runSearch = useCallback(() => setQ(search.trim()), [search]);
  const clearSearch = useCallback(() => { setSearch(''); setQ(''); }, []);

  const openProduct = useCallback((p: StoreProductCard) => {
    navigation.navigate('StoreProduct', {
      shopId, brand: p.brand, model: p.model, shopName: shop?.name,
    });
  }, [navigation, shopId, shop?.name]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* ── Shop bar: back, name, call ─────────────────────────────── */}
      <View style={{
        paddingTop: insets.top + 6, paddingHorizontal: 14, paddingBottom: 10,
        backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.line,
      }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }} activeOpacity={0.6}>
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}
            >
              {shop?.name || 'المتجر'}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 1 }}>
              أجهزة جديدة · الدفع عند الاستلام
            </Text>
          </View>
          {shop?.phone ? (
            <TouchableOpacity
              onPress={() => callPhone(shop.phone as string)}
              activeOpacity={0.85}
              style={{
                width: 36, height: 36, borderRadius: 999, backgroundColor: theme.accentSoft,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <IconMsgCall size={17} color={theme.accentDeep} sw={1.8} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Search ─────────────────────────────────────────────── */}
        <View style={{
          marginTop: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
          backgroundColor: theme.bg, borderRadius: radius.pill,
          borderWidth: 1, borderColor: theme.line, paddingHorizontal: 14, height: 42,
        }}>
          <TouchableOpacity onPress={runSearch} activeOpacity={0.6}>
            <IconSearch size={17} color={theme.subtle} sw={1.8} />
          </TouchableOpacity>
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            placeholder="ابحث عن جهاز…"
            placeholderTextColor={theme.subtle}
            style={{
              flex: 1, fontFamily: fonts.ar, fontSize: 14, color: theme.ink,
              textAlign: 'right', paddingVertical: 0,
            }}
          />
          {search ? (
            <TouchableOpacity onPress={clearSearch} activeOpacity={0.6} style={{ padding: 2 }}>
              <IconClose size={15} color={theme.subtle} sw={2} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ── Product kind: phones / tablets / accessories ─────────────
          Sits ABOVE the brand rail because it's the coarser cut and the
          one a shopper actually arrives with ("I want a tablet"). Hidden
          when the shop only sells one kind — a lone chip is not a choice. */}
      {typeCounts.length > 1 ? (
        <View style={{
          backgroundColor: theme.surface, paddingBottom: 10,
          flexDirection: 'row-reverse', paddingHorizontal: 14, gap: 7,
        }}>
          <TypeChip active={!type} label="الكل" onPress={() => setType(null)} />
          {typeCounts.map((t) => (
            <TypeChip
              key={t.type}
              active={type === t.type}
              label={`${TYPE_AR[t.type]} ${t.count}`}
              onPress={() => setType(type === t.type ? null : t.type)}
            />
          ))}
        </View>
      ) : null}

      {/* ── Categories (brands) ──────────────────────────────────── */}
      {home?.categories?.length ? (
        <View style={{ backgroundColor: theme.surface, paddingBottom: 10 }}>
          {/* row-reverse lays "الكل" out at the RIGHT edge of the content,
              which is past the right scroll boundary — at offset 0 the rail
              opens on the least-stocked brands. scrollToEnd pins it back.
              Same fix as the brand rail on the browse screen. */}
          <ScrollView
            ref={catRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onContentSizeChange={() => catRef.current?.scrollToEnd({ animated: false })}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 7, flexDirection: 'row-reverse' }}
          >
            <Chip active={!brand} label="الكل" count={home.product_count} onPress={() => setBrand(null)} />
            {home.categories.map((c) => (
              <Chip
                key={c.brand}
                active={brand === c.brand}
                label={c.brand}
                count={c.count}
                onPress={() => setBrand(brand === c.brand ? null : c.brand)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* ── Result count + sort ──────────────────────────────────── */}
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4,
      }}>
        <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, flexShrink: 0 }}>
          {isLoading ? '…' : `${total} جهاز`}
        </Text>
        <TouchableOpacity
          onPress={() => setSortOpen((v) => !v)}
          activeOpacity={0.7}
          style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, flexShrink: 0 }}
        >
          {/* No fontWeight here. On Android, pairing a custom Arabic family
              with an explicit weight makes the platform re-resolve the font
              and lose the shaping — "الأغلى أولاً" silently rendered as
              "الأغلى". The Bold family already carries the weight. */}
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink, flexShrink: 0,
          }}>
            {SORT_LABELS[sort]}
          </Text>
          <IconChevronDown size={13} color={theme.subtle} sw={2} />
        </TouchableOpacity>
      </View>

      {sortOpen ? (
        <View style={{
          marginHorizontal: 16, marginTop: 4, backgroundColor: theme.surface,
          borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
        }}>
          {(Object.keys(SORT_LABELS) as StoreSort[]).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => { setSort(s); setSortOpen(false); }}
              activeOpacity={0.7}
              style={{
                paddingVertical: 11, paddingHorizontal: 14,
                backgroundColor: s === sort ? theme.accentSoft : 'transparent',
              }}
            >
              <Text style={{
                fontFamily: s === sort ? fonts.arBold : fonts.ar, fontSize: 13.5,
                color: s === sort ? theme.accentDeep : theme.ink, textAlign: 'right',
              }}>
                {SORT_LABELS[s]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* ── Product grid ─────────────────────────────────────────── */}
      {isLoading ? (
        <GridSkeleton />
      ) : (
        <FlatList
          data={products}
          key="store-grid"
          numColumns={2}
          keyExtractor={(p) => p.key}
          onRefresh={refetch}
          refreshing={isRefetching}
          columnWrapperStyle={{ flexDirection: 'row-reverse', gap: 10, paddingHorizontal: 14 }}
          contentContainerStyle={{ paddingTop: 10, paddingBottom: TAB_CLEARANCE + (cartHere ? 76 : 0) }}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          renderItem={({ item }) => <ProductTile product={item} onPress={() => openProduct(item)} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 40, gap: 10 }}>
              <IconBox size={30} color={theme.subtle} sw={1.5} />
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>
                لا توجد نتائج
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center' }}>
                {q ? 'جرّب كلمة بحث أخرى أو تصفّح الأقسام.' : 'لا توجد أجهزة في هذا القسم حالياً.'}
              </Text>
              {(q || brand || type) ? (
                <TouchableOpacity
                  onPress={() => { clearSearch(); setBrand(null); setType(null); }}
                  activeOpacity={0.8}
                  style={{
                    marginTop: 4, paddingHorizontal: 16, paddingVertical: 9,
                    borderRadius: radius.pill, backgroundColor: theme.ink,
                  }}
                >
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.buttonInk }}>
                    عرض كل الأجهزة
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ paddingVertical: 20 }}>
                <ActivityIndicator color={theme.accent} />
              </View>
            ) : null
          }
        />
      )}

      {/* ── Sticky cart bar ──────────────────────────────────────── */}
      {cartHere ? (
        <View style={{ position: 'absolute', left: 14, right: 14, bottom: insets.bottom + 14 }}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Cart')}
            style={{
              backgroundColor: theme.accent, borderRadius: radius.xxl,
              paddingVertical: 14, paddingHorizontal: 18,
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
              ...shadowSoft,
            }}
          >
            {/* The count is a separate node, not "عرض السلة (3)". A Latin
                parenthetical inside an Arabic run is a bidi boundary, and
                Android was dropping the trailing "(3)" outright — a badge
                sidesteps the mixed-direction run and reads better anyway. */}
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: '#fff' }}>
                عرض السلة
              </Text>
              <View style={{
                minWidth: 22, height: 22, borderRadius: 999, paddingHorizontal: 6,
                backgroundColor: 'rgba(255,255,255,0.25)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontFamily: fonts.ltrBold, fontSize: 12.5, color: '#fff' }}>
                  {cart.count}
                </Text>
              </View>
            </View>
            <Text style={{ fontFamily: fonts.ltrBold, fontSize: 15, color: '#fff', flexShrink: 0 }}>
              {fmtIQD(cart.total)} د.ع
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function TypeChip({ active, label, onPress }: {
  active: boolean; label: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        flex: 1, paddingVertical: 8, borderRadius: radius.lg, alignItems: 'center',
        backgroundColor: active ? theme.accentSoft : theme.bg,
        borderWidth: active ? 1.5 : 1,
        borderColor: active ? theme.accent : theme.line,
      }}
    >
      <Text numberOfLines={1} style={{
        fontFamily: fonts.arBold, fontSize: 12.5,
        color: active ? theme.accentDeep : theme.ink,
      }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Chip({ active, label, count, onPress }: {
  active: boolean; label: string; count: number; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
        paddingHorizontal: 13, paddingVertical: 7, borderRadius: radius.pill,
        backgroundColor: active ? theme.ink : theme.bg,
        borderWidth: 1, borderColor: active ? theme.ink : theme.line,
      }}
    >
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 12.5,
        color: active ? theme.buttonInk : theme.ink,
      }}>
        {label}
      </Text>
      <Text style={{
        fontFamily: fonts.ltr, fontSize: 11,
        color: active ? 'rgba(245,240,230,0.7)' : theme.subtle,
      }}>
        {count}
      </Text>
    </TouchableOpacity>
  );
}

function ProductTile({ product, onPress }: { product: StoreProductCard; onPress: () => void }) {
  const multi = product.variant_count > 1;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        flex: 1, marginBottom: 10, backgroundColor: theme.surface,
        borderRadius: radius.xl, borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
      }}
    >
      <View style={{ aspectRatio: 1, backgroundColor: theme.chipBg }}>
        {product.image_path ? (
          <Img
            source={{ uri: fullImageUrl(product.image_path) }}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <IconBox size={26} color={theme.subtle} sw={1.4} />
          </View>
        )}
        {multi ? (
          <View style={{
            position: 'absolute', top: 7, left: 7,
            backgroundColor: 'rgba(27,26,24,0.82)', borderRadius: radius.pill,
            paddingHorizontal: 8, paddingVertical: 3,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 10, color: '#fff' }}>
              {product.variant_count} خيارات
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ padding: 10, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right' }}
        >
          {product.brand}
        </Text>
        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.arBold, fontSize: 13.5,
            color: theme.ink, textAlign: 'right', lineHeight: 18,
          }}
        >
          {product.model}
        </Text>
        {/* A range, not a single figure — the tile must not promise the 64GB
            price and then open on a 512GB one. */}
        {product.price_on_request ? (
          // No number at all rather than a placeholder one — showing a price
          // the shop hasn't set is how a customer arrives expecting to pay it.
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.subtle, textAlign: 'right' }}
          >
            السعر عند الطلب
          </Text>
        ) : (
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.ltrBold, fontSize: 13.5, color: theme.accentDeep, textAlign: 'right' }}
          >
            {multi && product.max_price !== product.min_price
              ? `${fmtIQD(product.min_price)} – ${fmtIQD(product.max_price)}`
              : fmtIQD(product.min_price)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function GridSkeleton() {
  return (
    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', paddingHorizontal: 14, paddingTop: 10, gap: 10 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View
          key={i}
          style={{
            width: '47.5%', backgroundColor: theme.surface, borderRadius: radius.xl,
            borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
          }}
        >
          <SkBlock w="100%" h={150} r={0} />
          <View style={{ padding: 10, gap: 6 }}>
            <SkBlock w={50} h={9} />
            <SkBlock w="80%" h={12} />
            <SkBlock w={70} h={12} />
          </View>
        </View>
      ))}
    </View>
  );
}
