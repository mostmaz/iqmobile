// Shop page — the shop's profile + price-list images + contact methods + its
// listings. Reached from the Shops directory (and from any listing whose
// seller is a shop). Contact is call (one button per public number) / WhatsApp
// / Facebook / Instagram. Price-list images open full-screen (swipeable).

import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, TextInput, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Img } from '../../components/Img';
import { Btn, fmtIQD } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { AddToCartRow } from '../../components/AddToCartRow';
import { useCart } from '../../lib/cart';
import { ShopScreenSkeleton } from '../../components/Skeleton';
import { FullScreenGallery } from '../../components/FullScreenGallery';
import { BrandListModal } from '../../components/BrandListModal';
import {
  IconStar, IconPin, IconSpark, IconArrowLeft, IconMsgCall, IconPlus,
  IconSearch, IconClose, IconChevronDown,
} from '../../components/icons';
import { Shops } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { arOf } from '../../lib/governorates';
import { callPhone, openWhatsApp } from '../../lib/contact';
import { useAuth } from '../../auth/AuthContext';

export default function ShopScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const id: number = route.params?.id;
  const { data: shop, isLoading } = useQuery({ queryKey: ['shop', id], queryFn: () => Shops.get(id) });
  // The shop IS a user account (seller_type='shop'), so ownership is a
  // simple id match. Owners get a post-device CTA right on their shop page;
  // the new listing shows up here automatically (shop listings are just
  // their marketplace listings).
  const isOwner = !!user && user.id === id;
  // Storefront mode (users.shop_orders_enabled). Owners keep the normal
  // seller view — you don't order from your own shop.
  const cart = useCart();
  const storefront = !!(shop as any)?.orders_enabled && !isOwner;

  // An order-taking shop is browsed as a store, not as a seller profile —
  // product grid, options, checkout. Redirecting here rather than at each
  // call site means every route in (shops directory, a listing's seller link,
  // a banner, a deep link) lands on the store. `replace` keeps Back going to
  // wherever they came from instead of bouncing through this screen.
  React.useEffect(() => {
    if (storefront) navigation.replace('StoreHome', { id });
  }, [storefront, id, navigation]);
  // Full-screen price-image viewer (index of the tapped image, or null).
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  // Brand filter. null = الكل. Declared before the early return below so the
  // hook order stays stable across the loading render.
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Brands present in THIS shop's inventory, most-stocked first. Derived from
  // the listings we already have rather than the global brand catalogue, so a
  // brand can never filter to nothing.
  const allListings: any[] = (shop as any)?.listings || [];
  const brandCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const l of allListings) if (l?.brand) m.set(l.brand, (m.get(l.brand) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [allListings]);
  const visibleListings = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allListings.filter((l) => {
      if (brandFilter && l.brand !== brandFilter) return false;
      if (!q) return true;
      // Match brand and model together so "xiaomi poco" works as one query.
      return `${l.brand || ''} ${l.model || ''}`.toLowerCase().includes(q);
    });
  }, [allListings, brandFilter, search]);

  // Skeleton (not a centered spinner) so the shop page keeps its shape
  // while loading — header card, contact buttons, then its listings —
  // and the back bar stays tappable instead of the whole screen going
  // blank behind a spinner.
  if (isLoading || !shop) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 6, flexDirection: 'row-reverse' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }} activeOpacity={0.6}>
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
            </View>
          </TouchableOpacity>
        </View>
        <ShopScreenSkeleton />
      </View>
    );
  }

  const logo = shop.shop_image_path || shop.profile_image_path;
  const initial = (shop.shop_name || shop.display_name || '?').trim()[0] || '?';
  // Prefer the explicit list; fall back to the legacy single number.
  const phones = shop.shop_phones && shop.shop_phones.length
    ? shop.shop_phones
    : (shop.shop_phone ? [shop.shop_phone] : []);
  const whatsapp = shop.shop_whatsapp || shop.shop_phone || null;
  const images = shop.shop_images || [];

  const openUrl = (url?: string | null) => { if (url) Linking.openURL(url).catch(() => {}); };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Back bar */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 6, flexDirection: 'row-reverse' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }} activeOpacity={0.6}>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
          </View>
        </TouchableOpacity>
      </View>

      {storefront && cart.count > 0 && cart.shop_id === shop.id ? (
        <View style={{
          position: 'absolute', left: 16, right: 16, bottom: 12, zIndex: 20,
        }}>
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
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
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
            <Text style={{ fontFamily: fonts.ltrBold, fontSize: 15, color: '#fff' }}>
              {fmtIQD(cart.total)} د.ع
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={visibleListings}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        renderItem={({ item }) => (
          <View style={{ marginBottom: storefront ? 8 : 0 }}>
            <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
            {/* Storefront shops get add-to-cart under each card. A sold or
                reserved device can't be ordered, so the row is only offered
                on active ones. */}
            {storefront && item.status === 'active' ? (
              <AddToCartRow
                listing={item}
                shop={{ id: shop.id, name: shop.shop_name || shop.display_name, shipping_fee: shop.shipping_fee || 0 }}
              />
            ) : null}
          </View>
        )}
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            {/* Shop header card */}
            <View style={{
              backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
              borderColor: shop.is_featured ? theme.accent : theme.line, ...shadowSoft,
              padding: 16, marginBottom: 14,
            }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 68, height: 68, borderRadius: 18, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {logo ? (
                    <Img source={{ uri: fullImageUrl(logo) }} style={{ width: 68, height: 68 }} />
                  ) : (
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 28, color: theme.subtle }}>{initial}</Text>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 19, color: theme.ink, textAlign: 'right', flexShrink: 1 }}>
                      {shop.shop_name}
                    </Text>
                    {shop.is_featured ? (
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 2, backgroundColor: theme.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
                        <IconSpark size={9} color="#fff" />
                        <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 9 }}>مميّز</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 5 }}>
                    <IconPin size={12} color={theme.subtle} />
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
                      {arOf(shop.governorate)}{shop.city ? ` · ${shop.city}` : ''}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 5 }}>
                    <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>{shop.listing_count} إعلان</Text>
                    {shop.rating_count > 0 && Number.isFinite(shop.rating_avg as any) ? (
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}>
                        <IconStar size={12} filled color={theme.accent} />
                        <Text style={{ fontFamily: fonts.ltr, fontSize: 12, color: theme.subtle }}>
                          {Number(shop.rating_avg).toFixed(1)} · {shop.rating_count}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>

              {shop.shop_bio ? (
                <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right', marginTop: 12, lineHeight: 22 }}>
                  {shop.shop_bio}
                </Text>
              ) : null}
              {shop.shop_address ? (
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <IconPin size={13} color={theme.subtle} />
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', flex: 1 }}>{shop.shop_address}</Text>
                </View>
              ) : null}

              {/* Contact — hidden on your own shop (you don't call yourself);
                  owners get the post-device CTA instead. One call button per
                  public number, then WhatsApp, then Facebook / Instagram. */}
              {/* A storefront takes orders in-app, so the call/WhatsApp block is
                  replaced by the cart flow — offering both would leave the
                  customer guessing which one actually places an order. */}
              {!isOwner && !storefront ? (
                <View style={{ marginTop: 14, gap: 8 }}>
                  {phones.map((p) => (
                    <Btn key={p} kind="primary" full onPress={() => callPhone(p)}>
                      <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15 }}>
                        اتصال · <Text style={{ fontFamily: fonts.ltr }}>{p}</Text>
                      </Text>
                    </Btn>
                  ))}
                  {whatsapp ? (
                    <Btn kind="success" full onPress={() => openWhatsApp(whatsapp, `مرحباً، أتواصل معك من تطبيق iQ بخصوص متجر ${shop.shop_name}`)}>
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                        <IconMsgCall size={16} color="#fff" />
                        <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15 }}>واتساب</Text>
                      </View>
                    </Btn>
                  ) : null}
                  {shop.shop_facebook || shop.shop_instagram ? (
                    <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                      {shop.shop_facebook ? (
                        <SocialButton label="فيسبوك" bg="#1877F2" onPress={() => openUrl(shop.shop_facebook)} />
                      ) : null}
                      {shop.shop_instagram ? (
                        <SocialButton label="انستغرام" bg="#C13584" onPress={() => openUrl(shop.shop_instagram)} />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Owner CTA: post a device from inside the shop page. Routes
                  to the Sell tab (fresh wizard via its tabPress reset); the
                  published listing appears in this shop page automatically. */}
              {isOwner ? (
                <View style={{ marginTop: 14 }}>
                  <Btn kind="accent" full onPress={() => (navigation as any).getParent()?.navigate('Sell')}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <IconPlus size={17} color="#fff" sw={2} />
                      <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15 }}>
                        أضف جهازاً وسعره إلى متجرك
                      </Text>
                    </View>
                  </Btn>
                </View>
              ) : null}
            </View>

            {/* Price-list images — tap to open full-screen (swipe between). */}
            {images.length ? (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right', marginBottom: 10 }}>
                  قائمة الأسعار
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row-reverse' }}>
                  {images.map((im, i) => (
                    <TouchableOpacity key={im.id} activeOpacity={0.85} onPress={() => setViewerIdx(i)} style={{ marginLeft: 10 }}>
                      <Img
                        source={{ uri: fullImageUrl(im.image_path) }}
                        style={{ width: 116, height: 158, borderRadius: 14, backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.line }}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right', marginBottom: 10 }}>
              إعلانات المتجر
            </Text>

            {/* Search + brand filter. Both replaced a wrapped pill grid: with
                nine brands the pills sprawled over three lines, and as a
                single scrolling rail the later ones were off-screen entirely.
                A one-line summary that opens a list avoids both. */}
            <View style={{ flexDirection: 'row-reverse', gap: 8, paddingBottom: 12 }}>
              <View style={{
                flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg,
                backgroundColor: theme.surface, paddingHorizontal: 12, paddingVertical: 10,
              }}>
                <IconSearch size={16} color={theme.subtle} sw={1.8} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="ابحث في إعلانات المتجر…"
                  placeholderTextColor={theme.subtle}
                  style={{ flex: 1, fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right', padding: 0 }}
                />
                {search ? (
                  <TouchableOpacity onPress={() => setSearch('')} activeOpacity={0.7}>
                    <IconClose size={16} color={theme.subtle} sw={1.8} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {brandCounts.length > 1 ? (
                <TouchableOpacity
                  onPress={() => setBrandPickerOpen(true)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
                    borderWidth: 1, borderRadius: radius.lg,
                    borderColor: brandFilter ? theme.ink : theme.line,
                    backgroundColor: brandFilter ? theme.ink : theme.surface,
                    paddingHorizontal: 12, paddingVertical: 10,
                  }}
                >
                  <Text style={{
                    fontFamily: fonts.arBold, fontSize: 13,
                    color: brandFilter ? '#fff' : theme.ink }}>
                    {brandFilter ?? 'كل الماركات'}
                  </Text>
                  <IconChevronDown size={15} color={brandFilter ? '#fff' : theme.subtle} sw={1.8} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Result count, so a filter that hides most of the shop is
                visibly a filter and not an empty catalogue. */}
            {(brandFilter || search.trim()) ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', paddingBottom: 10 }}>
                {visibleListings.length} من {allListings.length}
              </Text>
            ) : null}

            <BrandListModal
              visible={brandPickerOpen}
              title="اختر الماركة"
              brands={[
                { name: '', label: 'كل الماركات', count: allListings.length },
                ...brandCounts.map(([b, n]: [string, number]) => ({ name: b, count: n })),
              ]}
              value={brandFilter}
              onClose={() => setBrandPickerOpen(false)}
              onSelect={(b) => setBrandFilter(b)}
            />
          </View>
        }
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 13, textAlign: 'center', lineHeight: 22 }}>
              {isOwner ? 'لا توجد إعلانات بعد — أضف أول جهاز لمتجرك من الزر أعلاه.' : 'لا توجد إعلانات حالياً.'}
            </Text>
          </View>
        }
      />

      {/* Full-screen price-image viewer */}
      {viewerIdx != null && images.length > 0 ? (
        <FullScreenGallery images={images} startIndex={viewerIdx} onClose={() => setViewerIdx(null)} />
      ) : null}
    </View>
  );
}

function SocialButton({ label, bg, onPress }: { label: string; bg: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flex: 1, height: 44, borderRadius: radius.lg, backgroundColor: bg,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 14 }}>{label}</Text>
    </TouchableOpacity>
  );
}
