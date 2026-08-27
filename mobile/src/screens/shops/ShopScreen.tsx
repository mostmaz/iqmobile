// Shop page — visitor + owner views (design_handoff_shops §C, layout 3a/3b).
// The page leads with identity + trust badges, then the price-list strip,
// then search + brand filter over a TWO-COLUMN device grid. Contact moved
// from stacked full-width buttons (which pushed the merchandise below the
// fold) into a sticky bottom bar: اتصال · واتساب · overflow (extra numbers,
// Facebook, Instagram). Owners get متجري + تعديل, an add-device CTA, and no
// contact bar. Storefront shops (orders_enabled) still redirect to the
// store experience — nothing here renders for them beyond one frame.

import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, Linking, Share, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT } from '../../theme';
import { Img } from '../../components/Img';
import { fmtIQD } from '../../components/ui';
import { ShopScreenSkeleton } from '../../components/Skeleton';
import { FullScreenGallery } from '../../components/FullScreenGallery';
import { BrandListModal } from '../../components/BrandListModal';
import {
  IconStar, IconPin, IconSpark, IconArrowLeft, IconMsgCall, IconPlus,
  IconSearch, IconClose, IconChevronDown, IconShare, IconChat, IconPhoneIcon,
} from '../../components/icons';
import { Shops, Chats } from '../../api/endpoints';
import { useCart } from '../../lib/cart';
import { fullImageUrl } from '../../api/upload';
import { arOf } from '../../lib/governorates';
import { callPhone, openWhatsApp } from '../../lib/contact';
import { useAuth } from '../../auth/AuthContext';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);
const DAY_MS = 86400000;

export default function ShopScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const id: number = route.params?.id;
  const { data: shop, isLoading } = useQuery({ queryKey: ['shop', id], queryFn: () => Shops.get(id) });
  const isOwner = !!user && user.id === id;
  // Orders on = this shop sells in-app. Only the HOUSE storefront gets the
  // dedicated store experience; every other shop keeps this page — contact
  // (call/WhatsApp/chat) stays, and add-to-cart appears on its devices.
  const ordersOn = !!(shop as any)?.orders_enabled && !isOwner;
  const storefront = ordersOn && !!(shop as any)?.is_house;
  const codEnabled = ((shop as any)?.cod_enabled ?? true) !== false;
  const cart = useCart();

  React.useEffect(() => {
    if (storefront) navigation.replace('StoreHome', { id });
  }, [storefront, id, navigation]);

  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [chatStarting, setChatStarting] = useState(false);

  // Chat binds to the shop's newest active listing (chats are per-listing);
  // operators see which device the buyer opened it from.
  async function startShopChat() {
    const target = ((shop as any)?.listings || []).find((l: any) => l.status === 'active')?.id
      ?? ((shop as any)?.listings || [])[0]?.id;
    if (!target || chatStarting) return;
    setChatStarting(true);
    try {
      const chat = await Chats.startForListing(target);
      (navigation as any).getParent()?.navigate('Chats', { screen: 'Chat', params: { id: chat.id } });
    } catch {}
    setChatStarting(false);
  }

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
      return `${l.brand || ''} ${l.model || ''}`.toLowerCase().includes(q);
    });
  }, [allListings, brandFilter, search]);

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
  // Channels the shop actually answers on. A missing payload (older server)
  // means all three, which is what every shop had before the setting existed.
  const ch = (shop as any).channels || { call: true, whatsapp: true, chat: true };
  const allPhones = shop.shop_phones && shop.shop_phones.length
    ? shop.shop_phones
    : (shop.shop_phone ? [shop.shop_phone] : []);
  const phones = ch.call ? allPhones : [];
  const whatsapp = ch.whatsapp ? (shop.shop_whatsapp || shop.shop_phone || null) : null;
  const images = shop.shop_images || [];
  const extraPhones = phones.slice(1);
  const hasOverflow = extraPhones.length > 0 || !!shop.shop_facebook || !!shop.shop_instagram;

  // Directory enrichment rides ShopDetail (same server card).
  const now = Date.now();
  const activeCount = (shop as any).active_count ?? allListings.filter((l) => l.status === 'active').length;
  const lastPosted = (shop as any).last_posted_at ?? null;
  const newToday = (shop as any).new_today_count ?? 0;
  const replyRate = (shop as any).reply_rate ?? null;
  const recent = !!(lastPosted && now - lastPosted <= 7 * DAY_MS);
  const idleDays = lastPosted ? Math.floor((now - lastPosted) / DAY_MS) : null;
  // Server-decided, positive only (min 5 conversations) — the raw median is
  // deliberately not read here, so no "slow" badge can be derived from it.
  const replyBadge = (shop as any).reply_badge ?? null;

  const openUrl = (url?: string | null) => { if (url) Linking.openURL(url).catch(() => {}); };
  const shareShop = () => {
    Share.share({ message: `متجر ${shop.shop_name} على iQ Mobile\nhttps://iqmobile.org/shop/${shop.id}` }).catch(() => {});
  };

  // Price-list strip: 3 clear tiles + a 4th carrying "+N" for the rest.
  const clearTiles = images.length > 4 ? 3 : Math.min(images.length, 4);
  const overflowCount = images.length - clearTiles;

  const contactBar = !isOwner && (phones.length || whatsapp || (ch.chat && allListings.length > 0));

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* ── Back bar: arrow · shop name · share ─────────────────── */}
      <View style={{
        paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 6,
        flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
      }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }} activeOpacity={0.6}>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
          </View>
        </TouchableOpacity>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'right' }}>
          {isOwner ? 'متجري' : shop.shop_name}
        </Text>
        {isOwner ? (
          <TouchableOpacity onPress={() => navigation.navigate('ShopRegister')} hitSlop={8} style={{ padding: 6 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.accentDeep }}>تعديل</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={shareShop} hitSlop={8} style={{ padding: 6 }} accessibilityLabel="مشاركة المتجر">
            <IconShare size={19} color={theme.ink} sw={1.8} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={visibleListings}
        keyExtractor={(l) => String(l.id)}
        numColumns={2}
        columnWrapperStyle={{ flexDirection: 'row-reverse', gap: 10 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: contactBar ? 130 : 90 }}
        renderItem={({ item }) => (
          <GridCard
            listing={item}
            onPress={() => navigation.navigate('ListingDetail', { id: item.id })}
            onAddToCart={ordersOn && item.status === 'active' ? () => {
              cart.add(
                {
                  id: shop.id, name: shop.shop_name || shop.display_name,
                  shipping_fee: (shop as any).shipping_fee || 0,
                  cod_enabled: codEnabled,
                },
                {
                  listing_id: item.id, brand: item.brand, model: item.model,
                  storage: item.storage ?? null, color: item.color ?? null,
                  image_path: item.images?.[0]?.image_path ?? null,
                  unit_price: item.asking_price,
                },
                1,
              );
            } : undefined}
          />
        )}
        ListHeaderComponent={
          <View style={{ marginBottom: 4 }}>
            {/* ── Identity card ───────────────────────────────────── */}
            <View style={{
              backgroundColor: theme.surface, borderRadius: 20, borderWidth: 1,
              borderColor: shop.is_featured ? theme.accent : theme.line, ...shadowSoft,
              padding: 13, marginBottom: 12,
            }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {logo ? (
                    <Img source={{ uri: fullImageUrl(logo) }} style={{ width: 56, height: 56 }} />
                  ) : (
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 24, color: theme.subtle }}>{initial}</Text>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right', flexShrink: 1 }}>
                      {shop.shop_name}
                    </Text>
                    {shop.is_featured ? (
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 2, backgroundColor: theme.accent, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                        <IconSpark size={9} color="#fff" />
                        <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 9.5 }}>مميّز</Text>
                      </View>
                    ) : null}
                  </View>
                  {/* ONE meta line: rating · stock · place */}
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 9, marginTop: 5 }}>
                    {shop.rating_count > 0 && Number.isFinite(shop.rating_avg as any) ? (
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}>
                        <IconStar size={12} filled color={theme.accent} />
                        <Text style={{ fontFamily: fonts.ltrBold, fontSize: 12, color: theme.ink }}>
                          {Number(shop.rating_avg).toFixed(1)}
                        </Text>
                        <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>· {arNum(shop.rating_count)}</Text>
                      </View>
                    ) : null}
                    <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
                      {arNum(activeCount)} جهاز
                    </Text>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3, flexShrink: 1 }}>
                      <IconPin size={11} color={theme.subtle} />
                      <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                        {arOf(shop.governorate)}{shop.city ? ` · ${shop.city}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Trust badges */}
              {(newToday > 0 || replyBadge || !recent || (shop as any).delivery_available === true) ? (
                <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {newToday > 0 ? (
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: theme.successSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: theme.success }} />
                      <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.success }}>
                        {newToday === 1 ? 'جهاز جديد اليوم' : `${arNum(newToday)} أجهزة جديدة اليوم`}
                      </Text>
                    </View>
                  ) : null}
                  {(shop as any).delivery_available === true ? (
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: theme.successSoft }}>
                      <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.success }}>
                        توصيل متوفر
                      </Text>
                    </View>
                  ) : null}
                  {replyBadge ? (
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: theme.chipBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}>
                      <IconChat size={11} color={theme.chipInk} sw={1.8} />
                      <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.chipInk }}>
                        {replyBadge === 'fast' ? 'يرد بسرعة' : 'يرد بنفس اليوم'}{replyRate != null ? ` · ${arNum(replyRate)}٪` : ''}
                      </Text>
                    </View>
                  ) : null}
                  {!recent && activeCount > 0 ? (
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(27,26,24,0.14)' }}>
                      <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>
                        {idleDays == null ? 'لم ينشر بعد' : `لم ينشر منذ ${arNum(idleDays)} يوم`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Owner CTA */}
              {isOwner ? (
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={() => (navigation as any).getParent()?.navigate('Sell')}
                  style={{
                    marginTop: 12, height: 48, borderRadius: 14, backgroundColor: theme.accent,
                    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <IconPlus size={17} color="#fff" sw={2} />
                  <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15 }}>
                    أضف جهازاً وسعره إلى متجرك
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Bio + address — below the fold-critical card, only when set. */}
            {shop.shop_bio ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 21, marginBottom: 10 }}>
                {shop.shop_bio}
              </Text>
            ) : null}
            {shop.shop_address ? (
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <IconPin size={13} color={theme.subtle} />
                <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', flex: 1 }}>{shop.shop_address}</Text>
              </View>
            ) : null}

            {/* ── قائمة الأسعار ────────────────────────────────────── */}
            {(images.length || isOwner) ? (
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>قائمة الأسعار</Text>
                  {isOwner ? (
                    <TouchableOpacity onPress={() => navigation.navigate('ShopRegister')} hitSlop={8}>
                      <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.accentDeep }}>أضف صورة</Text>
                    </TouchableOpacity>
                  ) : images.length ? (
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: theme.accentDeep }}>
                      {arNum(images.length)} صور
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                  {images.slice(0, clearTiles).map((im, i) => (
                    <TouchableOpacity key={im.id} activeOpacity={0.85} onPress={() => setViewerIdx(i)}>
                      <Img
                        source={{ uri: fullImageUrl(im.image_path) }}
                        style={{ width: 82, height: 100, borderRadius: 12, backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.line }}
                      />
                    </TouchableOpacity>
                  ))}
                  {overflowCount > 0 ? (
                    <TouchableOpacity activeOpacity={0.85} onPress={() => setViewerIdx(clearTiles)}>
                      <View style={{ width: 82, height: 100, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.line }}>
                        <Img source={{ uri: fullImageUrl(images[clearTiles].image_path) }} style={{ width: 82, height: 100 }} />
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(27,26,24,0.62)', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.surface }}>+{arNum(overflowCount)}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ) : null}
                  {isOwner && !images.length ? (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => navigation.navigate('ShopRegister')}
                      style={{
                        width: 82, height: 100, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed',
                        borderColor: 'rgba(27,26,24,0.22)', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <IconPlus size={20} color={theme.subtle} sw={2} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* ── أجهزة المتجر ─────────────────────────────────────── */}
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>أجهزة المتجر</Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
                {arNum(allListings.length)} جهاز
              </Text>
            </View>

            <View style={{ flexDirection: 'row-reverse', gap: 8, paddingBottom: 12 }}>
              <View style={{
                flex: 1, height: 44, flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                borderWidth: 1, borderColor: 'rgba(27,26,24,0.09)', borderRadius: 12,
                backgroundColor: theme.surface, paddingHorizontal: 12,
              }}>
                <IconSearch size={16} color={theme.subtle} sw={1.8} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="ابحث في أجهزة المتجر…"
                  placeholderTextColor="rgba(90,86,79,0.45)"
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
                    height: 44, flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
                    borderWidth: 1, borderRadius: 12,
                    borderColor: brandFilter ? theme.ink : 'rgba(27,26,24,0.09)',
                    backgroundColor: brandFilter ? theme.ink : theme.surface,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: brandFilter ? '#fff' : theme.ink }}>
                    {brandFilter ?? 'كل الماركات'}
                  </Text>
                  <IconChevronDown size={15} color={brandFilter ? '#fff' : theme.subtle} sw={1.8} />
                </TouchableOpacity>
              ) : null}
            </View>

            {(brandFilter || search.trim()) ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', paddingBottom: 10 }}>
                {arNum(visibleListings.length)} من {arNum(allListings.length)}
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
          isOwner ? (
            <View style={{ backgroundColor: theme.surface, borderRadius: 20, paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' }}>
              <View style={{ width: 60, height: 60, borderRadius: 999, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center' }}>
                <IconPhoneIcon size={28} color={theme.subtle} sw={1.6} />
              </View>
              <Text style={{ marginTop: 12, fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>
                لا توجد إعلانات بعد
              </Text>
              <Text style={{ marginTop: 5, fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'center', lineHeight: 21 }}>
                أضف أول جهاز وسعره — يشاهد الزبون بضاعتك قبل زيارة المتجر
              </Text>
            </View>
          ) : (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 13, textAlign: 'center', lineHeight: 22 }}>
                لا توجد إعلانات حالياً.
              </Text>
            </View>
          )
        }
      />

      {/* Cart bar — floats above the contact bar while this shop's cart
          has items. 12pt above the contact bar (or the screen edge). */}
      {ordersOn && cart.count > 0 && cart.shop_id === shop.id ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: (contactBar ? insets.bottom + 78 : 12), zIndex: 20 }}>
          {!codEnabled ? (
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'center', marginBottom: 6 }}>
              الدفع يُتفق عليه مع المتجر بعد الطلب
            </Text>
          ) : null}
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
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: '#fff' }}>عرض السلة</Text>
              <View style={{ minWidth: 22, height: 22, borderRadius: 999, paddingHorizontal: 6, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.ltrBold, fontSize: 12.5, color: '#fff' }}>{cart.count}</Text>
              </View>
            </View>
            <Text style={{ fontFamily: fonts.ltrBold, fontSize: 15, color: '#fff' }}>{fmtIQD(cart.total)} د.ع</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Sticky contact bar ──────────────────────────────────── */}
      {contactBar ? (
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.line,
          paddingTop: 10, paddingHorizontal: 16, paddingBottom: insets.bottom + 10,
          flexDirection: 'row-reverse', gap: 8,
        }}>
          {phones.length ? (
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => callPhone(phones[0])}
              style={{
                flex: 1, height: 48, borderRadius: 14, backgroundColor: theme.accent,
                flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}
            >
              <IconPhoneIcon size={17} color="#fff" sw={1.9} />
              <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15 }}>اتصال</Text>
            </TouchableOpacity>
          ) : null}
          {whatsapp ? (
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => openWhatsApp(whatsapp, `مرحباً، أتواصل معك من تطبيق iQ بخصوص متجر ${shop.shop_name}`)}
              style={{
                flex: 1, height: 48, borderRadius: 14, backgroundColor: theme.success,
                flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}
            >
              <IconMsgCall size={17} color="#fff" sw={1.9} />
              <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15 }}>واتساب</Text>
            </TouchableOpacity>
          ) : null}
          {ch.chat && allListings.length ? (
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={chatStarting}
              onPress={startShopChat}
              accessibilityLabel="محادثة المتجر"
              style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center', opacity: chatStarting ? 0.6 : 1 }}
            >
              <IconChat size={19} color={theme.buttonInk} sw={1.8} />
            </TouchableOpacity>
          ) : null}
          {hasOverflow ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setMoreOpen(true)}
              accessibilityLabel="خيارات تواصل إضافية"
              style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, marginTop: -8 }}>…</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Overflow contact sheet */}
      <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={() => setMoreOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setMoreOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(27,26,24,0.45)' }} />
        <View style={{
          backgroundColor: theme.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          paddingHorizontal: 18, paddingTop: 8, paddingBottom: insets.bottom + 18,
        }}>
          <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: 'rgba(27,26,24,0.18)', marginBottom: 12 }} />
          {extraPhones.map((p) => (
            <SheetRow key={p} label={`اتصال · ${p}`} onPress={() => { setMoreOpen(false); callPhone(p); }} />
          ))}
          {shop.shop_facebook ? (
            <SheetRow label="فيسبوك" onPress={() => { setMoreOpen(false); openUrl(shop.shop_facebook); }} />
          ) : null}
          {shop.shop_instagram ? (
            <SheetRow label="انستغرام" onPress={() => { setMoreOpen(false); openUrl(shop.shop_instagram); }} />
          ) : null}
        </View>
      </Modal>

      {viewerIdx != null && images.length > 0 ? (
        <FullScreenGallery images={images} startIndex={viewerIdx} onClose={() => setViewerIdx(null)} />
      ) : null}
    </View>
  );
}

// Two-column device card: image → model → price → condition pill.
function GridCard({ listing, onPress, onAddToCart }: { listing: any; onPress: () => void; onAddToCart?: () => void }) {
  const cover = listing.images?.[0]?.image_path || null;
  const isNew = listing.condition === 'new';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      flex: 1, backgroundColor: theme.surface, borderRadius: 16, overflow: 'hidden',
      borderWidth: 1, borderColor: theme.line, marginBottom: 10,
    }}>
      <View style={{ height: 104, backgroundColor: theme.chipBg }}>
        {cover ? (
          <Img source={{ uri: fullImageUrl(cover) }} contentFit="cover" style={{ width: '100%', height: '100%' }} />
        ) : null}
      </View>
      <View style={{ paddingTop: 9, paddingHorizontal: 10, paddingBottom: 11 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
          {listing.brand} {listing.model}
        </Text>
        <Text numberOfLines={1} style={{ marginTop: 3, fontFamily: fonts.ltrBold, fontSize: 14, color: theme.accentDeep, textAlign: 'right' }}>
          {fmtIQD(listing.asking_price)} <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
        </Text>
        <View style={{ flexDirection: 'row-reverse', marginTop: 6, alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{
            paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999,
            backgroundColor: isNew ? theme.successSoft : theme.chipBg,
          }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 10.5, color: isNew ? theme.success : theme.chipInk }}>
              {isNew ? 'جديد' : 'مستعمل'}
            </Text>
          </View>
          {onAddToCart ? (
            <TouchableOpacity
              onPress={onAddToCart}
              hitSlop={8}
              accessibilityLabel="أضف للسلة"
              style={{ width: 28, height: 28, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <IconPlus size={15} color="#fff" sw={2.2} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function SheetRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{
      paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.line,
    }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ink, textAlign: 'right' }}>{label}</Text>
    </TouchableOpacity>
  );
}
