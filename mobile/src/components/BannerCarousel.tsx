import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, Linking, FlatList, Animated } from 'react-native';
import { Img } from './Img';
import { theme, radius, shadowSoft } from '../theme';
import { fullImageUrl } from '../api/upload';
import type { BannerRow } from '../api/endpoints';

// Auto-rotating promo banner strip pinned to the top of the feed. Flips
// through every eligible banner every ROTATE_MS with no page refresh needed;
// the user can also swipe manually. The banners array arrives pre-ordered by
// BrowseScreen, so index 0 is the "lead" slide chosen per the governorate /
// brand priority rules — and it re-leads whenever that array changes (i.e.
// on pull-to-refresh, filter change, or tab re-open).
//
// Tapping a banner opens the linked listing in-app (link_type='listing') or
// an external URL in the browser (link_type='external').

const ROTATE_MS = 4000;
const RATIO = 5 / 2; // width : height — matches the single-banner layout.

function openBanner(banner: BannerRow, onOpenListing: (id: number) => void) {
  if (banner.link_type === 'listing') {
    const id = Number(banner.link_value);
    if (Number.isFinite(id) && id > 0) onOpenListing(id);
  } else {
    Linking.openURL(banner.link_value).catch(() => { /* dead link — ignore */ });
  }
}

function BannerImage({ banner, width, height, onPress }: {
  banner: BannerRow; width?: number; height?: number; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        width: width ?? '100%', height,
        borderRadius: radius.xxl, overflow: 'hidden',
        backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.line,
        ...shadowSoft,
      }}
    >
      <Img
        source={{ uri: fullImageUrl(banner.image_path) }}
        contentFit="cover"
        style={height ? { width: '100%', height: '100%' } : { width: '100%', aspectRatio: RATIO }}
      />
    </TouchableOpacity>
  );
}

export function BannerCarousel({
  banners, onOpenListing,
}: {
  banners: BannerRow[];
  onOpenListing: (id: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const listRef = useRef<FlatList<BannerRow>>(null);

  const height = width > 0 ? width / RATIO : undefined;

  // Drives the "time until flip" fill on the active dot: animates 0 → 1 over
  // one ROTATE_MS window, restarting whenever the shown slide changes (auto-
  // advance or manual swipe), so the fill always tracks the real countdown.
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (banners.length <= 1 || width <= 0) return;
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1, duration: ROTATE_MS, useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [index, banners, width, progress]);

  // Snap back to the lead slide whenever the banner set changes — a refresh
  // rotates which banner leads, and the first slide should reflect that.
  useEffect(() => {
    indexRef.current = 0;
    setIndex(0);
    if (width > 0) listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [banners, width]);

  // Auto-advance every ROTATE_MS, looping. Paused implicitly while there's a
  // single banner or before the width is measured.
  useEffect(() => {
    if (banners.length <= 1 || width <= 0) return;
    const t = setInterval(() => {
      const next = (indexRef.current + 1) % banners.length;
      indexRef.current = next;
      setIndex(next);
      listRef.current?.scrollToOffset({ offset: next * width, animated: true });
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [banners.length, width]);

  // Keep our index in sync with manual swipes so the next auto-advance
  // continues from wherever the user left off.
  function onMomentumScrollEnd(e: { nativeEvent: { contentOffset: { x: number } } }) {
    if (width <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    indexRef.current = i;
    setIndex(i);
  }

  // Single banner — no carousel, no dots.
  if (banners.length === 1) {
    return (
      <View style={{ marginBottom: 12 }}>
        <BannerImage banner={banners[0]} onPress={() => openBanner(banners[0], onOpenListing)} />
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 12 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <FlatList
          ref={listRef}
          data={banners}
          keyExtractor={(b) => String(b.id)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          style={{ height }}
          renderItem={({ item }) => (
            <BannerImage
              banner={item}
              width={width}
              height={height}
              onPress={() => openBanner(item, onOpenListing)}
            />
          )}
        />
      ) : (
        // First render (width not yet measured) — show the lead banner so
        // there's no empty gap; the carousel takes over once measured.
        <BannerImage banner={banners[0]} onPress={() => openBanner(banners[0], onOpenListing)} />
      )}

      {/* Pagination dots — the active one widens into a pill that fills up
          over the countdown, showing how long until the banner flips. */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 }}>
        {banners.map((b, i) => (
          i === index ? (
            <View
              key={b.id}
              style={{ width: 18, height: 6, borderRadius: 3, backgroundColor: theme.line, overflow: 'hidden' }}
            >
              <Animated.View
                style={{
                  height: '100%', borderRadius: 3, backgroundColor: theme.accent,
                  width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                }}
              />
            </View>
          ) : (
            <View
              key={b.id}
              style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.line }}
            />
          )
        ))}
      </View>
    </View>
  );
}
