// "A free QR sticker for your window" — in the feed, where shops are.
//
// Same argument as ShopUpgradeCard: the offer is worthless if it only lives
// on a screen shops never open. Unlike that card, this one needs no
// eligibility signals — every shop has a window — so the only question it
// answers is which of three moments the shop is in:
//
//   1. nothing asked yet     → the offer, and the free week attached to it
//   2. a sticker on its way  → a receipt, and the claim once it has landed
//   3. a photo under review  → "we have it"
//
// When there is nothing left to say (the week has been granted) it renders
// nothing, which is what lets the upgrade card have the slot back.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { ShopStickerStatus } from '../api/endpoints';
import { theme, fonts, radius, FONT_SCALE_TIGHT, shadowSoft } from '../theme';

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

/**
 * Does this shop still have something to do here? Exported so the feed can
 * decide which of the two offer cards to spend its one slot on without
 * rendering this one first to find out.
 */
export function stickerCardHasSomethingToSay(s: ShopStickerStatus | null | undefined): boolean {
  if (!s) return false;
  if (s.open) return true;                       // a sticker is on its way
  if (s.reward?.status === 'pending') return true; // a photo is with us
  // Granted and nothing outstanding: the offer is spent, give the slot back.
  return s.reward?.status !== 'granted';
}

export function StickerOfferCard({ status, onPress }: { status: ShopStickerStatus; onPress: () => void }) {
  const open = status.open;
  const reward = status.reward;
  const proofPending = reward?.status === 'pending';
  // Shipped, in their hands, and the device half already satisfied: the one
  // moment where the free week is a single photo away. Worth saying loudly.
  const canClaim = !!open?.shipped_at && !!reward?.can_submit && !!reward?.listings_ok;

  const chip = proofPending ? 'صورتك قيد المراجعة'
    : open?.shipped_at ? 'بالطريق إلك'
      : open?.printing_at ? 'قيد الطباعة'
        : open ? 'طلبك وصلنا'
          : 'مجاناً';

  const title = proofPending ? 'وصلتنا صورة الملصق'
    : canClaim ? `الصق الملصق وخذ ${arNum(reward!.days)} أيام ترويج`
      : open ? 'ملصق متجرك بالطريق'
        : 'ملصق QR مجاني لواجهة محلك';

  const body = proofPending
    ? 'نراجعها ونخبرك — إذا كل شي تمام يصير متجرك مميّز بالمقدمة.'
    : canClaim
      ? `ابعثلنا صورة الملصق مثبّت بمحلك ويصير متجرك مميّز ${arNum(reward!.days)} أيام مجاناً.`
      : open
        ? 'نخبرك بكل خطوة. أول ما يوصلك، الصقه وابعثلنا صورة وخذ ترويج مجاني.'
        : reward
          ? `الزبون يمسحه ويفتح متجرك بالتطبيق. والصقه بمحلك مع ${arNum(reward.min_listings)} أجهزة معروضة وخذ ${arNum(reward.days)} أيام ترويج مجاني.`
          : 'الزبون يمسحه ويفتح متجرك بالتطبيق بكل أجهزتك وأسعارك.';

  // A receipt is not a button. The only states that lead somewhere useful
  // are the offer itself and the claim.
  const actionable = !proofPending;
  const cta = canClaim ? 'ابعث الصورة ←' : open ? 'شوف حالة الطلب ←' : 'اطلبه مجاناً ←';

  return (
    <TouchableOpacity
      onPress={actionable ? onPress : undefined}
      activeOpacity={actionable ? 0.9 : 1}
      accessibilityRole={actionable ? 'button' : undefined}
      style={{
        marginHorizontal: 16, marginBottom: 12, padding: 14,
        backgroundColor: theme.surface, borderRadius: radius.xxl,
        borderWidth: 1.5, borderColor: proofPending ? theme.line : theme.accent,
        ...shadowSoft,
      }}
    >
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
          backgroundColor: proofPending || open ? theme.chipBg : theme.successSoft,
        }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
            fontFamily: fonts.arBold, fontSize: 10.5,
            color: proofPending || open ? theme.chipInk : theme.success,
          }}>{chip}</Text>
        </View>
        {!open && !proofPending ? (
          <View style={{
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
            backgroundColor: theme.accentSoft,
          }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
              fontFamily: fonts.arBold, fontSize: 10.5, color: theme.accentDeep,
            }}>جديد</Text>
          </View>
        ) : null}
      </View>

      <Text style={{ fontFamily: fonts.arBold, fontSize: 15.5, color: theme.ink, textAlign: 'right' }}>
        {title}
      </Text>

      <Text style={{
        fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
        textAlign: 'right', lineHeight: 20, marginTop: 4,
      }}>
        {body}
      </Text>

      {/* The device half, only while it is the thing standing in the way —
          a shop that already has enough does not need to be told a rule. */}
      {!open && reward && !reward.listings_ok ? (
        <Text style={{
          fontFamily: fonts.ar, fontSize: 11.5, color: theme.accentDeep,
          textAlign: 'right', marginTop: 6,
        }}>
          عندك {arNum(reward.listings)} من {arNum(reward.min_listings)} أجهزة للترويج المجاني — الملصق نفسه مجاني على كل حال.
        </Text>
      ) : null}

      {actionable ? (
        <View style={{
          marginTop: 12, paddingVertical: 11, borderRadius: radius.lg,
          backgroundColor: theme.ink, alignItems: 'center',
        }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
            fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk,
          }}>{cta}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}
