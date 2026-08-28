// Two or three listings, side by side.
//
// The whole value is in the DIFFERENCES. A table where every row looks alike
// makes the buyer do the diffing themselves, which is the work they opened
// this to avoid — so rows whose values differ are tinted and rows that agree
// are left plain, and the cheapest price is marked.
//
// It deliberately does not score or rank. These listings differ on axes that
// trade against each other — cheaper but a smaller battery, newer chipset at
// a worse price — and a winner would be inventing a preference the buyer
// never stated. Show the differences; the buyer decides what they are worth.
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Header, fmtIQD } from '../../components/ui';
import { Img } from '../../components/Img';
import { IconClose } from '../../components/icons';
import { Listings } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { useCompare } from '../../lib/compare';
import { ar } from '../../i18n/ar';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../../theme';

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

type Row = {
  label: string;
  values: Array<string | null>;
  /** Latin product names stay LTR — a transliterated chipset is unreadable. */
  ltr?: boolean;
  /** Index of the best value, when "best" is unambiguous (price only). */
  best?: number | null;
};

export default function CompareScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { ids, remove, clear } = useCompare();

  const { data, isLoading } = useQuery({
    queryKey: ['compare', ids.join(',')],
    queryFn: () => Listings.compare(ids),
    enabled: ids.length >= 2,
  });

  const items = data?.items ?? [];

  const rows = useMemo<Row[]>(() => {
    if (items.length < 2) return [];
    const spec = (i: any) => i.specs || {};
    const prices = items.map((i: any) => i.asking_price);
    const cheapest = prices.indexOf(Math.min(...prices));

    const out: Row[] = [
      {
        label: 'السعر',
        values: items.map((i: any) => `${fmtIQD(i.asking_price)} د.ع`),
        best: cheapest,
      },
      { label: 'الحالة', values: items.map((i: any) => (ar.listing as any)[i.condition] || i.condition) },
      { label: 'السعة', values: items.map((i: any) => i.storage || null) },
      { label: 'اللون', values: items.map((i: any) => i.color || null) },
      {
        label: 'صحة البطارية',
        values: items.map((i: any) => (i.battery_health ? `${arNum(i.battery_health)}٪` : null)),
      },
      { label: 'المحافظة', values: items.map((i: any) => i.governorate || null) },
      { label: 'البائع', values: items.map((i: any) => i.seller_name || null) },
      // ── the device itself ──
      {
        label: 'الشاشة',
        values: items.map((i: any) => (spec(i).display_inches ? `${arNum(spec(i).display_inches)} بوصة` : null)),
      },
      { label: 'المعالج', values: items.map((i: any) => spec(i).chipset || null), ltr: true },
      {
        label: 'الرام',
        values: items.map((i: any) => (spec(i).ram_gb ? `${arNum(String(spec(i).ram_gb))} جيجا` : null)),
      },
      {
        label: 'البطارية',
        values: items.map((i: any) => (spec(i).battery_mah ? `${arNum(spec(i).battery_mah)} mAh` : null)),
      },
      {
        label: 'سرعة الشحن',
        values: items.map((i: any) => (spec(i).charge_w ? `${arNum(spec(i).charge_w)} واط` : null)),
      },
      {
        label: 'الكاميرا',
        values: items.map((i: any) => (spec(i).camera_main_mp ? `${arNum(spec(i).camera_main_mp)} ميجابكسل` : null)),
      },
    ];

    // Drop rows nobody has a value for — an empty row is noise in a table
    // this narrow.
    return out.filter((r) => r.values.some((v) => v != null && v !== ''));
  }, [items]);

  const differs = (r: Row) => new Set(r.values.map((v) => v ?? '—')).size > 1;

  // "Show only what differs" — on two phones of the same model most rows
  // are identical, and scrolling past eight matching rows to find the two
  // that matter is the work this screen exists to remove.
  const [onlyDiff, setOnlyDiff] = useState(false);
  const shown = onlyDiff ? rows.filter(differs) : rows;

  // The gap between cheapest and dearest, stated once in words. It is the
  // first thing a buyer works out by hand, and the one number the table
  // makes them compute across two columns.
  const gap = useMemo(() => {
    if (items.length < 2) return null;
    const prices = items.map((i: any) => i.asking_price).filter((n: number) => n > 0);
    if (prices.length < 2) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (max === min) return { same: true, diff: 0, pct: 0 };
    return { same: false, diff: max - min, pct: Math.round(((max - min) / max) * 100) };
  }, [items]);

  if (ids.length < 2) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Header title="مقارنة" onBack={() => navigation.goBack()} />
        <View style={{ padding: 32, alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.subtle, textAlign: 'center', lineHeight: 24 }}>
            اختر جهازين أو ثلاثة من صفحة الإعلان — زر «قارن» فوق الصورة — وتشوفهم هنا جنب بعض.
          </Text>
        </View>
      </View>
    );
  }

  // Column width is computed from the screen rather than fixed or flexed.
  // A fixed 108pt overran a 402pt screen at three columns and cut the first
  // one off the edge; flex:1 did not constrain it either, because the
  // device name inside sizes the column to itself. Arithmetic always fits.
  const LABEL_W = 58;
  const GAP = 6;
  const H_PAD = 8;      // inside the table card
  const H_MARGIN = 12;  // the card's own margin
  const colW = Math.floor(
    (Dimensions.get('window').width - H_MARGIN * 2 - H_PAD * 2 - LABEL_W - GAP * items.length) /
    Math.max(1, items.length),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="مقارنة" onBack={() => navigation.goBack()} />
      {isLoading ? (
        <View style={{ paddingTop: 40 }}><ActivityIndicator color={theme.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {/* Column heads: the listings themselves, each removable so the
              buyer can swap one out without leaving the comparison. */}
          <View style={{
            flexDirection: 'row-reverse', paddingHorizontal: H_MARGIN + H_PAD,
            paddingTop: 12, gap: GAP,
          }}>
            <View style={{ width: LABEL_W }} />
            {items.map((i: any) => (
              <View key={i.id} style={{ width: colW, alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('ListingDetail', { id: i.id })}
                  activeOpacity={0.85}
                  // Without a width the touchable sizes to its text, and a
                  // long name ("Apple iPhone 13") pushed its column — and
                  // the whole row — past the screen edge.
                  style={{ alignItems: 'center', width: '100%' }}
                >
                  <View style={{
                    width: '100%', aspectRatio: 1, borderRadius: radius.lg,
                    backgroundColor: theme.chipBg, overflow: 'hidden',
                  }}>
                    {i.image_path ? (
                      <Img source={{ uri: fullImageUrl(i.image_path) }} style={{ width: '100%', height: '100%' }} />
                    ) : null}
                  </View>
                  <Text
                    numberOfLines={2}
                    style={{
                      fontFamily: fonts.arBold, fontSize: 12, color: theme.ink,
                      textAlign: 'center', marginTop: 6,
                    }}
                  >
                    {i.brand} {i.model}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => remove(i.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginTop: 4, flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}
                >
                  <IconClose size={11} color={theme.subtle} sw={2} />
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle }}>شيله</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* Price gap first — the question behind the comparison. */}
          {gap ? (
            <View style={{
              marginHorizontal: 12, marginTop: 14, paddingVertical: 11, paddingHorizontal: 14,
              borderRadius: radius.xl,
              backgroundColor: gap.same ? theme.chipBg : theme.successSoft,
            }}>
              <Text style={{
                fontFamily: fonts.arBold, fontSize: 13.5,
                color: gap.same ? theme.chipInk : theme.success, textAlign: 'right',
              }}>
                {gap.same
                  ? 'نفس السعر بالضبط'
                  : `فرق السعر ${fmtIQD(gap.diff)} د.ع — ${arNum(gap.pct)}٪`}
              </Text>
            </View>
          ) : null}

          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, marginTop: 12, marginBottom: 6, gap: 10,
          }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, flex: 1, textAlign: 'right' }}>
              {onlyDiff ? 'نعرض الاختلافات فقط.' : 'الصفوف المظللة هي اللي تختلف بيناتهم.'}
            </Text>
            <TouchableOpacity
              onPress={() => setOnlyDiff((v) => !v)}
              activeOpacity={0.85}
              style={{
                paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: onlyDiff ? theme.accent : theme.line,
                backgroundColor: onlyDiff ? theme.accentSoft : 'transparent',
              }}
            >
              <Text
                maxFontSizeMultiplier={FONT_SCALE_TIGHT}
                style={{
                  fontFamily: fonts.arBold, fontSize: 11.5,
                  color: onlyDiff ? theme.accentDeep : theme.subtle,
                }}
              >
                الاختلافات فقط
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginHorizontal: H_MARGIN, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: theme.line }}>
            {shown.map((r, ri) => {
              const hot = differs(r);
              return (
                <View
                  key={r.label}
                  style={{
                    flexDirection: 'row-reverse', gap: GAP,
                    paddingHorizontal: H_PAD, paddingVertical: 10,
                    backgroundColor: hot ? theme.accentSoft : theme.surface,
                    borderTopWidth: ri === 0 ? 0 : 1, borderTopColor: theme.line,
                  }}
                >
                  <Text
                    maxFontSizeMultiplier={FONT_SCALE_TIGHT}
                    style={{ width: LABEL_W, fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}
                  >
                    {r.label}
                  </Text>
                  {r.values.map((v, vi) => (
                    <View key={vi} style={{ width: colW }}>
                      <Text
                        maxFontSizeMultiplier={FONT_SCALE_TIGHT}
                        numberOfLines={3}
                        style={{
                          fontFamily: r.best === vi ? fonts.arBold : (r.ltr ? fonts.ltr : fonts.ar),
                          fontSize: 12,
                          color: r.best === vi ? theme.success : (v ? theme.ink : theme.subtle),
                          textAlign: r.ltr ? 'left' : 'right',
                          writingDirection: r.ltr ? 'ltr' : 'rtl',
                        }}
                      >
                        {v ?? '—'}
                      </Text>
                      {r.best === vi ? (
                        <Text style={{ fontFamily: fonts.ar, fontSize: 9.5, color: theme.success, textAlign: 'right' }}>
                          الأرخص
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={() => { clear(); navigation.goBack(); }}
            style={{ alignSelf: 'center', marginTop: 18, paddingVertical: 8, paddingHorizontal: 16 }}
          >
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
              افرغ المقارنة
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}
