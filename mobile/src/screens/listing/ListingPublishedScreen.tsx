// «نُشر إعلانك» — the moment after publishing, given a screen of its own.
//
// The app used to `navigation.replace` straight to the listing page, and any
// bad news — photos that failed to upload, photos awaiting review — arrived
// as a system Alert the seller dismissed with one tap on the way there. So
// the two things a seller most needs to know at that moment were the two
// things most likely to be missed.
//
// This holds both, and turns whatever the quality checklist still has to say
// into a single offer to finish the job rather than a list of complaints.

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Share } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, fmtIQD } from '../../components/ui';
import { IconCheck, IconSpark, IconShare, IconBell, IconChevronLeft, IconPin } from '../../components/icons';
import { Listings } from '../../api/endpoints';
import { timeAgoAr } from '../../lib/format';
import { arOf } from '../../lib/governorates';
import { bundledBrandLogo } from '../../lib/brandLogos';
import { Img } from '../../components/Img';
import { useTrack } from '../../analytics/track';

export default function ListingPublishedScreen({ route, navigation }: any) {
  const {
    id, brand, model, price, governorate,
    failedPhotos = 0, remaining = [],
  } = route.params || {};
  const insets = useSafeAreaInsets();
  const track = useTrack();

  React.useEffect(() => {
    track('listing.published_screen', { listing_id: id, remaining: remaining.length, failed_photos: failedPhotos });
  }, [id, remaining.length, failedPhotos, track]);

  const openListing = () => navigation.replace('ListingDetail', { id });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 28, paddingBottom: 40, gap: 14 }}>
        <View style={{ alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28, backgroundColor: theme.success,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <IconCheck size={28} color="#fff" sw={2.4} />
          </View>
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 22, color: theme.ink }}>
            نُشر إعلانك
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'center' }}>
            {[brand, model].filter(Boolean).join(' ')}
            {price ? ` · ${fmtIQD(Number(price))} د.ع` : ''}
            {governorate ? ` · ${governorate}` : ''}
          </Text>
        </View>

        {/* What happens now. Written as facts about the listing, not as
            reassurance — a seller who is told "don't worry" learns nothing. */}
        <View style={{
          backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
          borderRadius: radius.xxl, padding: 14, gap: 10,
        }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
            ماذا يحدث الآن
          </Text>
          <Row tone="success" text="الإعلان ظاهر للمشترين الآن — بصوره." />
          {/* Only a REAL problem gets a row. This used to also report
              «الصور قيد المراجعة» whenever any photo uploaded, describing an
              approval step that does not exist — the photos were already
              live while the seller was told to wait for them. A failed
              upload is the one thing here that is genuinely outstanding. */}
          {failedPhotos > 0 ? (
            <Row
              tone="pending"
              text={`${failedPhotos} من الصور لم تُرفع بسبب الاتصال — تقدر ترفعها من «تعديل الإعلان».`}
            />
          ) : null}
          <Row tone="success" text="يصلك تنبيه فور مراسلة أول مشترٍ." />
        </View>

        {/* The remaining checklist, as one offer instead of a list of
            complaints. Nothing here blocks anything — the listing is already
            live and stays live whatever the seller does next. */}
        {remaining.length > 0 ? (
          <View style={{
            backgroundColor: theme.accentSoft, borderWidth: 1.5, borderColor: theme.accent,
            borderRadius: radius.xxl, padding: 14, gap: 8,
          }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <IconSpark size={16} color={theme.accentDeep} />
              <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink }}>
                {remaining.length === 1 ? 'إعلانك أقوى بخطوة واحدة' : 'إعلانك أقوى بخطوتين'}
              </Text>
            </View>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, lineHeight: 20, color: theme.subtle, textAlign: 'right' }}>
              {remaining.slice(0, 2).map((r: any) => r.title).join(' · ')}
            </Text>
            <Btn kind="accent" full onPress={() => navigation.replace('EditListing', { id })}>
              أكمل الآن · دقيقة واحدة
            </Btn>
          </View>
        ) : null}

        {/* People who already asked for exactly this, nearby.
        
            The seller has just described a phone; some of these buyers wrote
            down that they want it days ago. Before this the only way they
            met was a push notification, which is one alert for however many
            requests match and is gone the moment it is swiped. */}
        <BuyersWaiting id={id} navigation={navigation} />

        <View style={{ gap: 10, marginTop: 4 }}>
          <Btn kind="primary" full onPress={openListing}>عرض الإعلان</Btn>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              const url = `https://iqmobile.org/l/${id}`;
              track('listing.share', { listing_id: id, brand, from: 'published' });
              Share.share({
                message: `${[brand, model].filter(Boolean).join(' ')}${price ? ` · ${fmtIQD(Number(price))} د.ع` : ''}\n${url}`,
              }).catch(() => {});
            }}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 13, borderRadius: radius.pill,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, ...shadowSoft,
            }}
          >
            <IconShare size={15} color={theme.ink} sw={1.7} />
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink }}>
              مشاركة
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Open requests, in this governorate, that the listing just posted answers.
 *
 * Renders nothing while loading and nothing when there are none — this is a
 * bonus on a success screen, and an empty «مشترون ينتظرون» heading would
 * turn good news into a report of absence.
 *
 * Tapping one opens the request, where the offer form already lives. That is
 * deliberately not a phone number: an offer notifies the buyer, is recorded,
 * and can be updated or withdrawn, where a cold call is none of those.
 */
function BuyersWaiting({ id, navigation }: { id: number; navigation: any }) {
  const q = useQuery({
    queryKey: ['listing-matching-requests', id],
    queryFn: () => Listings.matchingRequests(id),
    enabled: !!id,
    staleTime: 60_000,
    // A brand-new listing is the input to this, and the seller lands here
    // within a second of the insert. One quiet retry covers the gap.
    retry: 1,
  });
  const rows = q.data || [];
  if (rows.length === 0) return null;

  return (
    <View style={{
      backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
      borderRadius: radius.xxl, padding: 14, gap: 10, ...shadowSoft,
    }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 6 }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink }}>
          {rows.length === 1 ? 'مشترٍ ينتظر هذا الجهاز' : 'مشترون ينتظرون هذا الجهاز'}
        </Text>
        {rows.length > 1 ? (
          <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 12, color: theme.accentDeep }}>
            {rows.length}
          </Text>
        ) : null}
      </View>
      <Text style={{ fontFamily: fonts.arRegular, fontSize: 12.5, lineHeight: 20, color: theme.subtle, textAlign: 'right' }}>
        طلبوا نفس الجهاز في محافظتك. أرسل لهم سعرك مباشرة.
      </Text>

      {rows.map((r) => {
        const mark = bundledBrandLogo(r.brand);
        return (
          <TouchableOpacity
            key={r.id}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('RequestDetail', { id: r.id })}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
              backgroundColor: theme.inset, borderRadius: radius.lg, padding: 11,
            }}
          >
            <View style={{
              width: 36, height: 36, borderRadius: radius.md, backgroundColor: theme.surface,
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              {mark ? <Img source={mark} contentFit="contain" style={{ width: 22, height: 22 }} /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 5 }}>
                <Text style={{ fontFamily: fonts.arRegular, fontSize: 11.5, color: theme.subtle }}>ميزانيته حتى</Text>
                <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 14, color: theme.accentDeep }}>
                  {fmtIQD(r.max_price)}
                </Text>
                <Text style={{ fontFamily: fonts.arRegular, fontSize: 11, color: theme.subtle }}>د.ع</Text>
              </View>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <IconPin size={11} color={theme.subtle} sw={1.7} />
                <Text numberOfLines={1} style={{ fontFamily: fonts.arRegular, fontSize: 11, color: theme.subtle }}>
                  {arOf(r.governorate)} · {timeAgoAr(r.created_at)}
                </Text>
              </View>
              {/* Said out loud rather than hidden. A seller who opens this
                  expecting a clean match and finds their price is over the
                  buyer's ceiling learns we wasted their time. */}
              {r.above_budget ? (
                <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.accentDeep, textAlign: 'right', marginTop: 3 }}>
                  سعرك أعلى من ميزانيته — تقدر تتفاوض
                </Text>
              ) : null}
            </View>
            <IconChevronLeft size={14} color={theme.subtle} sw={2} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Row({ tone, text }: { tone: 'success' | 'pending'; text: string }) {
  const ok = tone === 'success';
  return (
    <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 9 }}>
      <View style={{ marginTop: 2 }}>
        {ok ? <IconCheck size={14} color={theme.success} sw={2.2} /> : <IconBell size={14} color={theme.accentDeep} />}
      </View>
      <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 12.5, lineHeight: 20, color: theme.ink, textAlign: 'right' }}>
        {text}
      </Text>
    </View>
  );
}
