// The «ارفع إعلانك مجاناً» entry point, in one place.
//
// It appears on the listing page and again on the paid-promotion screen, and
// those two copies drifting apart is exactly how a seller ends up being told
// they have two boosts left on one screen and none on the other.
//
// Renders NOTHING when the operator has the feature off, or when the server
// is old enough not to know about it. Deliberately not a disabled card: a
// control for something that does not exist is worse than no control.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { IconBolt, IconChevronLeft, IconLock } from './icons';
import { Boosts } from '../api/endpoints';
import { boostUiState, boostPillLabel } from '../lib/boostState';

export function FreeBoostCard({ listingId, onPress }: { listingId: number; onPress: () => void }) {
  const [now, setNow] = React.useState(Date.now());
  const { data } = useQuery({
    queryKey: ['boost', listingId],
    queryFn: () => Boosts.state(listingId),
    staleTime: 30_000,
    // A seller who cannot boost is not an error worth a red banner.
    retry: false,
  });

  // A minute is enough for a card that only shows hours and minutes; a
  // per-second tick here would re-render the whole listing page.
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const ui = boostUiState(data, now);
  if (ui.kind === 'hidden' || ui.kind === 'ineligible') return null;

  const spent = ui.kind !== 'available';
  const pill = boostPillLabel(ui);

  const body = (
    <View style={{
      marginHorizontal: 16, marginTop: 14, padding: 14,
      backgroundColor: spent ? theme.surface : theme.accentSoft,
      borderWidth: 1.5, borderColor: spent ? theme.line : theme.accent,
      borderRadius: radius.xxl,
      flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    }}>
      <View style={{
        width: 40, height: 40, borderRadius: radius.lg,
        backgroundColor: spent ? theme.chipBg : theme.accent,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {spent ? <IconLock size={18} color={theme.subtle} /> : <IconBolt size={20} color="#fff" />}
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>
            ارفع إعلانك مجاناً
          </Text>
          {pill ? (
            <View style={{
              paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill,
              backgroundColor: spent ? theme.chipBg : theme.accent,
            }}>
              <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
                fontFamily: fonts.arBold, fontSize: 10, color: spent ? theme.subtle : '#fff',
              }}>
                {pill}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', lineHeight: 19 }}>
          شاهد فيديو قصير ويرجع إعلانك لأعلى «الأحدث».
        </Text>
      </View>

      {spent ? null : <IconChevronLeft size={14} color={theme.accentDeep} />}
    </View>
  );

  // Not tappable while there is nothing to claim — a button that only ever
  // says "not yet" trains people to stop pressing it.
  if (spent) return body;
  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress} accessibilityRole="button">
      {body}
    </TouchableOpacity>
  );
}
