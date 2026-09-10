// «ارفع إعلانك مجاناً» — watch one video, come back to the top of «الأحدث».
//
// The seller's side of a contract the server enforces: an ad that fails to
// load, or is closed early, costs nothing. That is not decoration — it is why
// the screen never marks a boost spent locally and always re-reads the
// server's own numbers afterwards.
//
// The copy is held to the standard HowFeaturingWorks.tsx set: it says what
// the mechanism does and stops there. A boost moves a listing up «الأحدث»;
// it does not buy a featured slot, and the design's own explainer says so
// beside the button rather than in a help page nobody opens.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, Header } from '../../components/ui';
import { IconBolt, IconCheck, IconBell, IconPlayCircle, IconLock } from '../../components/icons';
import { Boosts, type BoostState } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { useTrack } from '../../analytics/track';
import { showRewarded } from '../../ads/rewarded';
import {
  boostUiState, boostSlots, clockCountdown, longCountdownAr, arDigits,
} from '../../lib/boostState';

/** How long to keep asking the server whether Google's callback has landed. */
const POLL_MS = 1500;
const POLL_ATTEMPTS = 12;   // ~18s, then we stop and say it is still landing

export default function FreeBoostScreen({ route, navigation }: any) {
  const { id, label } = route.params || {};
  const { user } = useAuth();
  const qc = useQueryClient();
  const track = useTrack();

  const [watching, setWatching] = useState(false);
  const [tick, setTick] = useState(Date.now());

  const state = useQuery({
    queryKey: ['boost', id],
    queryFn: () => Boosts.state(id),
    staleTime: 10_000,
  });

  // One timer for every countdown on the screen. Per second, because the
  // spent state shows a ticking clock; the cost is one setState a second on
  // a screen with nothing else happening.
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const s: BoostState | undefined = state.data;
  const ui = useMemo(() => boostUiState(s, tick), [s, tick]);
  const slots = useMemo(() => boostSlots(s), [s]);

  useEffect(() => {
    if (s?.enabled) track('boost.screen_viewed', { listing_id: id, remaining: s.remaining });
  }, [s?.enabled, s?.remaining, id, track]);

  /** Poll until the server has seen Google's callback, or we give up saying so. */
  const pollForGrant = useCallback(async () => {
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let fresh: BoostState | null = null;
      try { fresh = await Boosts.state(id); } catch { /* keep trying */ }
      if (fresh?.last_attempt && ['boosted', 'scheduled', 'completed'].includes(fresh.last_attempt.status)) {
        qc.setQueryData(['boost', id], fresh);
        qc.invalidateQueries({ queryKey: ['listing', id] });
        qc.invalidateQueries({ queryKey: ['mine'] });
        qc.invalidateQueries({ queryKey: ['browse'] });
        return fresh;
      }
    }
    return null;
  }, [id, qc]);

  const watchAd = useCallback(async () => {
    if (watching) return;                     // rapid double-tap
    setWatching(true);
    track('boost.ad_requested', { listing_id: id });
    try {
      const started = await Boosts.start(id);
      const outcome = await showRewarded({
        adUnitId: started.ad_unit_id,
        nonce: started.nonce,
        userId: user?.id ?? 0,
      });

      if (outcome.status === 'unavailable') {
        track('boost.ad_failed', { listing_id: id, reason: 'unavailable' });
        Alert.alert('غير متاح الآن', 'الترويج غير متاح حالياً. جرّب بعد قليل — لم تُستخدم أي رفعة.');
        return;
      }
      if (outcome.status === 'failed') {
        track('boost.ad_failed', { listing_id: id, reason: 'error' });
        Alert.alert('تعذّر تشغيل الفيديو', 'لم تُستخدم أي رفعة. جرّب مرة أخرى.');
        return;
      }
      if (outcome.status === 'dismissed') {
        track('boost.ad_dismissed', { listing_id: id });
        Alert.alert('لم تُستخدم أي رفعة', 'أكمل الفيديو حتى النهاية حتى يُرفع إعلانك.');
        return;
      }

      // Earned. The grant itself arrives server-to-server, so wait for it.
      track('boost.ad_completed', { listing_id: id });
      const fresh = await pollForGrant();
      if (!fresh) {
        Alert.alert('تم — الرفع قيد التنفيذ', 'انتهى الفيديو ورفعتك محفوظة. قد تحتاج دقيقة حتى تظهر.');
        return;
      }
      const delayed = fresh.last_attempt?.boost_type === 'delayed_bump';
      Alert.alert(
        'تم رفع إعلانك 🚀',
        delayed
          ? 'إعلانك حالياً قريب من الأعلى، لذلك سيظهر بشكل مميز الآن وسنرفعه تلقائياً بعد ٤ ساعات.'
          : 'إعلانك رجع لأعلى «الأحدث»، ويظهر بشكل مميز لمدة ٤ ساعات.',
      );
    } catch (e: any) {
      const code = e?.data?.error || e?.message;
      const msg = code === 'boost_limit_reached' ? 'استخدمت رفعاتك المتاحة. جرّب لاحقاً.'
        : code === 'boost_cooldown' ? 'انتظر قليلاً قبل الرفعة التالية.'
          : code === 'listing_not_active' ? 'هذا الإعلان غير متاح للرفع.'
            : code === 'boost_disabled' ? 'الرفع المجاني غير مفعّل حالياً.'
              : 'تعذّر الاتصال. لم تُستخدم أي رفعة.';
      Alert.alert('لم تُستخدم أي رفعة', msg);
    } finally {
      setWatching(false);
      state.refetch();
    }
  }, [watching, id, user?.id, pollForGrant, track, state]);

  if (state.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Header title="ارفع إعلانك مجاناً" onBack={() => navigation.goBack()} />
        <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
      </View>
    );
  }

  const spent = ui.kind === 'exhausted';
  const msLeft = ui.kind === 'exhausted' || ui.kind === 'cooldown' ? ui.msLeft : 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="ارفع إعلانك مجاناً" eyebrow={label || undefined} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>

        {ui.kind === 'hidden' ? (
          <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 21 }}>
            الرفع المجاني غير متاح حالياً.
          </Text>
        ) : ui.kind === 'ineligible' ? (
          <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 21 }}>
            هذا الإعلان غير متاح للرفع — الرفع للإعلانات المعروضة فقط.
          </Text>
        ) : (
          <>
            {/* Hero: what you get, before what you have left. */}
            <View style={{
              backgroundColor: spent ? theme.successSoft : theme.accentSoft,
              borderWidth: 1.5, borderColor: spent ? theme.success : theme.accent,
              borderRadius: radius.xxl, padding: 16,
              flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
            }}>
              <View style={{
                width: 44, height: 44, borderRadius: radius.lg,
                backgroundColor: spent ? theme.success : theme.accent,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {spent ? <IconCheck size={22} color="#fff" /> : <IconBolt size={22} color="#fff" />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right' }}>
                  {spent ? 'استخدمت رفعاتك اليوم ✨' : `${arDigits(s?.max_per_24h ?? 2)} رفعات مجانية كل يوم`}
                </Text>
                <Text style={{ marginTop: 3, fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', lineHeight: 19 }}>
                  {spent
                    ? 'رفعاتك ترجع تلقائياً — لا حاجة لأي إجراء.'
                    : 'شاهد فيديو قصير ويرجع إعلانك لأعلى الإعلانات الجديدة.'}
                </Text>
              </View>
            </View>

            {/* The countdown, when there is one to show. */}
            {msLeft > 0 ? (
              <View style={{
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
                borderRadius: radius.xxl, padding: 14, alignItems: 'center', gap: 8,
              }}>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'center' }}>
                  {spent ? 'ترجع رفعاتك بعد' : 'الرفعة التالية بعد'}
                </Text>
                <View style={{ backgroundColor: theme.chipBg, borderRadius: radius.lg, paddingHorizontal: 20, paddingVertical: 10 }}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.ltrBold, fontSize: 30, color: theme.ink, letterSpacing: 1 }}>
                    {clockCountdown(msLeft)}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle }}>ساعة · دقيقة · ثانية</Text>
              </View>
            ) : null}

            {/* One tile per boost the seller gets, spent or not. */}
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              {slots.map((used, i) => (
                <View key={i} style={{
                  flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg,
                  borderWidth: 1.5, borderColor: used ? theme.line : theme.accent,
                  padding: 12, gap: 4,
                }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                    {used ? <IconCheck size={13} color={theme.success} /> : <IconBolt size={13} color={theme.accent} />}
                    <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink }}>
                      {i === 0 ? 'الرفعة الأولى' : i === 1 ? 'الرفعة الثانية' : `الرفعة ${arDigits(i + 1)}`}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right' }}>
                    {used ? 'استُخدمت' : 'متاحة الآن'}
                  </Text>
                </View>
              ))}
            </View>

            {/* Streak. Counts Baghdad days — see boostLimits.js. */}
            <View style={{
              backgroundColor: theme.successSoft, borderWidth: 1, borderColor: theme.success,
              borderRadius: radius.lg, padding: 12, gap: 8,
            }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink }}>
                  يوم {arDigits(s?.streak ?? 0)} متتالي
                </Text>
                <View style={{ flexDirection: 'row-reverse', gap: 4, flex: 1 }}>
                  {[0, 1, 2, 3, 4].map((i) => {
                    const on = i < (s?.streak ?? 0);
                    return (
                      <View key={i} style={{
                        width: 18, height: 18, borderRadius: 9,
                        alignItems: 'center', justifyContent: 'center',
                        backgroundColor: on ? theme.success : 'transparent',
                        borderWidth: on ? 0 : 1, borderStyle: on ? 'solid' : 'dashed',
                        borderColor: 'rgba(27,26,24,0.28)',
                      }}>
                        {on ? <IconCheck size={10} color="#fff" /> : null}
                      </View>
                    );
                  })}
                </View>
              </View>
              <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right', lineHeight: 18 }}>
                {s?.streak_used_today
                  ? 'ارجع باچر حتى تحافظ على السلسلة — كل يوم تفوته ترجع السلسلة للصفر.'
                  : 'استخدم رفعة اليوم حتى تكمل السلسلة — كل يوم تفوته ترجع السلسلة للصفر.'}
              </Text>
            </View>

            {/* What the mechanism actually does. Same shape and same honesty
                as HowFeaturingWorks.tsx, which exists because the previous
                promotion copy promised something the code could not do. */}
            <View style={{
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
              borderRadius: radius.lg, padding: 12, gap: 6,
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink, textAlign: 'right' }}>
                كيف يعمل الرفع؟
              </Text>
              {[
                'الرفع يعيد إعلانك إلى أعلى ترتيب «الأحدث» كأنك نشرته الآن، وينزل تدريجياً مع كل إعلان جديد بعده.',
                'الرفع ليس تمييزاً: ما يدخل المواضع المميّزة أعلى التصفّح — تلك تجي مع الباقات المدفوعة.',
                `لك ${arDigits(s?.max_per_24h ?? 2)} رفعات كل ٢٤ ساعة على حسابك كله، وبين كل رفعة والتي بعدها ٤ ساعات.`,
                'إذا كان إعلانك قريب من الأعلى أصلاً، نأجل الرفع ٤ ساعات حتى ما تضيع الرفعة.',
              ].map((line, i) => (
                <Text key={i} style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', lineHeight: 18 }}>
                  • {line}
                </Text>
              ))}
              <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                الرفع يزيد فرص الظهور، ولا يضمن البيع.
              </Text>
            </View>

            {ui.kind === 'available' ? (
              <>
                <Btn kind="accent" full busy={watching} onPress={watchAd}>
                  شاهد الفيديو وارفع إعلانك
                </Btn>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -4 }}>
                  <IconPlayCircle size={13} color={theme.subtle} />
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'center' }}>
                    مجاناً — بدون دفع ولا تحويل رصيد.
                  </Text>
                </View>
              </>
            ) : (
              <View style={{
                flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: theme.chipBg, borderRadius: radius.pill, paddingVertical: 13,
              }}>
                <IconLock size={14} color={theme.subtle} />
                <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.subtle }}>
                  {msLeft > 0 ? `ترجع بعد ${longCountdownAr(msLeft)}` : 'غير متاح الآن'}
                </Text>
              </View>
            )}

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => navigation.navigate('NotificationSettings')}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
                borderWidth: 1, borderColor: theme.line, borderRadius: radius.pill, paddingVertical: 12,
              }}
            >
              <IconBell size={14} color={theme.ink} />
              <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink }}>إعدادات التنبيهات</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
