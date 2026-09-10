// One request, from whichever side you are standing on.
//
//   the buyer  → his request + every offer, cheapest first, each with a way
//                to reach that seller (call / WhatsApp / the attached
//                listing) and buttons to close the request when he's done
//   a seller   → the request + a form to quote it. He sees his OWN offer
//                and never a rival's price; the server enforces that, this
//                screen just renders what it is given.
//
// Re-quoting edits the existing offer rather than adding a second one, so
// the seller's button says «حدّث عرضك» once he has quoted.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft, shadowAccent } from '../../theme';
import { Btn, Header, Pill, Input, fmtIQD } from '../../components/ui';
import {
  IconRequest, IconPin, IconStar, IconTag, IconClose, IconCheck,
  IconPhoneIcon, IconMsgCall, IconChevronLeft,
} from '../../components/icons';
import { Img } from '../../components/Img';
import { ListingCard } from '../../components/ListingCard';
import { bundledBrandLogo } from '../../lib/brandLogos';
import { fullImageUrl } from '../../api/upload';
import { PhoneRequests, Listings, type PhoneRequest, type RequestOffer, type Listing } from '../../api/endpoints';
import { deviceTitle, timeAgoAr } from '../../lib/format';
import { arOf } from '../../lib/governorates';
import { callPhone, openWhatsApp } from '../../lib/contact';
import { useAuth } from '../../auth/AuthContext';

// Loose model comparison for "is this the device he asked for" — mirrors the
// spirit of the server's normalizer (lowercase, fold Arabic digits and
// spacing) without pulling the whole thing into the app.
const sameModel = (m?: string | null) => String(m || '').toLowerCase().replace(/\s+/g, '');

const conditionLabel = (k?: string | null) => ({
  new: 'جديد', like_new: 'كالجديد', used: 'مستعمل', refurbished: 'مجدّد', repaired: 'مصلّح',
} as Record<string, string>)[k || ''] || 'أي حالة';

export default function RequestDetailScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const id = route?.params?.id;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['request', id],
    queryFn: () => PhoneRequests.get(id),
    enabled: !!id,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['request', id] });
    qc.invalidateQueries({ queryKey: ['requests-board'] });
    qc.invalidateQueries({ queryKey: ['requests-mine'] });
    qc.invalidateQueries({ queryKey: ['requests-sent'] });
  };

  const setStatus = useMutation({
    mutationFn: (status: 'open' | 'closed' | 'fulfilled') => PhoneRequests.setStatus(id, status),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر تحديث الطلب', 'حاول مرة أخرى.'),
  });

  if (isLoading || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <Header title="الطلب" onBack={() => navigation.goBack()} />
      </View>
    );
  }

  const isMine = data.is_mine;
  const isOpen = data.status === 'open';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={isMine ? 'طلبي' : 'طلب جهاز'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>

        {/* ── the request ── */}
        <View style={{
          backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
          borderColor: theme.line, ...shadowSoft, padding: 16,
        }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
            {/* Same brand tile the board uses, so the card a buyer tapped
                and the card they land on are recognisably the same thing. */}
            <View style={{
              width: 42, height: 42, borderRadius: radius.lg, backgroundColor: theme.chipBg,
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              {bundledBrandLogo(data.brand) ? (
                <Img source={bundledBrandLogo(data.brand)!} contentFit="contain" style={{ width: 25, height: 25 }} />
              ) : (
                <IconRequest size={20} color={theme.ink} sw={1.6} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{
                fontFamily: fonts.arBold, fontSize: 16, color: theme.ink,
                textAlign: 'right', writingDirection: 'ltr',
              }}>
                {deviceTitle(data.brand, data.model)}
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                {timeAgoAr(data.created_at)}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            <Chip>حتى {fmtIQD(data.max_price)} د.ع</Chip>
            <Chip>{conditionLabel(data.condition)}</Chip>
            <Chip icon={<IconPin size={11} color={theme.subtle} sw={1.8} />}>{arOf(data.governorate)}</Chip>
          </View>

          {data.note ? (
            <Text style={{
              fontFamily: fonts.ar, fontSize: 13, color: theme.ink, textAlign: 'right',
              marginTop: 12, lineHeight: 21,
            }}>
              {data.note}
            </Text>
          ) : null}

          {!isOpen ? (
            <View style={{
              marginTop: 12, padding: 10, borderRadius: radius.lg, backgroundColor: theme.chipBg,
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: theme.subtle, textAlign: 'center' }}>
                {data.status === 'fulfilled' ? 'هذا الطلب انتهى — حصل المشتري على الجهاز.'
                  : data.status === 'expired' ? 'انتهت مدة هذا الطلب.'
                  : 'أُغلق هذا الطلب.'}
              </Text>
            </View>
          ) : null}
        </View>

        {isMine
          ? <BuyerView request={data} onStatus={(s) => setStatus.mutate(s)} busy={setStatus.isPending} navigation={navigation} />
          : <SellerView request={data} onDone={() => { invalidate(); refetch(); }} navigation={navigation} />}
      </ScrollView>
    </View>
  );
}

// ─── buyer ─────────────────────────────────────────────────────────────

function BuyerView({ request, onStatus, busy, navigation }: {
  request: PhoneRequest;
  onStatus: (s: 'open' | 'closed' | 'fulfilled') => void;
  busy: boolean;
  navigation: any;
}) {
  const offers = request.offers || [];
  const isOpen = request.status === 'open';

  return (
    <View style={{ marginTop: 18 }}>
      {/* The ordering is stated rather than left to be inferred. A buyer
          scanning a list of prices assumes SOME order; saying which one
          means the first card can be trusted as the cheapest. */}
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', marginBottom: 10, gap: 6 }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink }}>العروض</Text>
        {offers.length ? (
          <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 12, color: theme.accentDeep }}>
            {offers.length}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {offers.length > 1 ? (
          <Text style={{ fontFamily: fonts.arRegular, fontSize: 11.5, color: theme.subtle }}>الأرخص أولاً</Text>
        ) : null}
      </View>

      {offers.length === 0 ? (
        <View style={{
          padding: 26, alignItems: 'center', borderRadius: radius.xxl,
          borderWidth: 1, borderStyle: 'dashed', borderColor: theme.line,
        }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'center' }}>
            ما وصلت عروض بعد
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
            وصل طلبك إلى المتاجر والأشخاص الذين يبيعون هذا الجهاز. تصل العروض الأولى عادةً خلال ساعات.
          </Text>
        </View>
      ) : (
        // The cheapest offer is marked, not just first. "First" only reads
        // as "cheapest" once you have compared the prices yourself, which is
        // the work the border saves.
        offers.map((o, i) => (
          <OfferCard key={o.id} offer={o} best={i === 0 && offers.length > 1} navigation={navigation} />
        ))
      )}

      {/* Already on sale, right now.
          
          A buyer opens their own request to see who replied. When nobody
          has, the screen is a dead end — and the whole premise of the funnel
          is that most requests are for a phone somebody is ALREADY selling.
          This is that answer, under the offers rather than over them:
          offers are what the buyer asked for, this is the shortcut. */}
      <MatchingListings request={request} navigation={navigation} />

      {/* One row, not a stack. «حصلت على الجهاز» is the outcome everyone
          wants and takes the width; «أغلق الطلب» is the giving-up branch and
          gets a fixed 110. Stacked full-width, the two read as equally
          likely next steps. Both keep their two-step confirmations. */}
      {isOpen ? (
        <View style={{ marginTop: 22, flexDirection: 'row-reverse', gap: 8, alignItems: 'stretch' }}>
          <View style={{ flex: 1 }}>
            <Btn kind="primary" full busy={busy} onPress={() => Alert.alert(
              'حصلت على الجهاز؟',
              'سنغلق الطلب ونوقف وصول عروض جديدة.',
              [{ text: 'لا', style: 'cancel' }, { text: 'نعم، حصلت عليه', onPress: () => onStatus('fulfilled') }],
            )}>
              حصلت على الجهاز
            </Btn>
          </View>
          <View style={{ width: 110 }}>
            <Btn kind="ghost" full onPress={() => Alert.alert(
              'إغلاق الطلب',
              'لن تصلك عروض جديدة على هذا الطلب.',
              [{ text: 'إلغاء', style: 'cancel' }, { text: 'أغلق', style: 'destructive', onPress: () => onStatus('closed') }],
            )}>
              أغلق الطلب
            </Btn>
          </View>
        </View>
      ) : request.status !== 'expired' ? (
        <View style={{ marginTop: 22 }}>
          <Btn kind="ghost" full busy={busy} onPress={() => onStatus('open')}>أعد فتح الطلب</Btn>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Listings that satisfy the request as written.
 *
 * The filter is the request itself — same brand, same model under the fold
 * `/top-models` groups on, at or under the buyer's ceiling, in the condition
 * they asked for if they named one. `model_exact` matters here for the same
 * reason it does in the funnel: a request for "iPhone 13" must not answer
 * with every iPhone 13 Pro Max, which costs twice as much and is over the
 * ceiling the buyer just set.
 *
 * Governorate is deliberately NOT applied. The request carries where the
 * buyer is, and sellers see the board filtered by it — but a phone one
 * governorate over is an ordinary thing to buy here, and every card states
 * its own location anyway.
 */
function MatchingListings({ request, navigation }: { request: PhoneRequest; navigation: any }) {
  const q = useQuery({
    queryKey: ['request-matches', request.id, request.brand, request.model, request.max_price, request.condition],
    queryFn: () => Listings.browse({
      brand: request.brand,
      model: request.model,
      model_exact: true,
      max_price: request.max_price,
      ...(request.condition ? { condition: request.condition as any } : {}),
      available_only: true,
      // Cheapest first: the buyer named a ceiling, so the interesting end of
      // the range is the bottom.
      sort: 'price_asc',
      limit: 6,
    }),
    staleTime: 60_000,
  });
  const items = q.data || [];

  // Nothing to say while it loads, and nothing to say when there is no
  // match — an empty «أجهزة مطابقة» heading over a blank space reads as a
  // failure, and the offers section above already covers the empty case.
  if (q.isLoading || items.length === 0) return null;

  return (
    <View style={{ marginTop: 22 }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink }}>معروض الآن يطابق طلبك</Text>
        <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 12, color: theme.accentDeep }}>
          {items.length}
        </Text>
      </View>
      <Text style={{ fontFamily: fonts.arRegular, fontSize: 12, color: theme.subtle, textAlign: 'right', marginBottom: 10, lineHeight: 19 }}>
        نفس الجهاز، ضمن ميزانيتك، معروض للبيع الآن — تقدر تراسل البائع مباشرة.
      </Text>
      {items.map((l) => (
        <ListingCard
          key={l.id}
          listing={l}
          onPress={() => navigation.navigate('ListingDetail', { id: l.id })}
        />
      ))}
    </View>
  );
}

function OfferCard({ offer, best, navigation }: { offer: RequestOffer; best?: boolean; navigation: any }) {
  const s = offer.seller;
  const logo = s?.shop_image_path || s?.profile_image_path;
  return (
    <View style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl,
      borderWidth: best ? 1.5 : 1,
      borderColor: best ? theme.accent : theme.line,
      ...shadowSoft, padding: 14, marginBottom: 10,
    }}>
      {/* seller */}
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
        <View style={{
          width: 44, height: 44, borderRadius: radius.lg, backgroundColor: theme.chipBg,
          alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {logo ? (
            <Img source={{ uri: fullImageUrl(logo) }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.subtle }}>
              {(s?.name || '?').trim()[0] || '?'}
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}>
            {s?.name || 'بائع'}
          </Text>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 3 }}>
            {s?.rating_count ? (
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}>
                <IconStar size={11} color={theme.accent} sw={1.7} />
                <Text style={{ fontFamily: fonts.ltrBold, fontSize: 11, color: theme.subtle, writingDirection: 'ltr' }}>
                  {s.rating_avg.toFixed(1)}
                </Text>
              </View>
            ) : null}
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>
              {arOf(s?.governorate)}{s?.is_shop ? ' · متجر' : ''}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-start' }}>
          <Text style={{ fontFamily: fonts.ltrBold, fontSize: 16, color: theme.accent, writingDirection: 'ltr' }}>
            {fmtIQD(offer.price)}
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
        </View>
      </View>

      {offer.note ? (
        <Text style={{
          fontFamily: fonts.ar, fontSize: 12.5, color: theme.ink, textAlign: 'right',
          marginTop: 10, lineHeight: 20,
        }}>
          {offer.note}
        </Text>
      ) : null}

      {/* the listing he attached, if any */}
      {offer.listing ? (
        <TouchableOpacity
          onPress={() => navigation.navigate('ListingDetail', { id: offer.listing!.id })}
          activeOpacity={0.85}
          style={{
            flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 10,
            padding: 8, borderRadius: radius.lg, backgroundColor: theme.bg,
            borderWidth: 1, borderColor: theme.line,
          }}
        >
          <View style={{ width: 46, height: 46, borderRadius: 10, backgroundColor: theme.chipBg, overflow: 'hidden' }}>
            {offer.listing.image_path ? (
              <Img source={{ uri: fullImageUrl(offer.listing.image_path) }} style={{ width: '100%', height: '100%' }} />
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{
              fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink,
              textAlign: 'right', writingDirection: 'ltr',
            }}>
              {deviceTitle(offer.listing.brand, offer.listing.model)}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
              شوف الإعلان
            </Text>
          </View>
          <IconChevronLeft size={15} color={theme.subtle} sw={2} />
        </TouchableOpacity>
      ) : null}

      {/* how to reach him */}
      {s?.phone || s?.whatsapp ? (
        <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 12 }}>
          {s.phone ? (
            <TouchableOpacity onPress={() => callPhone(s.phone!)} activeOpacity={0.85} style={ctaStyle(true)}>
              <IconPhoneIcon size={14} color={theme.buttonInk} sw={1.9} />
              <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.buttonInk }}>اتصال</Text>
            </TouchableOpacity>
          ) : null}
          {s.whatsapp ? (
            <TouchableOpacity
              onPress={() => openWhatsApp(s.whatsapp!, `مرحباً، بخصوص عرضك على طلبي في iQ Mobile`)}
              activeOpacity={0.85}
              style={ctaStyle(false)}
            >
              <IconMsgCall size={14} color={theme.ink} sw={1.9} />
              <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink }}>واتساب</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ctaStyle(primary: boolean) {
  return {
    flex: 1, flexDirection: 'row-reverse' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 6, paddingVertical: 11, borderRadius: radius.lg,
    backgroundColor: primary ? theme.ink : theme.surface,
    borderWidth: 1, borderColor: primary ? theme.ink : theme.line,
  };
}

// ─── seller ────────────────────────────────────────────────────────────

function SellerView({ request, onDone, navigation }: { request: PhoneRequest; onDone: () => void; navigation: any }) {
  const existing = request.my_offer || null;
  const isOpen = request.status === 'open';
  // Deliberately NOT seeded with request.max_price. Pre-filling the buyer's
  // ceiling anchors every lazy seller at the most expensive number he is
  // allowed to say, which is exactly the comparison the buyer opened the
  // list to make. An empty box costs one tap and keeps the offers honest.
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [listingId, setListingId] = useState<number | null>(existing?.listing?.id ?? null);

  // Only listings that could plausibly answer THIS request are offered for
  // attachment — same brand, still live. Attaching an unrelated device is
  // the fastest way to make the board feel like spam.
  const { data: myListings } = useQuery({
    queryKey: ['my-listings-for-offer'],
    queryFn: () => Listings.mine('all'),
    enabled: isOpen,
  });
  const attachable = useMemo(() => {
    const wanted = sameModel(request.model);
    return (myListings || [])
      .filter((l: Listing) => l.brand === request.brand && (l.status === 'active' || l.status === 'reserved'))
      // Same brand is the filter, but the exact device the buyer asked for
      // sorts first. A same-brand alternative is a legitimate offer — an
      // iPhone 11 volunteering itself as the default answer to an iPhone 15
      // Pro request is not.
      .sort((a: Listing, b: Listing) => {
        const ea = sameModel(a.model) === wanted ? 0 : 1;
        const eb = sameModel(b.model) === wanted ? 0 : 1;
        return ea - eb || a.asking_price - b.asking_price;
      });
  }, [myListings, request.brand, request.model]);

  const send = useMutation({
    mutationFn: () => PhoneRequests.offer(request.id, {
      price: Number(String(price).replace(/[^\d]/g, '')),
      note: note.trim() || null,
      listing_id: listingId,
    }),
    onSuccess: () => {
      onDone();
      Alert.alert(existing ? 'تم تحديث عرضك ✅' : 'أُرسل عرضك ✅', 'وصل إشعار إلى المشتري، وسيتواصل معك إذا ناسبه العرض.');
    },
    onError: (e: any) => {
      const code = String(e?.message || '');
      Alert.alert('تعذّر إرسال العرض',
        code.includes('request_closed') ? 'أُغلق هذا الطلب.'
        : code.includes('too_many_offers_today') ? 'أرسلت عروضاً كثيرة اليوم. حاول غداً.'
        : code.includes('guest_not_allowed') ? 'سجّل الدخول برقم هاتفك ليتمكن المشتري من الوصول إليك.'
        : code.includes('bad_price') ? 'اكتب سعراً صحيحاً.'
        : 'حاول مرة أخرى.');
    },
  });

  const withdraw = useMutation({
    mutationFn: () => PhoneRequests.withdrawOffer(request.id),
    onSuccess: onDone,
    onError: () => Alert.alert('تعذّر سحب العرض', 'حاول مرة أخرى.'),
  });

  if (!isOpen) return null;

  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right', marginBottom: 4 }}>
        {existing ? 'عرضك' : 'قدّم عرضك'}
      </Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginBottom: 12, lineHeight: 20 }}>
        {existing
          ? 'يمكنك تعديل سعرك — وسيصل المشتري إشعار بالتحديث بدلاً من عرض جديد.'
          : 'اكتب سعرك للمشتري. يصله إشعار فوراً، ويرى تقييمك ورقمك.'}
      </Text>

      <View style={{
        backgroundColor: theme.surface, borderRadius: radius.xxxl, borderWidth: 1,
        borderColor: theme.line, ...shadowSoft, padding: 16,
      }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle, marginBottom: 6, textAlign: 'right' }}>
          سعرك (د.ع)
        </Text>
        <Input value={price} onChangeText={setPrice} numeric ltr placeholder="0" />

        {attachable.length ? (
          <>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle, marginTop: 14, marginBottom: 6, textAlign: 'right' }}>
              اربط أحد إعلاناتك (اختياري)
            </Text>
            {/* Wraps rather than scrolls. As a row-reverse horizontal
                ScrollView, the FIRST child sits furthest right — so as soon
                as the seller had two matching listings the row overflowed
                and «بدون إعلان» slid off-screen, leaving no way to undo an
                attachment. Wrapping keeps every option reachable. */}
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, paddingHorizontal: 2 }}>
              <Pill active={listingId === null} onPress={() => setListingId(null)}>بدون إعلان</Pill>
              {attachable.map((l: Listing) => (
                <Pill key={l.id} active={listingId === l.id} onPress={() => {
                  setListingId(l.id);
                  // Only when empty: filling a box the seller already typed
                  // into would throw away his number.
                  setPrice((p) => (p.trim() ? p : String(l.asking_price)));
                }}>
                  {`${l.model} — ${fmtIQD(l.asking_price)}`}
                </Pill>
              ))}
            </View>
          </>
        ) : null}

        <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle, marginTop: 14, marginBottom: 6, textAlign: 'right' }}>
          ملاحظة (اختياري)
        </Text>
        <Input value={note} onChangeText={setNote} placeholder="مثلاً: متوفر أزرق 256، كفالة سنة" multiline />

        {/* Accent, not ink. This is the one act the whole screen exists for
            — every other control on it is a field — and on a white card an
            ink button is just the darkest rectangle among several. */}
        <View style={{ marginTop: 16, gap: 8 }}>
          <View style={{ borderRadius: radius.lg, ...shadowAccent }}>
            <Btn kind="accent" full busy={send.isPending} onPress={() => {
              const n = Number(String(price).replace(/[^\d]/g, ''));
              if (!Number.isFinite(n) || n <= 0) { Alert.alert('اكتب سعرك', 'السعر مطلوب لإرسال العرض.'); return; }
              send.mutate();
            }}>
              {existing ? 'حدّث عرضك' : 'أرسل العرض'}
            </Btn>
          </View>
          {existing ? (
            <Btn kind="ghost" full busy={withdraw.isPending} onPress={() => Alert.alert(
              'سحب العرض',
              'سيختفي عرضك من قائمة المشتري.',
              [{ text: 'إلغاء', style: 'cancel' }, { text: 'اسحب', style: 'destructive', onPress: () => withdraw.mutate() }],
            )}>
              اسحب العرض
            </Btn>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ─── bits ──────────────────────────────────────────────────────────────

function Chip({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.chipBg,
    }}>
      {icon}
      <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle }}>{children}</Text>
    </View>
  );
}
