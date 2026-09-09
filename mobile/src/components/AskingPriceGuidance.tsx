// What comparable phones are being asked for, as a bar the seller can read
// at a glance and tap for the method.
//
// It used to be four lines of prose with the word «وسيط» in three of them.
// A seller pricing a phone wants one question answered — am I high or low —
// and a number in a sentence makes them do the comparison themselves. The
// bar does it: the range is the track, the market sits on it, and so do they.
//
// The figure is called «المتوسط» because that is the everyday word, but it is
// the MIDDLE value, not the mean, and the method sheet says so. That is not
// pedantry here: this marketplace has had a listing priced at a phone number
// and another at a thousand trillion dinars, and a mean would have followed
// both of them off the chart.

import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { fmtIQD } from './ui';
import { barPoints } from '../lib/priceBar';

type Props = {
  brand: string; model: string; storage: string;
  condition: string; governorate: string; askingPrice: number;
};
type Comparison = {
  count: number; median: number | null; low: number | null; high: number | null;
  window_days?: number; location_scope?: string; minimum_sample?: number;
};

export function AskingPriceGuidance({ askingPrice, ...filters }: Props) {
  const ready = Object.values(filters).every((value) => !!value?.trim());
  const [howOpen, setHowOpen] = React.useState(false);
  const query = useQuery({
    queryKey: ['asking-price-guidance', filters],
    queryFn: () => api<Comparison>('/listings/price-guidance?'
      + Object.entries(filters).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')),
    enabled: ready, staleTime: 60000, retry: 1,
  });
  const r = query.data;
  const sub = { fontFamily: fonts.ar, color: theme.subtle, textAlign: 'right' as const, lineHeight: 21 };
  const has = !!r && r.median !== null && r.low !== null && r.high !== null;

  return (
    <View style={{
      padding: 14, marginBottom: 12, gap: 10, borderWidth: 1, borderColor: theme.line,
      borderRadius: radius.lg, backgroundColor: theme.surface,
    }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ ...sub, fontFamily: fonts.arBold, color: theme.ink, fontSize: 14 }}>
          متوسط أسعار الجهاز
        </Text>
        {has ? (
          <TouchableOpacity onPress={() => setHowOpen(true)} hitSlop={8} accessibilityRole="button">
            <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: theme.accent }}>كيف يُحسب؟</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {!ready ? (
        <Text style={sub}>اختر الموديل والسعة لعرض المقارنة.</Text>
      ) : query.isPending ? (
        <Text style={sub}>جارٍ تحميل الأسعار…</Text>
      ) : query.isError ? (
        <>
          <Text style={sub}>تعذر تحميل المقارنة. يمكنك متابعة النشر.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => query.refetch()}>
            <Text style={{ ...sub, color: theme.accent }}>إعادة المحاولة</Text>
          </TouchableOpacity>
        </>
      ) : has ? (
        <TouchableOpacity activeOpacity={0.9} onPress={() => setHowOpen(true)} accessibilityRole="button">
          <PriceBar low={r!.low!} high={r!.high!} median={r!.median!} price={askingPrice} />
          <Text style={{ ...sub, fontSize: 12, marginTop: 8 }}>
            من {r!.count} إعلاناً مشابهاً في كل المحافظات خلال آخر {r!.window_days ?? 90} يوماً.
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={sub}>
          لا توجد إعلانات مشابهة كافية للمقارنة ({r?.count ?? 0}؛ نحتاج {r?.minimum_sample ?? 3} على الأقل).
        </Text>
      )}

      <HowSheet visible={howOpen} onClose={() => setHowOpen(false)} data={r} />
    </View>
  );
}

/**
 * The range as a track, the market as a tick, the seller as a dot.
 *
 * Both markers are absolutely positioned by fraction, which is why
 * `barPoints` clamps: a seller asking far above every comparable listing
 * would otherwise be drawn outside the bar and clipped off the card.
 */
function PriceBar({ low, high, median, price }: {
  low: number; high: number; median: number; price: number;
}) {
  const p = barPoints(low, high, median, price);
  const mine = p.price !== null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 19, color: theme.ink, textAlign: 'right',
      }}>
        {fmtIQD(median)} <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>د.ع</Text>
      </Text>

      <View style={{ height: 34, justifyContent: 'center' }}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.chipBg, overflow: 'hidden' }} />
        {/* The market's middle. A line, not a dot: it marks a boundary. */}
        <View style={{
          position: 'absolute', left: `${p.median * 100}%`, marginLeft: -1.5,
          width: 3, height: 18, borderRadius: 2, backgroundColor: theme.ink,
        }} />
        {mine ? (
          <View style={{
            position: 'absolute', left: `${p.price! * 100}%`, marginLeft: -7,
            width: 14, height: 14, borderRadius: 7,
            backgroundColor: theme.accent, borderWidth: 2, borderColor: theme.surface,
          }} />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: theme.subtle }}>{fmtIQD(low)}</Text>
        <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: theme.subtle }}>{fmtIQD(high)}</Text>
      </View>

      {mine ? (
        <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.ink, textAlign: 'right', lineHeight: 20 }}>
          {p.priceOutside === 'above' ? 'سعرك أعلى من كل الإعلانات المشابهة'
            : p.priceOutside === 'below' ? 'سعرك أقل من كل الإعلانات المشابهة'
            : price > median ? 'سعرك أعلى من المتوسط'
            : price < median ? 'سعرك أقل من المتوسط'
            : 'سعرك يساوي المتوسط'}
        </Text>
      ) : null}
    </View>
  );
}

/** The method, in full, because the number is only useful if it is trusted. */
function HowSheet({ visible, onClose, data }: {
  visible: boolean; onClose: () => void; data?: Comparison;
}) {
  const days = data?.window_days ?? 90;
  const body = { fontFamily: fonts.ar, fontSize: 13, color: theme.ink, textAlign: 'right' as const, lineHeight: 22 };
  const dim = { ...body, color: theme.subtle, fontSize: 12.5 };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={{
          backgroundColor: theme.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
          paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, maxHeight: '80%',
        }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: 14 }} />
          <ScrollView>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right', marginBottom: 10 }}>
              كيف يُحسب متوسط أسعار الجهاز
            </Text>
            <Text style={body}>
              نأخذ الإعلانات النشطة لنفس الموديل ونفس السعة، ونرتّب أسعارها، ثم نعرض السعر الذي يقع في المنتصف.
            </Text>
            <Text style={{ ...dim, marginTop: 8 }}>
              السعر الأوسط وليس المعدّل الحسابي: إعلان واحد بسعر خاطئ يسحب المعدّل بعيداً، ولا يحرّك الأوسط.
            </Text>

            <Text style={{ ...body, fontFamily: fonts.arBold, marginTop: 16, marginBottom: 6 }}>ما الذي يدخل في الحساب</Text>
            <Bullet>نفس الموديل ونفس السعة بالضبط.</Bullet>
            <Bullet>كل المحافظات معاً — العراق سوق واحدة للأجهزة.</Bullet>
            <Bullet>الإعلانات النشطة المنشورة خلال آخر {days} يوماً.</Bullet>
            <Bullet>كل الحالات معاً: جديد وكالجديد ومستعمل ومصلّح.</Bullet>

            <Text style={{ ...body, fontFamily: fonts.arBold, marginTop: 16, marginBottom: 6 }}>ما الذي لا يدخل</Text>
            <Bullet>إعلاناتك أنت.</Bullet>
            <Bullet>الإعلانات بدون سعر معلن.</Bullet>
            <Bullet>الإعلانات المباعة أو المنتهية.</Bullet>
            <Bullet>أي إعلان بسعر أقل من 100,000 د.ع.</Bullet>

            <Text style={{ ...dim, marginTop: 16 }}>
              نحتاج {data?.minimum_sample ?? 3} إعلانات على الأقل، وإلا لا نعرض شيئاً — رقم مبني على إعلانين ليس مؤشراً.
            </Text>
            <Text style={{ ...dim, marginTop: 10 }}>
              هذه أسعار يطلبها البائعون، وليست أسعار صفقات مكتملة ولا تقييماً مضموناً لجهازك. المقارنة تجمع كل الحالات، فجهاز جديد يُقارن بأجهزة مصلّحة أيضاً. خذها كمؤشر — السعر النهائي قرارك.
            </Text>

            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.85}
              style={{ marginTop: 20, paddingVertical: 13, borderRadius: radius.pill, backgroundColor: theme.ink, alignItems: 'center' }}
            >
              <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.buttonInk }}>تم</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: 5 }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}>•</Text>
      <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13, color: theme.ink, textAlign: 'right', lineHeight: 21 }}>
        {children}
      </Text>
    </View>
  );
}
