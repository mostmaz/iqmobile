// "Continue where you left off" — the devices this person just opened.
//
// A horizontal rail of 52pt tiles, reusing HomeHubCard's proportions rather
// than ListingCard: `compact` mode is a full-width horizontal row card and
// would render four enormous stacked blocks in a rail.
//
// Everything it shows is cached locally at view time (brand, model, image
// path), so it draws on a cold start with no request. That is the point —
// a rail that needs a fetch is a spinner in the middle of the feed.

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Img } from './Img';
import { fullImageUrl } from '../api/upload';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { useRecentlyViewed } from '../lib/recentlyViewed';
import { deviceTitle } from '../lib/format';

export function RecentlyViewedRail({
  excludeId,
  onOpen,
}: { excludeId?: number | null; onOpen: (id: number) => void }) {
  const items = useRecentlyViewed(excludeId);
  if (!items.length) return null;

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 13, color: theme.ink,
        textAlign: 'right', marginBottom: 8,
      }}>
        شفتها مؤخراً
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // The feed is RTL, so the rail must start at the right edge or the
        // most recent device lands off-screen.
        contentContainerStyle={{ flexDirection: 'row-reverse', gap: 8 }}
      >
        {items.map((it) => (
          <TouchableOpacity
            key={it.id}
            activeOpacity={0.85}
            onPress={() => onOpen(it.id)}
            accessibilityRole="button"
            style={{
              width: 76, backgroundColor: theme.surface, borderRadius: radius.lg,
              borderWidth: 1, borderColor: theme.line, padding: 6, alignItems: 'center',
            }}
          >
            <View style={{ width: 52, height: 52, borderRadius: 8, backgroundColor: theme.chipBg, overflow: 'hidden' }}>
              {it.image_path ? (
                <Img source={{ uri: fullImageUrl(it.image_path) }} contentFit="cover" style={{ width: 52, height: 52 }} />
              ) : null}
            </View>
            <Text
              numberOfLines={2}
              maxFontSizeMultiplier={FONT_SCALE_TIGHT}
              style={{
                alignSelf: 'stretch', marginTop: 5, fontFamily: fonts.arBold,
                fontSize: 10, color: theme.ink, textAlign: 'center',
              }}
            >
              {deviceTitle(it.brand, it.model)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}
