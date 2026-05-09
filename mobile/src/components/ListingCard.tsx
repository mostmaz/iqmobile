import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { theme, fonts, radius, shadowSoft } from '../theme';
import { fmtIQD } from './ui';
import { IconStar, IconPin } from './icons';
import { ChipTag } from './marketplace';
import { fullImageUrl } from '../api/upload';
import { arOf } from '../lib/governorates';
import { ar } from '../i18n/ar';
import type { Listing } from '../api/endpoints';

export function ListingCard({
  listing, onPress, onToggleSave, saved, compact,
}: { listing: Listing; onPress: () => void; onToggleSave?: () => void; saved?: boolean; compact?: boolean }) {
  const cover = listing.images?.[0]?.image_path;
  // Status badge: ink for "reserved" (neutral), accent for "sold" (final).
  const statusBg = listing.status === 'sold' ? theme.accent : theme.ink;
  const showStatus = listing.status !== 'active';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
      ...shadowSoft, overflow: 'hidden', marginBottom: 12,
    }}>
      <View style={{ height: compact ? 132 : 180, backgroundColor: theme.chipBg }}>
        {cover ? (
          <Image source={{ uri: fullImageUrl(cover) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.subtle, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4 }}>
              {listing.brand?.toUpperCase()}
            </Text>
          </View>
        )}
        {/* Save heart — top-start. The unified-account redesign retired the
            seller-type pill that used to occupy this corner. */}
        {onToggleSave ? (
          <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); onToggleSave(); }} style={{
            position: 'absolute', top: 10, left: 10,
            width: 36, height: 36, borderRadius: 999,
            backgroundColor: saved ? 'rgba(255,255,255,0.92)' : 'rgba(20,16,12,0.55)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: saved ? theme.accent : '#fff', fontSize: 18 }}>{saved ? '♥' : '♡'}</Text>
          </TouchableOpacity>
        ) : null}
        {showStatus ? (
          <View style={{
            position: 'absolute', top: 10, right: 10,
            backgroundColor: statusBg,
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
          }}>
            <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4 }}>
              {(ar.listing as any)[listing.status]}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: compact ? 12 : 14 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: compact ? 14 : 15, color: theme.ink, textAlign: 'right' }} numberOfLines={1}>
              {listing.brand} {listing.model}
            </Text>
          </View>
          <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: theme.subtle, letterSpacing: 0.6 }}>
            {fmtRelativeTime(listing.created_at)}
          </Text>
        </View>

        {!compact ? (
          <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <ChipTag>{(ar.listing as any)[listing.condition]}</ChipTag>
            {listing.storage ? <ChipTag>{listing.storage}</ChipTag> : null}
            {listing.color ? <ChipTag>{listing.color}</ChipTag> : null}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginTop: compact ? 6 : 10 }}>
          <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: compact ? 17 : 20, color: theme.accentDeep, letterSpacing: -0.3 }}>
            {fmtIQD(listing.asking_price)}
            <Text style={{ fontSize: 11, color: theme.subtle, fontFamily: fonts.ar, fontWeight: '500' }}>  د.ع</Text>
          </Text>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
            <IconPin size={12} color={theme.subtle} />
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>
              {arOf(listing.governorate)}{!compact && listing.city ? ` · ${listing.city}` : ''}
            </Text>
          </View>
        </View>

        {!compact && listing.seller && listing.seller.rating_count > 0 ? (
          <View style={{ marginTop: 8, flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <IconStar size={12} filled color={theme.accent} />
            <Text style={{ fontFamily: fonts.ltr, fontSize: 11.5, color: theme.subtle }}>
              {listing.seller.rating_avg.toFixed(1)} · {listing.seller.rating_count}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>· {listing.seller.display_name}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function fmtRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return mins <= 1 ? 'الآن' : `قبل ${mins}د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? 'قبل ساعة' : `قبل ${hrs}س`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'قبل يوم' : `قبل ${days}ي`;
}
