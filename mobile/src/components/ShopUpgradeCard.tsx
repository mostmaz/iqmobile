// "Your shop qualifies" — in the feed, where shops actually are.
//
// The same offer lives in the merchant dashboard, but most shops never open
// it, so the offer only ever reached the half that did. This puts it in the
// home feed above the first listing, for shops the daily signals job has
// marked eligible. Once a request is in, the card stays as its receipt so
// the shop isn't left wondering whether the tap registered.
//
// It occupies a listing's slot, so it must earn it: it renders only for a
// signed-in shop that qualifies and has not been upgraded already, and it
// says what the shop gets rather than what it is.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius, FONT_SCALE_TIGHT, shadowSoft } from '../theme';

export type TierStatus = {
  tier: 'simple' | 'advanced' | string;
  state: string | null;
  eligible: boolean;
  can_request: boolean;
  retry_at: number | null;
  requested_at: number | null;
  signals: { active_listings: number; listings_30d: number; contacts_30d: number };
};

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

export function ShopUpgradeCard({ status, onPress }: { status: TierStatus; onPress: () => void }) {
  const pending = status.state === 'pending_review' || !!status.requested_at;

  return (
    <TouchableOpacity
      onPress={pending ? undefined : onPress}
      activeOpacity={pending ? 1 : 0.9}
      style={{
        marginHorizontal: 16, marginBottom: 12, padding: 14,
        backgroundColor: theme.surface, borderRadius: radius.xxl,
        borderWidth: 1.5, borderColor: pending ? theme.line : theme.accent,
        ...shadowSoft,
      }}
    >
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
          backgroundColor: pending ? theme.chipBg : theme.accentSoft,
        }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
            fontFamily: fonts.arBold, fontSize: 10.5,
            color: pending ? theme.chipInk : theme.accentDeep,
          }}>
            {pending ? 'قيد المراجعة' : 'متجرك مؤهل'}
          </Text>
        </View>
      </View>

      <Text style={{ fontFamily: fonts.arBold, fontSize: 15.5, color: theme.ink, textAlign: 'right' }}>
        {pending ? 'طلبك وصلنا' : 'خلي اللوحة تدير متجرك'}
      </Text>

      <Text style={{
        fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
        textAlign: 'right', lineHeight: 20, marginTop: 4,
      }}>
        {pending
          ? 'نراجع طلبك خلال ٢٤ ساعة ونخبرك هنا.'
          // The numbers are the shop's own, which is the whole argument: it
          // already does the work the tools are for.
          : `عندك ${arNum(status.signals.active_listings)} جهاز معروض و${arNum(status.signals.contacts_30d)} تواصل هذا الشهر — تكدر تدير هذا كله من لوحة وحدة.`}
      </Text>

      {!pending ? (
        <View style={{
          marginTop: 12, paddingVertical: 11, borderRadius: radius.lg,
          backgroundColor: theme.ink, alignItems: 'center',
        }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
            fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk,
          }}>
            شوف شنو تحصل ←
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}
