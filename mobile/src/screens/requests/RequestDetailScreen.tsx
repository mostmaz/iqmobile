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
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Btn, Header, Pill, Input, fmtIQD } from '../../components/ui';
import {
  IconRequest, IconPin, IconStar, IconTag, IconClose, IconCheck,
  IconPhoneIcon, IconMsgCall, IconChevronLeft,
} from '../../components/icons';
import { Img } from '../../components/Img';
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
            <View style={{
              width: 40, height: 40, borderRadius: 13, backgroundColor: theme.chipBg,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <IconRequest size={20} color={theme.ink} sw={1.6} />
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
      <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right', marginBottom: 10 }}>
        {offers.length ? `العروض (${offers.length})` : 'العروض'}
      </Text>

      {offers.length === 0 ? (
        <View style={{
          padding: 26, alignItems: 'center', borderRadius: radius.xxl,
          borderWidth: 1, borderStyle: 'dashed', borderColor: theme.line,
        }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'center' }}>
            ما وصلت عروض بعد
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
            وصل طلبك إلى المتاجر التي تبيع هذا الجهاز. تصل العروض الأولى عادةً خلال ساعات.
          </Text>
        </View>
      ) : (
        offers.map((o) => <OfferCard key={o.id} offer={o} navigation={navigation} />)
      )}

      {isOpen ? (
        <View style={{ marginTop: 22, gap: 8 }}>
          <Btn kind="primary" full busy={busy} onPress={() => Alert.alert(
            'حصلت على الجهاز؟',
            'سنغلق الطلب ونوقف وصول عروض جديدة.',
            [{ text: 'لا', style: 'cancel' }, { text: 'نعم، حصلت عليه', onPress: () => onStatus('fulfilled') }],
          )}>
            حصلت على الجهاز
          </Btn>
          <Btn kind="ghost" full onPress={() => Alert.alert(
            'إغلاق الطلب',
            'لن تصلك عروض جديدة على هذا الطلب.',
            [{ text: 'إلغاء', style: 'cancel' }, { text: 'أغلق', style: 'destructive', onPress: () => onStatus('closed') }],
          )}>
            أغلق الطلب
          </Btn>
        </View>
      ) : request.status !== 'expired' ? (
        <View style={{ marginTop: 22 }}>
          <Btn kind="ghost" full busy={busy} onPress={() => onStatus('open')}>أعد فتح الطلب</Btn>
        </View>
      ) : null}
    </View>
  );
}

function OfferCard({ offer, navigation }: { offer: RequestOffer; navigation: any }) {
  const s = offer.seller;
  const logo = s?.shop_image_path || s?.profile_image_path;
  return (
    <View style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
      borderColor: theme.line, ...shadowSoft, padding: 14, marginBottom: 10,
    }}>
      {/* seller */}
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
        <View style={{
          width: 42, height: 42, borderRadius: 13, backgroundColor: theme.chipBg,
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
        backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
        borderColor: theme.line, padding: 14,
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

        <View style={{ marginTop: 14, gap: 8 }}>
          <Btn kind="primary" full busy={send.isPending} onPress={() => {
            const n = Number(String(price).replace(/[^\d]/g, ''));
            if (!Number.isFinite(n) || n <= 0) { Alert.alert('اكتب سعرك', 'السعر مطلوب لإرسال العرض.'); return; }
            send.mutate();
          }}>
            {existing ? 'حدّث عرضك' : 'أرسل العرض'}
          </Btn>
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
