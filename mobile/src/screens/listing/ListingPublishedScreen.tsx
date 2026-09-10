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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, fmtIQD } from '../../components/ui';
import { IconCheck, IconSpark, IconShare, IconBell } from '../../components/icons';
import { useTrack } from '../../analytics/track';

export default function ListingPublishedScreen({ route, navigation }: any) {
  const {
    id, brand, model, price, governorate,
    photosPending = 0, failedPhotos = 0, remaining = [],
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
          <Row tone="success" text="الإعلان ظاهر للمشترين الآن." />
          {photosPending > 0 || failedPhotos > 0 ? (
            <Row
              tone="pending"
              text={failedPhotos > 0
                ? `${failedPhotos} من الصور لم تُرفع بسبب الاتصال — تقدر ترفعها من «تعديل الإعلان».`
                : 'الصور قيد المراجعة — تظهر بعد موافقة الإدارة، عادة خلال ساعات.'}
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
