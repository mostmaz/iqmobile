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
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
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

  const colW = items.length >= 3 ? 108 : 140;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="مقارنة" onBack={() => navigation.goBack()} />
      {isLoading ? (
        <View style={{ paddingTop: 40 }}><ActivityIndicator color={theme.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {/* Column heads: the listings themselves, each removable so the
              buyer can swap one out without leaving the comparison. */}
          <View style={{ flexDirection: 'row-reverse', paddingHorizontal: 12, paddingTop: 12, gap: 8 }}>
            <View style={{ width: 74 }} />
            {items.map((i: any) => (
              <View key={i.id} style={{ width: colW, alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('ListingDetail', { id: i.id })}
                  activeOpacity={0.85}
                  style={{ alignItems: 'center' }}
                >
                  <View style={{
                    width: colW - 16, height: colW - 16, borderRadius: radius.lg,
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

          <Text style={{
            fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle,
            textAlign: 'right', paddingHorizontal: 16, marginTop: 14, marginBottom: 6,
          }}>
            الصفوف المظللة هي اللي تختلف بيناتهم.
          </Text>

          <View style={{ marginHorizontal: 12, borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: theme.line }}>
            {rows.map((r, ri) => {
              const hot = differs(r);
              return (
                <View
                  key={r.label}
                  style={{
                    flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 8, paddingVertical: 10,
                    backgroundColor: hot ? theme.accentSoft : theme.surface,
                    borderTopWidth: ri === 0 ? 0 : 1, borderTopColor: theme.line,
                  }}
                >
                  <Text
                    maxFontSizeMultiplier={FONT_SCALE_TIGHT}
                    style={{ width: 74, fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}
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
