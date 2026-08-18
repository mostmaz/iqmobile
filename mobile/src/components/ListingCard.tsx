import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Img } from './Img';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT, FONT_SCALE_RELAXED } from '../theme';
import { fmtIQD } from './ui';
import { IconStar, IconPin, IconSpark } from './icons';
import { ChipTag } from './marketplace';
import { fullImageUrl } from '../api/upload';
import { arOf } from '../lib/governorates';
import { timeAgoAr, deviceTitle } from '../lib/format';
import { ar } from '../i18n/ar';
import type { Listing } from '../api/endpoints';

export function ListingCard({
  listing, onPress, onToggleSave, saved, compact,
}: { listing: Listing; onPress: () => void; onToggleSave?: () => void; saved?: boolean; compact?: boolean }) {
  const cover = listing.images?.[0]?.image_path;
  // "Last known price": a price-aggregator device that dropped off every
  // source's list. Grey the whole card and badge it so buyers know it's the
  // last seen price and the phone is no longer being offered / in stock.
  const stale = !!(listing as any).stale_since;
  // Status badge: accent for "sold" (final), muted gray for "expired"
  // (dormant — the ad ran out, the phone may still exist), ink for
  // "reserved" (neutral).
  const statusBg = listing.status === 'sold' ? theme.accent
    : listing.status === 'expired' ? theme.subtle
      : theme.ink;
  const showStatus = listing.status !== 'active';
  // Horizontal card: image on the leading (physical-left) side, details on
  // the right. Yoga runs LTR app-wide (see App.tsx), so plain `row` puts the
  // first child on the left. Image fills the left column edge-to-edge
  // (contentFit="cover") for a tight thumbnail.
  const imgW = compact ? 104 : 128;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
      ...shadowSoft, overflow: 'hidden', marginBottom: 8, opacity: stale ? 0.62 : 1,
      // Heights trimmed 10% from the previous 152 / 116 baseline. Inner
      // padding + chip margins trimmed proportionally below so the
      // content density stays the same — the card is just shorter.
      flexDirection: 'row', minHeight: compact ? 104 : 137,
    }}>
      {/* Image — leading (left) column. The column stretches to the card
          height (row alignItems defaults to 'stretch'); the image is
          absolutely positioned so it fills that height instead of imposing
          its own intrinsic pixel size (which would blow the card up). */}
      <View style={{ width: imgW, backgroundColor: theme.chipBg }}>
        {cover ? (
          <Img source={{ uri: fullImageUrl(cover) }} contentFit="cover" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.subtle, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4 }}>
              {listing.brand?.toUpperCase()}
            </Text>
          </View>
        )}
        {/* Save heart — top-left over the image. */}
        {onToggleSave ? (
          <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); onToggleSave(); }} style={{
            position: 'absolute', top: 8, left: 8,
            width: 32, height: 32, borderRadius: 999,
            backgroundColor: saved ? 'rgba(255,255,255,0.92)' : 'rgba(20,16,12,0.55)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: saved ? theme.accent : '#fff', fontSize: 16 }}>{saved ? '♥' : '♡'}</Text>
          </TouchableOpacity>
        ) : null}
        {showStatus ? (
          <View style={{
            position: 'absolute', top: 8, right: 8,
            backgroundColor: statusBg,
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
          }}>
            <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 10 }}>
              {(ar.listing as any)[listing.status]}
            </Text>
          </View>
        ) : stale ? (
          <View style={{
            position: 'absolute', top: 8, right: 8,
            backgroundColor: theme.subtle,
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
          }}>
            <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 10 }}>
              آخر سعر معروف
            </Text>
          </View>
        ) : null}
        {/* Featured ribbon — bottom-left of the image so it never collides
            with the save heart (top-left) or status badge (top-right). */}
        {(listing as any).is_featured ? (
          <View style={{
            position: 'absolute', bottom: 8, left: 8,
            backgroundColor: theme.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
            flexDirection: 'row-reverse', alignItems: 'center', gap: 3,
          }}>
            <IconSpark size={11} color="#fff" />
            <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 10 }}>مميّز</Text>
          </View>
        ) : null}
      </View>

      {/* Details — trailing (right) column. Padding tightened with the
          10% height cut so the rows breathe at the new card height. */}
      <View style={{ flex: 1, padding: compact ? 10 : 12, justifyContent: 'center' }}>
        {/* The timestamp used to share this row, and since it is a fixed-width
            sibling against a flexible title, the TITLE is what gave way —
            "Apple iPhone 1…" cut off exactly at the model number, the single
            most important field on a phone marketplace. The title now owns the
            full width over two lines and the timestamp moved down beside the
            location, which has room to spare. */}
        <Text
          style={{ fontFamily: fonts.arBold, fontSize: compact ? 14 : 15, color: theme.ink, textAlign: 'right' }}
          maxFontSizeMultiplier={FONT_SCALE_RELAXED}
          numberOfLines={2}
        >
          {deviceTitle(listing.brand, listing.model)}
        </Text>

        {!compact ? (
          <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
            <ChipTag>{(ar.listing as any)[listing.condition]}</ChipTag>
            {listing.storage ? <ChipTag>{listing.storage}</ChipTag> : null}
            {listing.color ? <ChipTag>{listing.color}</ChipTag> : null}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginTop: compact ? 5 : 9, gap: 8 }}>
          {/* One card split "375,000" from "د.ع" across two lines while its
              neighbours kept them inline, because a longer location on the
              same row competed for the width. The price is the thing that
              must never wrap; the location shrinks instead. */}
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={FONT_SCALE_TIGHT}
            style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: compact ? 16 : 19, color: theme.accentDeep, letterSpacing: -0.3, flexShrink: 0 }}
          >
            {fmtIQD(listing.asking_price)}
            <Text style={{ fontSize: 11, color: theme.subtle, fontFamily: fonts.ar }}>  د.ع</Text>
          </Text>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 }}>
            <IconPin size={12} color={theme.subtle} />
            {/* The location wins the shrink contest and the timestamp keeps
                its intrinsic width — at a 1.3x font scale the reverse left
                the row reading "· … · قبل 6 دقائق", with the place name gone
                entirely. Both are clamped so neither can grow the row past
                what the card allows. */}
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={FONT_SCALE_TIGHT}
              style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle, flexShrink: 1, minWidth: 0 }}
            >
              {arOf(listing.governorate)}{!compact && listing.city ? ` · ${listing.city}` : ''}
            </Text>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={FONT_SCALE_TIGHT}
              style={{ fontFamily: stale ? fonts.arBold : fonts.ar, fontSize: 10.5, color: theme.subtle, flexShrink: 0 }}
            >
              · {stale ? 'غير متوفر حالياً' : fmtRelativeTime(listing.created_at)}
            </Text>
          </View>
        </View>

        {/* Show the star line only when we have both a count AND a finite
            rating value. A legacy/malformed seller row with rating_count>0
            but rating_avg=null would otherwise crash on .toFixed(). */}
        {!compact && listing.seller && listing.seller.rating_count > 0 && Number.isFinite(listing.seller.rating_avg as any) ? (
          <View style={{ marginTop: 7, flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <IconStar size={12} filled color={theme.accent} />
            <Text style={{ fontFamily: fonts.ltr, fontSize: 11.5, color: theme.subtle }}>
              {Number(listing.seller.rating_avg).toFixed(1)} · {listing.seller.rating_count}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, flexShrink: 1 }}>· {listing.seller.display_name}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// One shared formatter for the whole app — see timeAgoAr() in lib/format.ts
// for why the feed can't have its own.
const fmtRelativeTime = timeAgoAr;
