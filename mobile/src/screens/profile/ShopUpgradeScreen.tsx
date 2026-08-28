// What the advanced dashboard actually gives a shop, and the button to ask.
//
// Reached from the feed card. The order of the benefits is the order shops
// asked for them: editing prices in one tap first, it being the daily
// chore, then the things they did not know to want.
//
// Deliberately plain about the wait: the request goes to a human, and a
// screen that implies instant access would make a 24-hour review feel like
// a failure.
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header } from '../../components/ui';
import { Shops } from '../../api/endpoints';
import { theme, fonts, radius, FONT_SCALE_TIGHT, shadowSoft } from '../../theme';

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

const BENEFITS: Array<{ title: string; body: string }> = [
  {
    title: 'عدّل أسعارك بنقرة واحدة',
    body: 'اختر عشرين جهاز وغيّر أسعارها بضغطة — نسبة أو سعر موحّد — بدل ما تفتح كل إعلان لحاله.',
  },
  {
    title: 'شنو يدور عليه الناس بمحافظتك',
    body: 'كل أسبوع نكلك شنو بحث عنه الزبائن بمحافظتك وما لكوه — بضاعة تنباع لو توفرها.',
  },
  {
    title: 'أداء كل جهاز مع السبب',
    body: 'مو بس «مشاهدات قليلة» — نكلك ليش: سعرك أعلى من السوق، أو صورك أقل من ثلاثة.',
  },
  {
    title: 'رفع الأجهزة بملف Excel',
    body: 'ارفع قائمتك كلها بملف واحد بدل ما تدخلها جهاز جهاز.',
  },
];

export default function ShopUpgradeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const { data: status, isLoading } = useQuery({
    queryKey: ['shop-tier'],
    queryFn: () => Shops.myTier(),
  });

  const pending = status?.state === 'pending_review' || !!status?.requested_at;

  async function request() {
    if (sending) return;
    setSending(true);
    try {
      await Shops.requestTier({});
      qc.invalidateQueries({ queryKey: ['shop-tier'] });
      Alert.alert('وصلنا طلبك', 'نراجعه خلال ٢٤ ساعة ونخبرك بالإشعارات.', [
        { text: 'تمام', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      // The server owns the rules (already advanced, one open request,
      // 30-day wait after a rejection) — say which one was hit.
      const msg = e?.data?.error === 'request_pending' ? 'عندك طلب قيد المراجعة.'
        : e?.data?.error === 'already_advanced' ? 'لوحتك مرقّاة أصلاً.'
          : e?.data?.error === 'too_soon' ? 'تكدر تعيد الطلب بعد ٣٠ يوم من آخر رد.'
            : 'تعذّر إرسال الطلب، حاول مرة ثانية.';
      Alert.alert('ما انرسل', msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="لوحة إدارة المتجر" onBack={() => navigation.goBack()} />
      {isLoading ? (
        <View style={{ paddingTop: 40 }}><ActivityIndicator color={theme.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
          {/* The shop's own numbers, first — the reason it is being offered
              this at all, in its own terms. */}
          {status ? (
            <View style={{
              flexDirection: 'row-reverse', gap: 8, marginBottom: 16,
            }}>
              {[
                { n: status.signals.active_listings, l: 'جهاز معروض' },
                { n: status.signals.listings_30d, l: 'نشر هذا الشهر' },
                { n: status.signals.contacts_30d, l: 'تواصل هذا الشهر' },
              ].map((s) => (
                <View key={s.l} style={{
                  flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg,
                  borderWidth: 1, borderColor: theme.line, paddingVertical: 10, alignItems: 'center',
                }}>
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 19, color: theme.accentDeep }}>
                    {arNum(s.n)}
                  </Text>
                  <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
                    fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle, marginTop: 2,
                  }}>
                    {s.l}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}>
            شنو تحصل باللوحة المتقدمة
          </Text>

          <View style={{ marginTop: 12, gap: 10 }}>
            {BENEFITS.map((b, i) => (
              <View key={b.title} style={{
                backgroundColor: theme.surface, borderRadius: radius.xl,
                borderWidth: 1, borderColor: theme.line, padding: 13, ...shadowSoft,
              }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                  <View style={{
                    width: 22, height: 22, borderRadius: 999, backgroundColor: theme.accentSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 11, color: theme.accentDeep }}>
                      {arNum(i + 1)}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, flex: 1, textAlign: 'right' }}>
                    {b.title}
                  </Text>
                </View>
                <Text style={{
                  fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
                  textAlign: 'right', lineHeight: 20, marginTop: 6,
                }}>
                  {b.body}
                </Text>
              </View>
            ))}
          </View>

          <Text style={{
            fontFamily: fonts.ar, fontSize: 12, color: theme.subtle,
            textAlign: 'right', marginTop: 14, lineHeight: 19,
          }}>
            اللوحة تفتحها من الكمبيوتر أو الموبايل على iqmobile.org/dashboard —
            نرسلك اسم الدخول بعد الموافقة. كل شي عندك هسه يبقى مثل ما هو.
          </Text>
        </ScrollView>
      )}

      {/* Sticky ask. Disabled with a reason rather than hidden, so the shop
          knows the request exists and where it stands. */}
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12,
        backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.line,
      }}>
        <TouchableOpacity
          onPress={request}
          disabled={pending || sending || !status?.can_request}
          activeOpacity={0.88}
          style={{
            borderRadius: radius.xl, paddingVertical: 15, alignItems: 'center',
            backgroundColor: pending || !status?.can_request ? theme.chipBg : theme.accent,
          }}
        >
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 15,
            color: pending || !status?.can_request ? theme.subtle : '#fff',
          }}>
            {sending ? 'جارٍ الإرسال…'
              : pending ? 'طلبك قيد المراجعة'
                : !status?.can_request ? 'ما تكدر تطلب هسه'
                  : 'اطلب الترقية'}
          </Text>
        </TouchableOpacity>
        {!pending ? (
          <Text style={{
            fontFamily: fonts.ar, fontSize: 11, color: theme.subtle,
            textAlign: 'center', marginTop: 7,
          }}>
            نراجع الطلب خلال ٢٤ ساعة
          </Text>
        ) : null}
      </View>
    </View>
  );
}
