// «ما لقيت جهازك؟» — the request feature's one piece of advertising, placed
// where the disappointment is.
//
// The feature's problem was never that buyers dislike it; it is that they
// never meet it. A tab labelled «اطلب جهاز» is a thing you notice when you
// are already happy. This card appears at the two moments a buyer has just
// failed to find a phone — four cards into a feed that isn't it, and above a
// thin set of search results — and offers the thing that would help.
//
// Deliberately NOT a full-bleed banner and NOT dismissible. It is the width
// of a listing card with a dashed accent outline, so it reads as an offer
// inside the list rather than as an ad on top of it; and it is cheap enough
// (one row, one line of copy) that a dismiss control would cost more
// attention than the card does.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { IconRequest } from './icons';

export function RequestInviteCard({
  onPress, style, title = 'ما لقيت جهازك؟', subtitle = 'اطلبه وخل التجار يجاوبونك',
}: {
  onPress: () => void;
  style?: any;
  /** Overridable so the search screen can name the thing that was missing. */
  title?: string;
  subtitle?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${title} ${subtitle}`}
      style={[{
        // The page's own background, not white: a white card here would be a
        // sixth listing in a column of five, and the eye would skip it.
        backgroundColor: theme.bg,
        borderWidth: 1, borderStyle: 'dashed', borderColor: theme.accentBorder,
        borderRadius: radius.xxl, padding: 12,
        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
      }, style]}
    >
      <View style={{
        width: 36, height: 36, borderRadius: radius.md, backgroundColor: theme.accentSoft,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <IconRequest size={18} color={theme.accentDeep} sw={1.8} />
      </View>
      {/* flex: 1, never flexShrink. Under shrink pressure Android measures an
          Arabic string short and drops its last token outright — «ما لقيت
          جهازك؟» became «ما لقيت» on a real device. Owning the free space is
          the fix; see the same comment on Header and DescriptionField. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
          {title}
        </Text>
        <Text numberOfLines={2} style={{ fontFamily: fonts.ar, fontSize: 11, lineHeight: 17, color: theme.subtle, textAlign: 'right', marginTop: 1 }}>
          {subtitle}
        </Text>
      </View>
      <View style={{
        flexShrink: 0, backgroundColor: theme.accent, borderRadius: radius.lg,
        paddingHorizontal: 14, paddingVertical: 9,
      }}>
        <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 12, color: '#fff' }}>
          اطلب
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * The quieter half of the same offer, for the END of a short result list.
 *
 * A buyer who scrolled past three results and found nothing has a different
 * state of mind from one who just arrived, so this states the reach as a
 * number rather than repeating the pitch — see invitePitch() for why that
 * number is a floor and never an estimate.
 */
export function RequestInviteFooter({ pitch, onPress }: { pitch: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button"
      style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 11, lineHeight: 17, color: theme.subtle, textAlign: 'center' }}>
        النتائج قليلة؟ <Text style={{ fontFamily: fonts.arBold, color: theme.accentDeep }}>{pitch}</Text>
      </Text>
    </TouchableOpacity>
  );
}
