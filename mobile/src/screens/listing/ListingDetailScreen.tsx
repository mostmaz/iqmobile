import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, Dimensions, Modal, Animated, Share,
} from 'react-native';
import { Img } from '../../components/Img';
import { DeviceSpecs } from '../../components/DeviceSpecs';
import { LoadFailed } from '../../components/LoadFailed';
import { CompareTray } from '../../components/CompareTray';
import { deviceTitle, ltrNum, timeAgoAr } from '../../lib/format';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft, shadowUp, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, Card, fmtIQD } from '../../components/ui';
import { IconStar, IconPin, IconArrowLeft, IconShare, IconBookmark, IconPhoneIcon, IconMsgCall, IconChat, IconSpark, IconChevronLeft, IconBell, IconLock, IconCompare } from '../../components/icons';
import { useCompare, COMPARE_MAX } from '../../lib/compare';
import { ChipTag, SpecRow } from '../../components/marketplace';
import { conditionRows } from '../../lib/conditionDetails';
import { noteViewed } from '../../lib/recentlyViewed';
import { isOnRequest, isNegotiable, ON_REQUEST_LABEL, NEGOTIABLE_LABEL } from '../../lib/priceMode';
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
import { FreeBoostCard } from '../../components/FreeBoostCard';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
/**
 * Gallery height.
 *
 * Was 320, which on a 390pt screen pushed the asking price and the contact
 * button below the fold — a buyer had to scroll before learning either of
 * the two things they opened the listing for. 236 keeps the photo the
 * largest element on the screen and still lets the price card and the first
 * chips land above it.
 */
const GALLERY_H = 236;

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

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
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
  // A shop seller has a page; an individual does not. `seller_id` is the
  // shop's own user id, which is what ShopDetail takes.
  const isShopSeller = data?.seller?.seller_type === 'shop';
  const openShopPage = React.useCallback(() => {
    const id = (data as any)?.seller_id ?? data?.seller?.id;
    if (id) navigation.navigate('ShopDetail', { id });
  }, [data, navigation]);

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

  // Remember this device locally for the "recently viewed" rail. Cached
  // fields only (brand, model, first image) so the rail renders on a cold
  // start without a fetch.
  //
  // MUST stay above the early returns below. Placed after them it runs only
  // once `data` has arrived, so the second render calls one more hook than
  // the first — "Rendered more hooks than during the previous render", which
  // is a hard crash, not a warning. `data?.id` in the deps and the guard
  // inside are what make it safe to run on the loading render too.
  useEffect(() => {
    if (!data?.id) return;
    noteViewed({
      id: data.id,
      brand: data.brand,
      model: data.model,
      image_path: data.images?.[0]?.image_path ?? null,
    });
  }, [data?.id]);

  // `isLoading || !data` used to cover BOTH "still loading" and "the request
  // failed", so a dropped connection shimmered forever — no error, no retry,
  // nothing to do but go back. It also made the server's own `not_found`
  // unreachable: a deleted listing shimmered too.
  if (isError && !data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row-reverse', paddingHorizontal: 12, paddingVertical: 8 }}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
            </View>
          </TouchableOpacity>
        </View>
        <LoadFailed
          error={error}
          retrying={isFetching}
          onRetry={() => refetch()}
          title={(error as any)?.message === 'not_found' ? 'هذا الإعلان لم يعد موجوداً' : undefined}
        />
      </View>
    );
  }

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
      // Acknowledge from the RESPONSE, not optimistically. The old code fired
      // this alert after any 200 without knowing whether a row was written,
      // and quoted no reference the user could follow up with.
      const r = await Reports.submit('listing', id, reason);
      Alert.alert(
        'شكراً',
        r.duplicate
          ? `سبق أن أرسلت هذا البلاغ (رقم ${r.id}). هو قيد المراجعة.`
          : `تم استلام البلاغ رقم ${r.id}. سنراجعه.`,
      );
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

  // One gate for both halves of the contact UI — the number in the flow and
  // the bar at the bottom. Two reasons to skip it, both about the price
  // book: with the store button above, this would add a SECOND chat button
  // bound to the aggregator account; and without it — no shop stocks this
  // device — the numbers are blank, leaving only that dead chat button.
  // Normal listings are unaffected: both flags are price-book only.
  const showContact = !isMine && !isDead
    && !(data as any).store_chat && !(data as any).contact_suppressed;
  // The visible number and the bar's call button must report the same
  // event, or the dashboard's contact column counts one of the two paths.
  const trackPhoneCall = () => {
    if (!contactPhone) return;
    track('listing.contact_call', { listing_id: data.id, brand: data.brand, seller_type: (data as any).seller_type ?? null });
    logMetaEvent('Contact', { method: 'call', brand: data.brand });
    Listings.contact(data.id, 'call');
    callPhone(contactPhone);
  };

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
        <View style={{ position: 'relative', height: GALLERY_H, backgroundColor: theme.chipBg }}>
          <ScrollView
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
          >
            {(data.images || []).length === 0 ? (
              <View style={{ width: SCREEN_W, height: GALLERY_H, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.subtle, fontFamily: fonts.ar }}>لا توجد صور</Text>
              </View>
            ) : (
              (data.images || []).map((im, i) => (
                <TouchableOpacity key={im.id} activeOpacity={1} onPress={() => setViewerIdx(i)}>
                  <Img source={{ uri: fullImageUrl(im.image_path) }} style={{ width: SCREEN_W, height: GALLERY_H }} />
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
                // Sharing was completely unmeasurable — no event anywhere —
                // so "is the share button worth its place on the image?" had
                // no answer. Fired on INTENT, before the sheet: iOS reports
                // the chosen activity but Android does not, so counting
                // completions would silently undercount the larger platform.
                track('listing.share', {
                  listing_id: id,
                  brand: data.brand,
                  seller_type: (data as any).seller_type ?? null,
                });
                Share.share({
                  message: `${deviceTitle(data.brand, data.model)} · ${isOnRequest(data as any) ? ON_REQUEST_LABEL : `${fmtIQD(data.asking_price)} د.ع`}\n${url}`,
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

          <Text style={{ fontFamily: fonts.arBold, fontSize: 21, color: theme.ink, lineHeight: 28, letterSpacing: -0.3, textAlign: 'right' }}>
            {deviceTitle(data.brand, data.model)}
          </Text>

          {/* Where and when, on their own line under the title. This used to
              be the right-hand column of the price row, which meant a long
              «بغداد · المحمودية» was competing for width with a 30pt price
              and losing. */}
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, marginTop: 6 }}>
            <IconPin size={13} color={theme.subtle} />
            <Text style={{ fontFamily: fonts.arRegular, fontSize: 12, color: theme.subtle }}>
              {arOf(data.governorate)}{data.city ? ` · ${data.city}` : ''} · {timeAgoAr(data.created_at)}
            </Text>
          </View>

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

          {/* The price gets a card of its own. On a near-white page a bare
              price reads as a caption; the card is what makes it the thing
              the eye lands on after the photo. */}
          <View style={{
            marginTop: 12, backgroundColor: theme.surface,
            borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
            padding: 14, ...shadowSoft,
            flexDirection: 'row-reverse', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10,
          }}>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle }}>
                {isOnRequest(data as any) ? 'السعر' : stale ? 'آخر سعر معروف' : 'السعر المطلوب'}
              </Text>
              {/* A call-for-price listing carries a SENTINEL asking_price of 1.
                  There was no branch here, so it rendered «١ د.ع» — an iPhone
                  advertised at one dinar. Say what is true instead. */}
              {isOnRequest(data as any) ? (
                <Text style={{ marginTop: 2, fontFamily: fonts.arBold, fontSize: 20, color: theme.ink }}>
                  {ON_REQUEST_LABEL}
                </Text>
              ) : (
                <Text style={{ marginTop: 2, fontFamily: fonts.ltrBold, fontSize: 30, color: stale ? theme.subtle : theme.accentDeep, fontWeight: '700', letterSpacing: -0.5 }}>
                  {fmtIQD(data.asking_price)}
                  <Text style={{ fontSize: 14, color: theme.subtle, fontFamily: fonts.ar }}>  د.ع</Text>
                </Text>
              )}
              {isNegotiable(data as any) ? (
                <Text style={{ marginTop: 2, fontFamily: fonts.ar, fontSize: 11.5, color: theme.success }}>
                  {NEGOTIABLE_LABEL}
                </Text>
              ) : null}

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
        {showContact && contactPhone ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <SellerPhoneCard phone={contactPhone} onCall={trackPhoneCall} />
          </View>
        ) : null}

        {/* Owner promote CTA — the highest-visibility surface for the
            featured-listing upsell: publishing a listing lands the seller
            right here, so this doubles as the post-publish prompt. Swaps to
            a "featured until" notice while a window is active; hidden on
            sold/expired listings (nothing to promote). Hidden entirely in the
            Play Store artifact (SHOW_PROMOTE=false) — see config/flags.ts. */}
        {/* Free first, paid second. The rewarded boost is NOT behind
          SHOW_PROMOTE: that flag hides paid promotion on iOS because Apple
          wants IAP for paid digital features, and watching an ad is not a
          purchase. The card hides itself when the operator has the feature
          off. */}
      {isMine && (data.status === 'active' || data.status === 'reserved') ? (
        <FreeBoostCard
          listingId={id}
          onPress={() => navigation.navigate('FreeBoost', { id, label: `${data.brand} ${data.model}` })}
        />
      ) : null}

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
                  {/* Was «اظهر في أعلى النتائج وبِع أسرع». We cannot promise
                      a faster sale, and "top of results" overstates two
                      rotating slots. */}
                  مكان مميّز في أعلى التصفّح — ابتداءً من 2,000 د.ع
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
            {/* Required at posting since the sell form was tightened, so these
                always render — an ABSENT row reads as "not applicable", while
                «غير محدد» reads as "the seller didn't say", which is the true
                statement for a listing posted before the fields were
                mandatory. Same rule the compare screen follows. */}
            <SpecRow
              label={ar.listing.storage}
              value={data.storage || 'غير محدد'}
              muted={!data.storage}
            />
            <SpecRow
              label={ar.listing.color}
              value={data.color || 'غير محدد'}
              muted={!data.color}
            />
            {/* Battery: hide for non-Apple listings (no value), for Apple
                listings the seller skipped, and defensively for legacy
                rows that the old server bug stored as 0 instead of null. */}
            {data.battery_health != null && data.battery_health > 0 ? (
              <SpecRow label={ar.listing.battery} value={`${data.battery_health}%`} />
            ) : null}
            {data.warranty_status ? <SpecRow label="الضمان" value={data.warranty_status} /> : null}
            <SpecRow
              label={ar.listing.accessories}
              value={data.accessories?.length ? data.accessories.join('، ') : 'غير محدد'}
              muted={!data.accessories?.length}
              last={conditionRows((data as any).condition_details).length === 0}
            />
            {/* The seller's own answers about condition. `last` moved here
                off the accessories row: it was hardcoded there, so adding any
                row below it left a stray divider under the final entry. */}
            {conditionRows((data as any).condition_details).map((r, i, all) => (
              <SpecRow
                key={r.id}
                label={r.spec}
                value={r.label}
                muted={r.label === 'غير معروف'}
                last={i === all.length - 1}
              />
            ))}
          </Card>
        </View>

        {/* seller card */}
        {data.seller ? (
          <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
            <Card style={{ padding: 14 }}>
              {/* The whole seller row opens the shop's page — for a SHOP.
                  It carried no navigation at all before: a buyer tapped the
                  name, the «متجر» badge or the shop's own sign and nothing
                  happened, with the map row the only live control on the
                  card. An individual seller has no page to open, so for them
                  this stays a plain View rather than a control that goes
                  nowhere. */}
              <SellerRow onPress={isShopSeller ? openShopPage : null}>
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
                {/* The affordance. Without it the row reads as a label. */}
                {isShopSeller ? (
                  <View style={{ marginRight: 2 }}>
                    <IconChevronLeft size={18} color={theme.subtle} sw={1.8} />
                  </View>
                ) : null}
              </SellerRow>

              {/* Shop sign image — only for shop sellers. Stretches across
                  the card under the name row, and opens the shop like the
                  row above it. */}
              {isShopSeller && (data.seller as any).shop_image_path ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={openShopPage}
                  accessibilityRole="button"
                  accessibilityLabel={`افتح صفحة ${data.seller.display_name}`}
                  style={{ marginTop: 10, borderRadius: radius.md, overflow: 'hidden', backgroundColor: theme.chipBg }}
                >
                  <Img
                    source={{ uri: fullImageUrl((data.seller as any).shop_image_path) }}
                    style={{ width: '100%', height: 140 }}
                  />
                </TouchableOpacity>
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
          conditionDetails={(data as any).condition_details}
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

      {/* Pinned, so chat is reachable from anywhere on the page rather than
          only after scrolling past the specs. */}
      {showContact ? (
        <ContactBar
          phone={contactPhone}
          whatsapp={contactWhatsApp}
          listingId={data.id}
          brand={data.brand}
          sellerType={data.seller?.seller_type}
          onStartChat={startChat}
          chatStarting={chatStarting}
          chat={data.seller?.channels?.chat ?? true}
        />
      ) : null}

      {/* The shortlist, parked above the tab bar. Absent until something is
          in it, so a buyer who never compares never sees it. */}
      <CompareTray
        // Sits above the contact bar rather than over it. The bar's own
        // height is its 50pt button plus 12 top, 16-or-inset bottom.
        bottomOffset={showContact ? 50 + 12 + Math.max(insets.bottom, 16) : 0}
        onOpen={() => navigation.navigate('Compare')}
        // The home feed, not just "back" — back could be the compare page
        // or another listing, neither of which is where you find a device.
        onFindMore={() => navigation.navigate('BrowseHome')}
      />
    </View>
  );
}

// The seller's contact, split in two.
//
// It used to be one card holding a phone pill and three equal-weight
// buttons — call, WhatsApp, chat — stacked in the scroll flow, which meant
// the buyer had to scroll past the specs to reach any of them, and once
// there had to choose between three things that look equally likely to
// work. Only chat always works: a listing may have no phone and no
// WhatsApp, and a phone that is switched off fails silently.
//
// So: the NUMBER stays in the flow, because it is information a buyer reads
// and copies. The ACTIONS move to a bar pinned to the bottom, where chat is
// the one that gets words and the rest are icons beside it.

/** Just the number, in the flow. Rendered only when the seller exposed one. */
function SellerPhoneCard({ phone, onCall }: { phone: string; onCall: () => void }) {
  return (
    <View style={{
      backgroundColor: theme.surface,
      borderColor: theme.line, borderWidth: 1, borderRadius: radius.xxl,
      padding: 14,
    }}>
      <TouchableOpacity
        onPress={onCall}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 12, paddingVertical: 10,
          backgroundColor: theme.inset, borderRadius: radius.lg,
        }}
      >
        <Text style={{ fontFamily: fonts.ltrBold, fontSize: 17, color: theme.ink, fontWeight: '700', letterSpacing: 0.3, writingDirection: 'ltr' }}>
          {phone}
        </Text>
        <IconPhoneIcon size={16} color={theme.subtle} sw={1.7} />
      </TouchableOpacity>
    </View>
  );
}

/**
 * The pinned action bar.
 *
 * Chat is the primary and the only one with a label. Call and WhatsApp are
 * 56-wide icon buttons beside it, each rendered only when its backing field
 * is set — the bar shrinks to a single full-width chat button on a listing
 * with no phone, rather than showing a dead control.
 *
 * The handoff put "compare" in the third slot. Compare already has a
 * floating button on the gallery two thumb-lengths above, and WhatsApp is a
 * channel with no other entry point on this screen, so WhatsApp keeps it.
 */
function ContactBar({
  phone, whatsapp, listingId, brand, sellerType, onStartChat, chatStarting, chat = true,
}: {
  phone: string | null;
  whatsapp: string | null;
  listingId: number;
  brand: string;
  sellerType?: string;
  onStartChat: () => void;
  chatStarting: boolean;
  chat?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const track = useTrack();
  // The contact-tap is the closest thing this app has to a "sale" — the
  // visible number and these buttons both come through here so all paths
  // report the same event.
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
  if (!chat && !phone && !whatsapp) return null;
  return (
    <View style={{
      backgroundColor: theme.surface,
      borderTopWidth: 1, borderTopColor: theme.line,
      ...shadowUp,
      paddingHorizontal: 16, paddingTop: 12,
      paddingBottom: Math.max(insets.bottom, 16),
      flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    }}>
      {chat ? (
        <TouchableOpacity
          onPress={trackedChat}
          disabled={chatStarting}
          activeOpacity={0.85}
          accessibilityRole="button"
          style={{
            flex: 1, minHeight: 50, borderRadius: radius.lg,
            backgroundColor: theme.accent,
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
            opacity: chatStarting ? 0.7 : 1,
          }}
        >
          <IconChat size={17} color="#fff" sw={1.8} />
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15 }}>
            {sellerType === 'shop' ? ar.listing.chatShop : ar.listing.chat}
          </Text>
        </TouchableOpacity>
      ) : null}
      {phone ? (
        <TouchableOpacity
          onPress={trackedCall}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="اتصال"
          style={{
            width: chat ? 56 : undefined, flex: chat ? 0 : 1,
            minHeight: 50, borderRadius: radius.lg,
            backgroundColor: theme.successSoft, borderWidth: 1.5, borderColor: theme.success,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconPhoneIcon size={18} color={theme.success} sw={1.8} />
        </TouchableOpacity>
      ) : null}
      {whatsapp ? (
        <TouchableOpacity
          onPress={trackedWhatsApp}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="واتساب"
          style={{
            width: chat ? 56 : undefined, flex: chat ? 0 : 1,
            minHeight: 50, borderRadius: radius.lg,
            backgroundColor: theme.chipBg,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconMsgCall size={18} color={theme.success} sw={1.8} />
        </TouchableOpacity>
      ) : null}
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

/**
 * The seller row: a control when there is somewhere to go, a plain row when
 * there is not.
 *
 * Rendering a TouchableOpacity with a null handler would look identical and
 * behave like a dead button for every individual seller on the marketplace,
 * which is the failure this card already had in a different form.
 */
function SellerRow({ onPress, children }: { onPress: (() => void) | null; children: React.ReactNode }) {
  const style = {
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  };
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button" style={style}>
      {children}
    </TouchableOpacity>
  );
}
