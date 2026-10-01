// حالة الإعلان — where a listing stands with the quality check.
//
// Three roads lead here: the post wizard, when the model objected and the
// listing did not go live; a notification tap, when an operator decided; and
// «إعلاناتي», from a card that says «قيد المراجعة». It is the one screen
// that can show a REJECTED listing, which the detail route 404s for — so the
// seller who is told «لم يُنشر» has somewhere the reason lives.
//
// Polls while the answer is still being decided, with the schedule in
// lib/listingReview.ts; gives up after a minute and says the push will do
// the rest, rather than spinning at the seller forever.

import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, Header, fmtIQD } from '../../components/ui';
import { IconCheck, IconBell, IconClose, IconSpark } from '../../components/icons';
import { Img } from '../../components/Img';
import { LoadFailed } from '../../components/LoadFailed';
import { Listings, type ListingReview } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { arOf } from '../../lib/governorates';
import { reviewSettled, reviewPollDelay, reviewCopy, REVIEW_GIVE_UP_MS } from '../../lib/listingReview';
import { useTrack } from '../../analytics/track';
import { subscribeSSE } from '../../sse/client';

export default function ListingStatusScreen({ route, navigation }: any) {
  const id = Number(route.params?.id);
  const insets = useSafeAreaInsets();
  const track = useTrack();
  const startedAt = React.useRef(Date.now());
  // Its own timer, never a setState inside refetchInterval (that re-renders,
  // re-evaluates the callback, and loops).
  const [gaveUp, setGaveUp] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), REVIEW_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, []);

  const q = useQuery({
    queryKey: ['listing-review', id],
    queryFn: () => Listings.review(id),
    enabled: Number.isFinite(id) && id > 0,
    // Keep asking while the model is still looking; stop once it has
    // answered, or once we have waited long enough that a push is the
    // better messenger.
    refetchInterval: (query) => {
      const state = (query.state.data as ListingReview | undefined)?.state;
      if (reviewSettled(state) || gaveUp) return false;
      return reviewPollDelay(Date.now() - startedAt.current) ?? false;
    },
    refetchIntervalInBackground: false,
  });
  const data = q.data;
  const state = data?.state;

  // The operator's decision arrives live: a seller who kept this screen
  // open while waiting sees «نُشر» / «لم يُنشر» the moment it is made,
  // not on the next visit.
  const refetch = q.refetch;
  React.useEffect(() => {
    const unsub = subscribeSSE((event: string, payload?: any) => {
      if (!String(event).startsWith('listing.review.')) return;
      if (payload?.listing_id && Number(payload.listing_id) !== id) return;
      refetch();
    });
    return () => { unsub(); };
  }, [id, refetch]);

  React.useEffect(() => {
    if (state) track('listing.status_screen', { listing_id: id, state });
  }, [id, state, track]);

  const copy = reviewCopy(gaveUp && !reviewSettled(state) ? 'timeout' : (state || 'checking'), data?.reason);
  const l = data?.listing;
  const name = l ? `${l.brand} ${l.model}` : '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title="حالة الإعلان" onBack={() => navigation.goBack()} />
      {q.error && !data ? (
        <LoadFailed error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12, paddingBottom: 40, gap: 14 }}>
          <View style={{ alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <Badge tone={copy.tone} />
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 21, color: theme.ink, textAlign: 'center' }}>
              {copy.title}
            </Text>
          </View>

          {/* The listing, so the seller with three ads knows which one. */}
          {l ? (
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
              borderRadius: radius.xxl, padding: 12, ...shadowSoft,
            }}>
              <View style={{ width: 56, height: 56, borderRadius: radius.lg, backgroundColor: theme.inset, overflow: 'hidden' }}>
                {l.image ? <Img source={{ uri: fullImageUrl(l.image) }} contentFit="cover" style={{ width: 56, height: 56 }} /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right', writingDirection: 'ltr' }}>
                  {name}
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
                  {fmtIQD(Number(l.asking_price))} د.ع · {arOf(l.governorate)}
                </Text>
              </View>
            </View>
          ) : null}

          <View style={{
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            borderRadius: radius.xxl, padding: 14,
          }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, lineHeight: 23, color: theme.ink, textAlign: 'right' }}>
              {copy.body}
            </Text>
          </View>

          {/* What the seller can do about it, per state. Nothing here is a
              way round the review: editing a held listing keeps it held. */}
          <View style={{ gap: 10, marginTop: 4 }}>
            {state === 'published' ? (
              <Btn kind="primary" full onPress={() => navigation.navigate('ListingDetail', { id })}>عرض الإعلان</Btn>
            ) : null}
            {state === 'under_review' ? (
              <>
                <Btn kind="ghost" full onPress={() => navigation.navigate('EditListing', { id })}>تعديل الإعلان أو الصور</Btn>
                <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'center', lineHeight: 18 }}>
                  يبقى الإعلان قيد المراجعة بعد التعديل — القرار لفريقنا.
                </Text>
              </>
            ) : null}
            {state === 'rejected' ? (
              <Btn kind="accent" full onPress={() => navigation.navigate('Main', { screen: 'Sell' })}>
                نشر إعلان آخر
              </Btn>
            ) : null}
            <Btn kind="ghost" full onPress={() => navigation.navigate('MyListings')}>إعلاناتي</Btn>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function Badge({ tone }: { tone: 'checking' | 'pending' | 'success' | 'danger' }) {
  const bg = tone === 'success' ? theme.success
    : tone === 'danger' ? theme.danger
      : tone === 'checking' ? theme.accentSoft : theme.accent;
  return (
    <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      {tone === 'checking' ? <ActivityIndicator color={theme.accentDeep} />
        : tone === 'success' ? <IconCheck size={28} color="#fff" sw={2.4} />
          : tone === 'danger' ? <IconClose size={26} color="#fff" sw={2.4} />
            : <IconBell size={26} color="#fff" />}
    </View>
  );
}

// Keep the import alive for a future "what the model saw" affordance; the
// spark is the mark the published screen uses for the same check.
void IconSpark;
