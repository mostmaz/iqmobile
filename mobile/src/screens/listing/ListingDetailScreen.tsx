import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, Dimensions, Modal, Animated, Share,
} from 'react-native';
import { Img } from '../../components/Img';
import { DeviceSpecs } from '../../components/DeviceSpecs';
import { CompareTray } from '../../components/CompareTray';
import { deviceTitle, ltrNum } from '../../lib/format';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Btn, Card, fmtIQD } from '../../components/ui';
import { IconStar, IconPin, IconArrowLeft, IconShare, IconBookmark, IconPhoneIcon, IconMsgCall, IconChat, IconSpark, IconChevronLeft, IconBell, IconLock, IconCompare } from '../../components/icons';
import { useCompare, COMPARE_MAX } from '../../lib/compare';
import { ChipTag, SpecRow } from '../../components/marketplace';
import { ListingDetailSkeleton } from '../../components/Skeleton';
import { Listings, Reports, Chats, PriceWatches } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { FullScreenGallery } from '../../components/FullScreenGallery';
import { ar } from '../../i18n/ar';
import { arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';
import { callPhone, openWhatsApp } from '../../lib/contact';
import { useTrack } from '../../analytics/track';
import { logMetaEvent } from '../../analytics/meta';
import { SHOW_PROMOTE } from '../../config/flags';
import { useTabBarClearance } from '../../lib/tabBarClearance';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

export default function ListingDetailScreen({ route, navigation }: any) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  // Compare shortlist. Capped, so a full list has to say so rather than
  // silently ignoring the tap.
  const compare = useCompare();
  const inCompare = compare.has(id);
  const onCompareTap = () => {
    const { ok } = compare.toggle({
      id,
      brand: data?.brand,
      model: data?.model,
      image_path: data?.images?.[0]?.image_path ?? null,
    });
    if (!ok) {
      Alert.alert('القائمة ممتلئة', `تكدر تقارن ${COMPARE_MAX} أجهزة بالمرة — شيل واحد وجرب.`);
    }
  };
  const tabClearance = useTabBarClearance();
  const qc = useQueryClient();
  const track = useTrack();
  const { user } = useAuth();
  const [imgIdx, setImgIdx] = useState(0);
  // Full-screen image viewer: holds the tapped image index, or null when closed.
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => Listings.get(id),
  });

  // "أجهزة مشابهة" rail — same brand, ±10% price, other sellers. Lives up
  // here with the other hooks (NOT below the loading early-return — see the
  // hooks-order note further down). Enabled only once the listing is in so
  // the two requests don't race on a cold open.
  const { data: similar } = useQuery({
    queryKey: ['similar', id],
    queryFn: () => Listings.similar(id),
    enabled: !!data,
    staleTime: 60_000,
  });

  // Fire `listing.viewed` once per detail-page visit. Keyed on the
  // listing id so re-renders don't double-count, but a fresh navigation
  // to the same listing later (different mount) does count — that's
  // the right semantic for "view" on a marketplace.
  useEffect(() => {
    if (data?.id) {
      track('listing.viewed', {
        listing_id: data.id,
        brand: data.brand,
        condition: data.condition,
        asking_price: data.asking_price,
        governorate: data.governorate,
        seller_type: data.seller?.seller_type,
      });
    }
  }, [data?.id, track]);

  // Saved-state mirror. Server tells us via `data.is_saved` on initial load
  // (always false for guests), and we mirror it locally so the bookmark
  // icon + "احفظ"/"محفوظ" button flip instantly on tap — no waiting for
  // the round-trip. Synced back to the server response when the query
  // refetches.
  const [isSaved, setIsSaved] = useState(false);
  useEffect(() => {
    if (data) setIsSaved(!!(data as any).is_saved);
  }, [data?.id, (data as any)?.is_saved]);

  // Toggle save/unsave. Anonymous users get bounced through AuthGate
  // first — without that, the mutation 401s silently and the user thinks
  // the action worked.
  const toggleSave = useMutation({
    mutationFn: () => (isSaved ? Listings.unsave(id) : Listings.save(id)),
    onMutate: () => {
      // Optimistic flip so the icon responds the instant the user taps.
      setIsSaved((v) => !v);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved'] });
      qc.invalidateQueries({ queryKey: ['listing', id] });
    },
    onError: (e: any) => {
      // Roll back the optimistic flip and surface the error.
      setIsSaved((v) => !v);
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || ar.errors.network);
    },
  });
  function onSaveTap() {
    if (!user || user.is_guest) {
      (navigation as any).getParent()?.getParent?.()?.navigate('AuthGate')
        ?? navigation.navigate('AuthGate' as never);
      return;
    }
    toggleSave.mutate();
  }

  // Price-drop watch: "نبّهني إذا انخفض السعر". Same optimistic-mirror +
  // guest-bounce pattern as save above; server state arrives as
  // data.is_price_watched.
  const [isWatched, setIsWatched] = useState(false);
  useEffect(() => {
    if (data) setIsWatched(!!(data as any).is_price_watched);
  }, [data?.id, (data as any)?.is_price_watched]);
  const toggleWatch = useMutation({
    mutationFn: () => (isWatched ? PriceWatches.unwatch(id) : PriceWatches.watch(id)),
    onMutate: () => { setIsWatched((v) => !v); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['listing', id] }),
    onError: (e: any) => {
      setIsWatched((v) => !v);
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || ar.errors.network);
    },
  });
  function onWatchTap() {
    if (!user || user.is_guest) {
      (navigation as any).getParent()?.getParent?.()?.navigate('AuthGate')
        ?? navigation.navigate('AuthGate' as never);
      return;
    }
    toggleWatch.mutate();
  }

  // "I want this device cheaper" → prefilled wish-list add. Guests bounce
  // to AuthGate (the wish list needs an account to notify).
  function onWishTap() {
    if (!user || user.is_guest) {
      (navigation as any).getParent()?.getParent?.()?.navigate('AuthGate')
        ?? navigation.navigate('AuthGate' as never);
      return;
    }
    navigation.navigate('Wishlist', { brand: data?.brand, model: data?.model, price: data?.asking_price });
  }

  // Mark-as-sold / restore mutation. Refetches the listing after the toggle,
  // also invalidates browse + mine so the grids reflect the new state. Shows
  // a clear confirmation alert so the seller knows the action took effect.
  const markSold = useMutation({
    mutationFn: (next: 'sold' | 'active') => Listings.patch(id, { status: next }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['listing', id] });
      qc.invalidateQueries({ queryKey: ['mine'] });
      qc.invalidateQueries({ queryKey: ['browse'] });
      Alert.alert(
        updated.status === 'sold' ? 'تم التحديد كمباع' : 'تم إرجاع الإعلان للمتاح',
        updated.status === 'sold'
          ? 'سيظهر الإعلان للمشترين مع علامة "مباع". يمكنك إرجاعه للمتاح في أي وقت.'
          : 'الإعلان متاح الآن للمشترين مرة أخرى.',
      );
    },
    onError: (e: any) => Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message),
  });

  // Chat-start spinner state. MUST live above the loading early-return —
  // declaring it after the `if (isLoading) return …` is a Hooks-order
  // violation that crashes the screen the moment `data` arrives ("Rendered
  // more hooks than during the previous render"). All hooks-using state
  // belongs in the unconditional prefix of the component.
  const [chatStarting, setChatStarting] = useState(false);
  // Store-chat spinner — same rule as chatStarting directly above: this was
  // declared BELOW the early-return, which crashed the screen with
  // "Rendered more hooks than during the previous render" the moment data
  // arrived on a cold open (deep link, push tap — anything uncached).
  const [storeChatStarting, setStoreChatStarting] = useState(false);
  // Drives the status-bar scrim below: transparent over the hero photo, solid
  // once the page has scrolled far enough that text is passing under the
  // clock. Native-driven so it never lags the finger.
  const scrollY = React.useRef(new Animated.Value(0)).current;

  if (isLoading || !data) {
    // Skeleton mirrors the real page (320pt gallery → title/price card →
    // spec rows → contact buttons), so tapping a card from the feed lands
    // on something with the right shape immediately instead of a blank
    // screen with a spinner.
    return <ListingDetailSkeleton />;
  }

  const isMine = user?.id === data.seller_id;
  // Per-listing contact info — always public, no deal-confirmation gate.
  // A storefront answers on ONE dashboard-set support line, which replaces
  // the per-listing seller number (and outranks the shop_no_contact blanking
  // — that flag protects OTHER shops' numbers, not the storefront's own).
  const isStorefront = !!(data as any).orders_enabled;
  const storefrontPhone = (data as any).storefront_phone || null;
  const contactPhone = isStorefront
    ? storefrontPhone
    : ((data as any).contact_phone || data.seller_phone || null);
  const contactWhatsApp = isStorefront ? null : ((data as any).contact_whatsapp || null);

  // Wrap a Reports.submit() call so guests are bounced to AuthGate first,
  // failures surface as an Arabic Alert (instead of vanishing silently), and
  // success confirms the submission so the user knows the tap took effect.
  async function submitReport(reason: string) {
    if (!user || user.is_guest) {
      (navigation as any).getParent()?.getParent?.()?.navigate('AuthGate')
        ?? navigation.navigate('AuthGate' as never);
      return;
    }
    try {
      await Reports.submit('listing', id, reason);
      Alert.alert('شكراً', 'تم إرسال البلاغ. سنراجعه قريباً.');
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || ar.errors.network);
    }
  }
  // Start (or reuse) a chat thread for this listing as the buyer. Guests
  // are allowed — chat is the lowest-friction "is it available?" channel
  // and forcing AuthGate before that question is over-eager. The
  // auto-provisioned guest session already has a user row; chats land
  // under that id. When the guest later upgrades via phoneLogin, the same
  // row is promoted in-place and the chat history carries over.
  // (`chatStarting` state lives above the loading early-return — see note there.)
  async function startChat() {
    if (chatStarting) return;
    // Defense in depth: the Chat CTA is already hidden when `isMine` is
    // true (see ContactRow gating below), but a stale render, a deep-link
    // push tap, or any future code path that calls startChat without the
    // !isMine guard would still hit the server, which returns 400
    // cannot_chat_self. Catch it here so the user sees the Arabic
    // explanation immediately instead of a generic network error.
    // (Use optional-chained `data?.seller_id` because TypeScript can't
    // narrow `data` here — startChat is hoisted above the loading
    // early-return so the type at this site is still `Listing |
    // undefined`. The runtime check is a no-op once data is loaded.)
    if (user?.id && data?.seller_id && user.id === data.seller_id) {
      Alert.alert('خطأ', (ar.errors as any).cannot_chat_self);
      return;
    }
    setChatStarting(true);
    try {
      const chat = await Chats.startForListing(id);
      (navigation as any).getParent()?.navigate('Chats', { screen: 'Chat', params: { id: chat.id } });
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally {
      setChatStarting(false);
    }
  }

  // "Talk to the shop" on a price-book listing. The chat is opened on the
  // STOREFRONT'S matching listing, not this aggregator row — the aggregator
  // account answers nobody, and binding the thread to the store's own
  // listing puts it in front of the operators with the right device name
  // and the store's real price attached.
  async function startStoreChat() {
    const target = (data as any)?.store_chat;
    if (!target) return;
    setStoreChatStarting(true);
    try {
      const chat = await Chats.startForListing(target.listing_id);
      (navigation as any).getParent()?.navigate('Chats', { screen: 'Chat', params: { id: chat.id } });
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally {
      setStoreChatStarting(false);
    }
  }

  // Seller-side: jump to ChatsList filtered to this listing.
  function openBuyerChats() {
    (navigation as any).getParent()?.navigate('Chats', {
      screen: 'ChatsHome',
      params: { listing_id: id },
    });
  }

  function reportListing() {
    Alert.alert('إبلاغ عن الإعلان', '', [
      { text: 'إعلان مزيف', onPress: () => submitReport('fake_listing') },
      { text: 'مواصفات خاطئة', onPress: () => submitReport('wrong_specs') },
      { text: 'محاولة احتيال', onPress: () => submitReport('scam_attempt') },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  }

  const status = data.status;
  // Sold or expired: the listing is finished. Both stay browsable as a price
  // record but neither should route anyone to the seller.
  const isDead = status === 'sold' || status === 'expired';
  const showStatusBadge = status !== 'active';
  const statusBg = status === 'sold' ? theme.accent : theme.ink;
  const statusLabel = (ar.listing as any)[status] || status;
  // "Last known price" — a price-aggregator device that dropped off the
  // sources' lists. Grey the price + show an unavailable banner.
  const stale = !!(data as any).stale_since;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: tabClearance }}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        {/* Gallery — floating overlay buttons over the image */}
        <View style={{ position: 'relative', height: 320, backgroundColor: theme.chipBg }}>
          <ScrollView
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
          >
            {(data.images || []).length === 0 ? (
              <View style={{ width: SCREEN_W, height: 320, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.subtle, fontFamily: fonts.ar }}>لا توجد صور</Text>
              </View>
            ) : (
              (data.images || []).map((im, i) => (
                <TouchableOpacity key={im.id} activeOpacity={1} onPress={() => setViewerIdx(i)}>
                  <Img source={{ uri: fullImageUrl(im.image_path) }} style={{ width: SCREEN_W, height: 320 }} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>

          <View pointerEvents="box-none" style={{
            position: 'absolute', top: 12 + insets.top, left: 12, right: 12,
            flexDirection: 'row-reverse', justifyContent: 'space-between',
          }}>
            <FloatBtn onPress={() => navigation.goBack()}>
              <View style={{ transform: [{ scaleX: -1 }] }}><IconArrowLeft size={18} color="#fff" sw={1.7} /></View>
            </FloatBtn>
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              {/* Add to the shortlist being compared. Sits with save and
                  share because it is the same kind of act: putting this
                  listing aside to weigh later. */}
              <FloatBtn onPress={onCompareTap} active={inCompare}>
                <IconCompare size={16} color={inCompare ? theme.accent : '#fff'} sw={1.8} />
              </FloatBtn>
              <FloatBtn onPress={onSaveTap} active={isSaved}>
                <IconBookmark size={16} color={isSaved ? theme.accent : '#fff'} sw={1.7} filled={isSaved} />
              </FloatBtn>
              <FloatBtn onPress={() => {
                // Share the public web page (OG preview + deep-link back
                // into the app if installed). WhatsApp/FB groups are where
                // Iraqi phone trading actually happens, so this is free reach.
                const url = `https://iqmobile.org/l/${id}`;
                Share.share({
                  message: `${deviceTitle(data.brand, data.model)} · ${fmtIQD(data.asking_price)} د.ع\n${url}`,
                }).catch(() => {});
              }}>
                <IconShare size={16} color="#fff" sw={1.7} />
              </FloatBtn>
            </View>
          </View>

          {(data.images?.length || 0) > 1 ? (
            <View style={{
              position: 'absolute', bottom: 14, left: 0, right: 0,
              flexDirection: 'row', justifyContent: 'center', gap: 4,
            }}>
              {data.images!.map((_, i) => (
                <View key={i} style={{
                  width: i === imgIdx ? 18 : 6, height: 6, borderRadius: 3,
                  backgroundColor: i === imgIdx ? '#fff' : 'rgba(255,255,255,0.5)',
                }} />
              ))}
            </View>
          ) : null}

          {showStatusBadge ? (
            <View style={{
              position: 'absolute', top: 60 + insets.top, right: 12,
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
              backgroundColor: statusBg,
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 11, color: '#fff' }}>
                {statusLabel}
              </Text>
            </View>
          ) : null}
        </View>

        {/* title + chips + price */}
        <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
            <ChipTag>{(ar.listing as any)[data.condition]}</ChipTag>
            {data.storage ? <ChipTag>{data.storage}</ChipTag> : null}
            {data.color ? <ChipTag>{data.color}</ChipTag> : null}
          </View>

          <Text style={{ fontFamily: fonts.arBold, fontSize: 22, color: theme.ink, letterSpacing: -0.3, textAlign: 'right' }}>
            {deviceTitle(data.brand, data.model)}
          </Text>

          {stale ? (
            <View style={{
              marginTop: 10, backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.line,
              borderRadius: radius.lg ?? 12, paddingHorizontal: 12, paddingVertical: 10,
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
                غير متوفر حالياً
              </Text>
              <Text style={{ marginTop: 3, fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', lineHeight: 19 }}>
                هذا آخر سعر معروف لهذا الجهاز — لم يعد ضمن قوائم الأسعار الحالية وقد لا يكون متوفراً في السوق.
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
            <View>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle }}>
                {stale ? 'آخر سعر معروف' : 'السعر المطلوب'}
              </Text>
              <Text style={{ marginTop: 2, fontFamily: fonts.ltrBold, fontSize: 30, color: stale ? theme.subtle : theme.accentDeep, fontWeight: '700', letterSpacing: -0.5 }}>
                {fmtIQD(data.asking_price)}
                <Text style={{ fontSize: 14, color: theme.subtle, fontFamily: fonts.ar }}>  د.ع</Text>
              </Text>

              {/* What the same device costs new, at the same capacity. Sent
                  only on a confident match, so there is nothing to guard here
                  beyond its presence. The saving is omitted when the asking
                  price is at or above new — a negative "discount" would be
                  nonsense. */}
              {(data as any).new_price_ref ? (
                <View style={{ marginTop: 6, flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
                    جديد {(data as any).new_price_ref.storage}:{' '}
                    <Text style={{ fontFamily: fonts.ltr, color: theme.ink }}>
                      {fmtIQD((data as any).new_price_ref.new_price)}
                    </Text>
                    {' '}د.ع
                  </Text>
                  {(data as any).new_price_ref.saving ? (
                    <View style={{
                      backgroundColor: theme.successSoft ?? 'rgba(16,185,129,0.14)',
                      paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill,
                    }}>
                      <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.success }}>
                        {/* The number and its "%" are a single LTR run. Left
                            to the bidi algorithm inside Arabic text, the sign
                            reordered to the front and the badge read "(%16)". */}
                        توفّر {fmtIQD((data as any).new_price_ref.saving)} ({ltrNum(`${(data as any).new_price_ref.saving_pct}%`)})
                      </Text>
                    </View>
                  ) : null}
                  {/* The same device, boxed, one tap away. Server sends
                      `store` only when an orderable storefront stocks the
                      model (and never on the storefront's own listings, which
                      already carry the big buy button). */}
                  {(data as any).new_price_ref.store ? (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => navigation.navigate('StoreProduct', {
                        shopId: (data as any).new_price_ref.store.shop_id,
                        brand: (data as any).new_price_ref.store.brand,
                        model: (data as any).new_price_ref.store.model,
                      })}
                      style={{
                        backgroundColor: theme.accent, paddingHorizontal: 10,
                        paddingVertical: 4, borderRadius: radius.pill,
                      }}
                    >
                      <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: '#fff' }}>
                        اشترِ واحداً جديداً ←
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
              <IconPin size={13} color={theme.subtle} />
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                {arOf(data.governorate)}{data.city ? ` · ${data.city}` : ''}
              </Text>
            </View>
          </View>
        </View>

        {/* Contact CTAs — always available. Phone is public, WhatsApp
            shown only when the seller provided a number, in-app chat is
            always offered. Hidden on a seller's own listing. */}
        {/* Always render ContactRow for non-owners. Chat is always available;
            Call + WhatsApp render only when their backing field is set, so
            listings that opted out of a phone number still surface the chat
            entry point. */}
        {/* A storefront device found through the general feed still has to be
            buyable. Rather than bolt a second add-to-cart onto this screen,
            send the shopper to the product page, where the other capacities
            and colours of the same model are options rather than separate
            search results. */}
        {!isMine && isStorefront && data.status === 'active' ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('StoreProduct', {
                shopId: data.seller_id ?? data.seller?.id,
                brand: data.brand,
                model: data.model,
              })}
              style={{
                backgroundColor: theme.accent, borderRadius: radius.xl,
                paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: '#fff' }}>
                اشترِ من المتجر · الدفع عند الاستلام
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Review-gated listing video. Approved → everyone sees the play
            card; the owner also sees their pending clip plus the amber
            "not public yet" note. Playback hands the mp4 URL to the OS
            player — no native video dependency needed. */}
        {(data as any).video ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => require('react-native').Linking.openURL(fullImageUrl((data as any).video.path)).catch(() => {})}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
                backgroundColor: theme.surface, borderRadius: radius.xxl,
                borderWidth: 1, borderColor: theme.line, padding: 14,
              }}
            >
              <Text style={{ fontSize: 22 }}>▶️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right' }}>
                  فيديو الإعلان
                </Text>
                {isMine && (data as any).video.status === 'pending' ? (
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: '#B07A28', textAlign: 'right', marginTop: 2 }}>
                    بانتظار موافقة الإدارة — لا يظهر للمشترين بعد
                  </Text>
                ) : (
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                    اضغط للمشاهدة
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* A finished listing must not offer a way to contact the seller.
            The feed keeps sold and expired ads visible because they're a
            useful price record, but a 60-day-dead listing that renders call,
            WhatsApp and chat all live just sends people to ring sellers about
            phones that are long gone. The server already withholds the phone
            numbers; chat is client-side, so it has to be stopped here. */}
        {!isMine && isDead ? (
          <View style={{
            marginHorizontal: 16, marginTop: 14, padding: 14,
            backgroundColor: theme.chipBg, borderRadius: radius.xxl,
            borderWidth: 1, borderColor: theme.line,
            flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
          }}>
            <IconLock size={17} color={theme.subtle} sw={1.8} />
            <Text style={{
              flex: 1, fontFamily: fonts.ar, fontSize: 13,
              color: theme.subtle, textAlign: 'right', lineHeight: 20,
            }}>
              {status === 'sold'
                ? 'هذا الإعلان مباع — التواصل مع البائع مغلق.'
                : 'انتهت صلاحية هذا الإعلان ولم يعد البائع يستقبل اتصالات بشأنه.'}
            </Text>
          </View>
        ) : null}

        {/* Price-book rows are no-contact by design — the numbers on them
            belong to other shops. But when the same device is in the
            storefront's own stock, there IS someone to talk to. One button,
            styled like the storefront CTA above so it reads as the same
            shop, opening a chat the operators actually answer. */}
        {!isMine && !isDead && (data as any).store_chat ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={storeChatStarting}
              onPress={startStoreChat}
              style={{
                backgroundColor: theme.ink, borderRadius: radius.xl,
                paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
                flexDirection: 'row-reverse', gap: 8,
                opacity: storeChatStarting ? 0.6 : 1,
              }}
            >
              <IconChat size={16} color={theme.buttonInk} sw={1.8} />
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.buttonInk }}>
                تحدث مع متجر {(data as any).store_chat.shop_name} — الجهاز متوفر
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Two reasons to skip the contact row, both about the price book.
            With the store button above, ContactRow would add a SECOND chat
            button bound to the aggregator account. Without it — no shop
            stocks this device — the row's numbers are already blank, so all
            that remains is that same dead chat button. Neither is worth
            showing; the store button is the only contact that reaches a
            person. Normal listings are unaffected: both flags are
            price-book only. */}
        {!isMine && !isDead && !(data as any).store_chat && !(data as any).contact_suppressed ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <ContactRow
              phone={contactPhone}
              whatsapp={contactWhatsApp}
              listingId={data.id}
              brand={data.brand}
              sellerType={data.seller?.seller_type}
              onStartChat={startChat}
              chatStarting={chatStarting}
              storefront={isStorefront}
            />
          </View>
        ) : null}

        {/* Owner promote CTA — the highest-visibility surface for the
            featured-listing upsell: publishing a listing lands the seller
            right here, so this doubles as the post-publish prompt. Swaps to
            a "featured until" notice while a window is active; hidden on
            sold/expired listings (nothing to promote). Hidden entirely in the
            Play Store artifact (SHOW_PROMOTE=false) — see config/flags.ts. */}
        {isMine && SHOW_PROMOTE ? (
          (data as any).featured_until && (data as any).featured_until > Date.now() ? (
            <View style={{
              marginHorizontal: 16, marginTop: 14, padding: 14,
              backgroundColor: theme.successSoft, borderWidth: 1, borderColor: theme.success,
              borderRadius: radius.xxl, flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
            }}>
              <IconSpark size={18} color={theme.success} />
              <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}>
                إعلانك مميّز حتى {new Date((data as any).featured_until).toLocaleDateString('en-GB')}
              </Text>
            </View>
          ) : (data.status === 'active' || data.status === 'reserved') ? (
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => navigation.navigate('FeatureListing', { id, label: `${data.brand} ${data.model}` })}
              style={{
                marginHorizontal: 16, marginTop: 14, padding: 14,
                backgroundColor: theme.accent, borderRadius: radius.xxl,
                flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
                ...shadowSoft,
              }}
            >
              <View style={{
                width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <IconSpark size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: '#fff', textAlign: 'right' }}>
                  ميّز إعلانك
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 2, textAlign: 'right' }}>
                  اظهر في أعلى النتائج وبِع أسرع — ابتداءً من 2,000 د.ع
                </Text>
              </View>
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <IconChevronLeft size={14} color="#fff" sw={2} />
              </View>
            </TouchableOpacity>
          ) : null
        ) : null}

        {/* Seller-side CTA: jump to ChatsList filtered to this listing.
            Lets the seller see all incoming buyer conversations for a
            given listing in one tap. Hidden on guests + non-mine views. */}
        {isMine ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <Btn kind="ghost" full onPress={openBuyerChats}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <IconChat size={16} color={theme.ink} sw={1.7} />
                <Text style={{ color: theme.ink, fontFamily: fonts.arBold, fontSize: 14 }}>
                  {ar.listing.buyerChats}
                </Text>
              </View>
            </Btn>
          </View>
        ) : null}

        {/* specs card */}
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <Card style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
            {data.storage ? <SpecRow label={ar.listing.storage} value={data.storage} /> : null}
            {data.color ? <SpecRow label={ar.listing.color} value={data.color} /> : null}
            {/* Battery: hide for non-Apple listings (no value), for Apple
                listings the seller skipped, and defensively for legacy
                rows that the old server bug stored as 0 instead of null. */}
            {data.battery_health != null && data.battery_health > 0 ? (
              <SpecRow label={ar.listing.battery} value={`${data.battery_health}%`} />
            ) : null}
            {data.warranty_status ? <SpecRow label="الضمان" value={data.warranty_status} /> : null}
            {data.accessories?.length ? <SpecRow label={ar.listing.accessories} value={data.accessories.join('، ')} last /> : null}
          </Card>
        </View>

        {/* seller card */}
        {data.seller ? (
          <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
            <Card style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {/* Unified-account redesign: every seller renders the same.
                      No "shop" avatar variant, no individual/shop stamp. */}
                  <View style={{
                    width: 44, height: 44, borderRadius: 999,
                    backgroundColor: theme.chipBg,
                    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  }}>
                    {data.seller.profile_image_path ? (
                      <Img source={{ uri: fullImageUrl(data.seller.profile_image_path) }} style={{ width: 44, height: 44 }} />
                    ) : (
                      <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.chipInk }}>
                        {data.seller.display_name?.[0]}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, flexShrink: 1 }}>
                        {data.seller.display_name}
                      </Text>
                      {/* Tiny "متجر" chip when seller is a shop. */}
                      {data.seller.seller_type === 'shop' ? (
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.accentSoft }}>
                          <Text style={{ fontFamily: fonts.arBold, fontSize: 10, color: theme.accentDeep }}>متجر</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
                {/* Rating block — show only when we have BOTH a count and
                    a finite rating value. Old/malformed seller rows have
                    rating_count>0 with a null rating_avg, which would
                    crash on `.toFixed`. */}
                {data.seller.rating_count > 0 && Number.isFinite(data.seller.rating_avg as any) ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
                      <IconStar size={14} filled color={theme.accent} />
                      <Text style={{ fontFamily: fonts.ltrBold, fontSize: 14, fontWeight: '700', color: theme.ink }}>
                        {Number(data.seller.rating_avg).toFixed(1)}
                      </Text>
                    </View>
                    <Text style={{ marginTop: 2, fontFamily: fonts.ltr, fontSize: 11, color: theme.subtle }}>
                      {data.seller.rating_count} تقييم
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Shop sign image — only for shop sellers. Stretches across
                  the card under the name row. */}
              {data.seller.seller_type === 'shop' && (data.seller as any).shop_image_path ? (
                <View style={{ marginTop: 10, borderRadius: radius.md, overflow: 'hidden', backgroundColor: theme.chipBg }}>
                  <Img
                    source={{ uri: fullImageUrl((data.seller as any).shop_image_path) }}
                    style={{ width: '100%', height: 140 }}
                  />
                </View>
              ) : null}

              {/* Tappable "open in Maps" row — only when shop GPS is set. */}
              {data.seller.seller_type === 'shop' && (data.seller as any).shop_lat != null && (data.seller as any).shop_lng != null ? (
                <TouchableOpacity
                  onPress={() => {
                    const lat = (data.seller as any).shop_lat;
                    const lng = (data.seller as any).shop_lng;
                    const url = `https://maps.google.com/?q=${lat},${lng}`;
                    require('react-native').Linking.openURL(url).catch(() => {});
                  }}
                  activeOpacity={0.85}
                  style={{
                    marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md,
                    backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line,
                    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                  }}>
                  <IconPin size={14} color={theme.accent} sw={1.7} />
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink }}>
                    افتح موقع المتجر على الخريطة
                  </Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          </View>
        ) : null}

        {/* description */}
        {data.description ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginBottom: 6 }}>
              {ar.listing.description}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.ink, lineHeight: 22, textAlign: 'right' }}>
              {data.description}
            </Text>
          </View>
        ) : null}

        {/* The device's own spec sheet, right under what the seller wrote:
            the seller says what condition it is in, this says what it is.
            Renders nothing for a model we haven't mapped. */}
        <DeviceSpecs
          specs={(data as any).specs}
          seller={{
            storage: data.storage,
            color: data.color,
            battery_health: data.battery_health,
            warranty_status: data.warranty_status,
          }}
          conditionLabel={(ar.listing as any)[data.condition] || data.condition}
        />

        {/* The compare shortcut, spelled out. The icon over the photo is
            easy to miss — this is the same action with a name on it, and it
            sits just above the similar-devices rail: by here the buyer has
            read the price, the specs and the seller, which is exactly when
            "how does this compare with the other one?" becomes the question.
            Not shown on your own listing — nothing to compare against
            yourself. */}
        {!isMine ? (
          <TouchableOpacity
            onPress={onCompareTap}
            activeOpacity={0.85}
            style={{
              marginHorizontal: 16, marginTop: 10, paddingVertical: 13,
              borderRadius: radius.xl, borderWidth: 1.5,
              borderColor: theme.accent,
              backgroundColor: inCompare ? theme.accentSoft : 'transparent',
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <IconCompare size={16} color={theme.accentDeep} sw={1.8} />
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.accentDeep }}>
              {inCompare ? 'بالمقارنة ✓' : 'أضف للمقارنة'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* أجهزة مشابهة — the market around this phone: same brand, ±10%
            price, other sellers. push (not navigate) so back returns here.
            Hidden entirely when the server finds nothing comparable. */}
        {similar && similar.length > 0 ? (
          <View style={{ marginTop: 18 }}>
            <Text style={{
              fontFamily: fonts.arBold, fontSize: 11.5,
              color: theme.subtle, textAlign: 'right', paddingHorizontal: 16, marginBottom: 8,
            }}>
              أجهزة مشابهة
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10, flexDirection: 'row-reverse' }}
            >
              {similar.slice(0, 8).map((s2) => (
                <TouchableOpacity
                  key={s2.id}
                  activeOpacity={0.85}
                  onPress={() => (navigation as any).push('ListingDetail', { id: s2.id })}
                  style={{
                    width: 148, backgroundColor: theme.surface,
                    borderRadius: radius.xl, borderWidth: 1, borderColor: theme.line,
                    overflow: 'hidden',
                  }}
                >
                  {s2.images?.[0] ? (
                    <Img
                      source={{ uri: fullImageUrl(s2.images[0].image_path) }}
                      contentFit="cover"
                      style={{ width: 148, height: 110, backgroundColor: theme.chipBg }}
                    />
                  ) : (
                    <View style={{ width: 148, height: 110, backgroundColor: theme.chipBg }} />
                  )}
                  <View style={{ padding: 9 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink, textAlign: 'right' }}>
                      {deviceTitle(s2.brand, s2.model)}
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                      {[(ar.listing as any)[s2.condition], s2.storage].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={{ fontFamily: fonts.ltrBold, fontSize: 13.5, color: theme.accentDeep, textAlign: 'right', marginTop: 4 }}>
                      {(s2 as any).price_on_request ? (
                        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5 }}>السعر عند الطلب</Text>
                      ) : (
                        <>
                          {fmtIQD(s2.asking_price)}
                          <Text style={{ fontFamily: fonts.ar, fontSize: 9.5, color: theme.subtle }}> د.ع</Text>
                        </>
                      )}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* Secondary actions (chat lives in ContactRow above). */}
        <View style={{ padding: 16, gap: 10 }}>
          {!isMine ? (
            <>
              <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                <Btn kind={isSaved ? 'accent' : 'ghost'} full onPress={onSaveTap} busy={toggleSave.isPending}>
                  {isSaved ? ar.listing.saved : ar.listing.save}
                </Btn>
                <Btn kind="danger" full onPress={reportListing}>{ar.listing.report}</Btn>
              </View>
              {/* Price alerts: watch THIS listing for a drop, or wish for the
                  same device cheaper anywhere on the market. */}
              <TouchableOpacity
                onPress={onWatchTap}
                activeOpacity={0.85}
                style={{
                  flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
                  paddingVertical: 11, borderRadius: radius.lg,
                  borderWidth: 1, borderColor: isWatched ? theme.accent : theme.line,
                  backgroundColor: isWatched ? theme.accentSoft : theme.surface,
                }}
              >
                <IconBell size={15} color={isWatched ? theme.accent : theme.ink} sw={1.8} />
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: isWatched ? theme.accent : theme.ink }}>
                  {isWatched ? 'سنُنبّهك إذا انخفض السعر ✓' : 'نبّهني إذا انخفض السعر'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onWishTap}
                activeOpacity={0.85}
                style={{
                  flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
                  paddingVertical: 11, borderRadius: radius.lg,
                  borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface,
                }}
              >
                <IconSpark size={15} color={theme.ink} sw={1.8} />
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink }}>
                  أريد هذا الجهاز بسعر أقل — أضفه لقائمة الرغبات
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Btn kind="primary" full onPress={() => navigation.navigate('EditListing', { id })}>{ar.listing.edit}</Btn>
              <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                {/* Sold-state toggle. Active → "Mark sold" with confirmation
                    + success toast. Sold → "Mark available" so the seller
                    can flip it back without re-listing. Hidden entirely on
                    expired listings (renew button covers that flow). */}
                {data.status === 'sold' ? (
                  <Btn kind="success" full busy={markSold.isPending} onPress={() => {
                    Alert.alert(
                      'إعادة التفعيل',
                      'هل تريد إرجاع الإعلان إلى المتاح؟',
                      [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'إرجاع', onPress: () => markSold.mutate('active') },
                      ],
                    );
                  }}>إعادة للمتاح</Btn>
                ) : data.status === 'active' ? (
                  <Btn kind="ghost" full busy={markSold.isPending} onPress={() => {
                    Alert.alert(
                      'تحديد كمباع',
                      'سيظهر الإعلان مع علامة "مباع" بدلاً من اختفائه. يمكنك إرجاعه للمتاح لاحقاً. هل تريد المتابعة؟',
                      [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'تأكيد', onPress: () => markSold.mutate('sold') },
                      ],
                    );
                  }}>{ar.listing.markSold}</Btn>
                ) : null}
                {data.status === 'expired' ? (
                  <Btn kind="success" full onPress={async () => {
                    await Listings.renew(id);
                    qc.invalidateQueries({ queryKey: ['listing', id] });
                  }}>{ar.listing.renew}</Btn>
                ) : null}
                <Btn kind="danger" full onPress={() => {
                  Alert.alert('حذف', 'هل أنت متأكد؟', [
                    { text: 'إلغاء', style: 'cancel' },
                    { text: 'حذف', style: 'destructive', onPress: async () => {
                      try {
                        await Listings.remove(id);
                        qc.invalidateQueries({ queryKey: ['mine'] });
                        qc.invalidateQueries({ queryKey: ['browse'] });
                        navigation.goBack();
                      } catch (e: any) {
                        Alert.alert('خطأ', (ar.errors as any)[e?.message] || ar.errors.network);
                      }
                    } },
                  ]);
                }}>{ar.listing.remove}</Btn>
              </View>
            </>
          )}
        </View>
      </Animated.ScrollView>

      {/* Status-bar scrim. The gallery is edge-to-edge on purpose, so the
          scroll content passes under the clock and signal icons — fine for a
          photo, unreadable the moment the seller's phone number scrolls into
          that band. A permanently solid strip would crop the hero, so it
          fades in only once the page has scrolled past the gallery.
          Non-interactive, so the floating back button still receives taps. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: insets.top, backgroundColor: theme.bg,
          opacity: scrollY.interpolate({
            inputRange: [200, 280],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
        }}
      />

      {/* Tap any gallery photo to open it full-screen (swipe between, tap ✕). */}
      {viewerIdx != null && (data.images?.length || 0) > 0 ? (
        <FullScreenGallery
          images={data.images!}
          startIndex={viewerIdx}
          onClose={() => setViewerIdx(null)}
        />
      ) : null}

      {/* The shortlist, parked above the tab bar. Absent until something is
          in it, so a buyer who never compares never sees it. */}
      <CompareTray
        onOpen={() => navigation.navigate('Compare')}
        // The home feed, not just "back" — back could be the compare page
        // or another listing, neither of which is where you find a device.
        onFindMore={() => navigation.navigate('BrowseHome')}
      />
    </View>
  );
}

// Always-on contact CTAs. Three actions, all public:
//   - Call: tap-to-dial via tel:
//   - WhatsApp: deeplink wa.me, only when seller provided a number
//   - Chat: opens the in-app chat so buyers can negotiate without leaving
function ContactRow({
  phone, whatsapp, listingId, brand, sellerType, onStartChat, chatStarting, storefront,
}: {
  phone: string | null;
  whatsapp: string | null;
  listingId: number;
  brand: string;
  sellerType?: string;
  onStartChat: () => void;
  chatStarting: boolean;
  // A storefront sells through the cart and answers on one support line, so
  // its listings drop the per-seller chat entirely.
  storefront?: boolean;
}) {
  const track = useTrack();
  // The contact-tap is the closest thing this app has to a "sale" —
  // we wire both the visible phone-number tap and the bottom buttons
  // through these wrappers so all three paths report the same event.
  const trackedCall = () => {
    if (!phone) return;
    track('listing.contact_call', { listing_id: listingId, brand, seller_type: sellerType });
    logMetaEvent('Contact', { method: 'call', brand });
    // Our own server too. track()/logMetaEvent() go to PostHog and Meta; the
    // dashboard's contact columns read the events table, which only this
    // fills — without it they sit at zero forever.
    Listings.contact(listingId, 'call');
    callPhone(phone);
  };
  const trackedWhatsApp = () => {
    track('listing.contact_whatsapp', { listing_id: listingId, brand, seller_type: sellerType });
    logMetaEvent('Contact', { method: 'whatsapp', brand });
    Listings.contact(listingId, 'whatsapp');
    if (whatsapp) openWhatsApp(whatsapp);
  };
  const trackedChat = () => {
    track('listing.contact_chat', { listing_id: listingId, brand, seller_type: sellerType });
    onStartChat();
  };
  return (
    <View style={{
      backgroundColor: theme.surface,
      borderColor: theme.line, borderWidth: 1, borderRadius: radius.xxl,
      padding: 14,
    }}>
      {/* Public phone pill — only when the seller actually exposed a
          number. Listings without a phone skip straight to the chat
          button below. */}
      {phone ? (
        <TouchableOpacity
          onPress={trackedCall}
          activeOpacity={0.85}
          style={{
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 12, paddingVertical: 10,
            backgroundColor: theme.bg, borderRadius: 12,
            borderWidth: 1, borderColor: theme.line,
          }}
        >
          <Text style={{ fontFamily: fonts.ltrBold, fontSize: 17, color: theme.ink, fontWeight: '700', letterSpacing: 0.3, writingDirection: 'ltr' }}>
            {phone}
          </Text>
          <IconPhoneIcon size={16} color={theme.subtle} sw={1.7} />
        </TouchableOpacity>
      ) : null}

      {/* Action row: Call / WhatsApp render only when their backing
          field is set. We skip the row entirely if neither is available
          (the chat button below covers reach in that case). */}
      {phone || whatsapp ? (
        <View style={{ marginTop: phone ? 8 : 0, flexDirection: 'row-reverse', gap: 8 }}>
          {phone ? (
            <Btn kind="success" full onPress={trackedCall}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                <IconPhoneIcon size={15} color="#fff" sw={1.8} />
                <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 14 }}>اتصال</Text>
              </View>
            </Btn>
          ) : null}
          {whatsapp ? (
            <Btn kind="successSoft" full onPress={trackedWhatsApp}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                <IconMsgCall size={15} color={theme.success} sw={1.8} />
                <Text style={{ color: theme.success, fontFamily: fonts.arBold, fontSize: 14 }}>واتساب</Text>
              </View>
            </Btn>
          ) : null}
        </View>
      ) : null}
      {/* Chat on storefront listings used to be suppressed as "a third
          channel nobody is watching". The operator app now watches it —
          store chats surface there with a push, and replies go out under
          the shop's own name — so the reason is gone and the button is
          back for every listing. */}
      <View style={{ marginTop: (phone || whatsapp) ? 8 : 0 }}>
        <Btn kind="primary" full onPress={trackedChat} busy={chatStarting}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <IconChat size={15} color="#fff" sw={1.8} />
            <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 14 }}>{sellerType === 'shop' ? ar.listing.chatShop : ar.listing.chat}</Text>
          </View>
        </Btn>
      </View>
    </View>
  );
}

function FloatBtn({ children, onPress, active }: { children: React.ReactNode; onPress?: () => void; active?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{
      width: 38, height: 38, borderRadius: 999,
      // When active (e.g. "this listing is saved"), drop the dark scrim
      // and use a solid white pill — the colored icon then reads as a
      // clear "ON" state instead of just changing color against a near-
      // identical dark backdrop.
      backgroundColor: active ? '#fff' : 'rgba(20,16,12,0.55)',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </TouchableOpacity>
  );
}

