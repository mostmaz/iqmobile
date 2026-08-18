import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, Linking, FlatList, Animated } from 'react-native';
import { Img } from './Img';
import { theme, radius, shadowSoft } from '../theme';
import { fullImageUrl } from '../api/upload';
import { Banners, type BannerRow } from '../api/endpoints';

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
// width : height. Was 5/2 (height = 0.400 × width); trimmed 20% off the
// height to 0.320 × width so the banner takes less of the first screen now
// that the storefront card sits above it. Existing banner art still fits —
// it's cropped by the Img's cover fit, not letterboxed.
const RATIO = 5 / 1.6;

function openBanner(
  banner: BannerRow,
  onOpenListing: (id: number) => void,
  onOpenShop?: (id: number) => void,
) {
  // Every tap is a click, wherever it leads — logged before navigation so
  // an external link that kills the app state can't lose the beacon.
  Banners.track(banner.id, 'click');
  if (banner.link_type === 'listing') {
    const id = Number(banner.link_value);
    if (Number.isFinite(id) && id > 0) onOpenListing(id);
  } else {
    // An external link can be a shop deep-link (…/shop/:id) we open in-app;
    // anything else is handed to the browser.
    const m = /\/shop\/(\d+)(?:[/?#]|$)/i.exec(banner.link_value);
    if (m && onOpenShop) { onOpenShop(Number(m[1])); return; }
    Linking.openURL(banner.link_value).catch(() => { /* dead link — ignore */ });
  }
}

function BannerImage({ banner, width, height, onPress, onError }: {
  banner: BannerRow; width?: number; height?: number; onPress: () => void;
  onError?: () => void;
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
        onError={onError}
        style={height ? { width: '100%', height: '100%' } : { width: '100%', aspectRatio: RATIO }}
      />
    </TouchableOpacity>
  );
}

// A single banner card for the in-feed slots (one after every 5 listings).
// Same art, same tap handling and click beacon as the carousel; its own
// impression fires once per mount — which, inside a FlatList, is once per
// time the slot actually scrolls into the render window.
export function FeedBanner({
  banner, onOpenListing, onOpenShop,
}: {
  banner: BannerRow;
  onOpenListing: (id: number) => void;
  onOpenShop?: (id: number) => void;
}) {
  // A banner whose art fails to load must vanish, not sit in the feed as a
  // full-width empty box.
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!broken) Banners.track(banner.id, 'impression');
  }, [banner.id, broken]);
  if (broken) return null;
  return (
    <View style={{ marginBottom: 8 }}>
      <BannerImage
        banner={banner}
        onError={() => setBroken(true)}
        onPress={() => openBanner(banner, onOpenListing, onOpenShop)}
      />
    </View>
  );
}

export function BannerCarousel({
  banners: bannersProp, onOpenListing, onOpenShop,
}: {
  banners: BannerRow[];
  onOpenListing: (id: number) => void;
  onOpenShop?: (id: number) => void;
}) {
  // Banners whose image failed to load are dropped from the rotation — a
  // broken URL used to render as a full-width empty card (and, with one
  // banner, a big dead block at the top of the feed).
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const banners = bannersProp.filter((b) => !failedIds.has(b.id));
  const markFailed = (id: number) =>
    setFailedIds((s) => { const n = new Set(s); n.add(id); return n; });
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const listRef = useRef<FlatList<BannerRow>>(null);

  const height = width > 0 ? width / RATIO : undefined;

  // One impression per banner per carousel mount, fired when its slide is
  // actually the visible one (auto-advance, swipe, or being the lead). NOT
  // reset when the banner array refreshes — the person is still on the same
  // screen, and re-counting the lead on every pull-to-refresh would inflate
  // exactly the number the dashboard uses to judge a banner.
  const seen = useRef<Set<number>>(new Set());
  useEffect(() => {
    const b = banners[index];
    if (b && !seen.current.has(b.id)) {
      seen.current.add(b.id);
      Banners.track(b.id, 'impression');
    }
  }, [index, banners]);

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

  // Every banner failed → nothing to show, take no space at all.
  if (banners.length === 0) return null;

  // Single banner — no carousel, no dots.
  if (banners.length === 1) {
    return (
      <View style={{ marginBottom: 8 }}>
        <BannerImage banner={banners[0]} onError={() => markFailed(banners[0].id)} onPress={() => openBanner(banners[0], onOpenListing, onOpenShop)} />
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 8 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
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
              onError={() => markFailed(item.id)}
              onPress={() => openBanner(item, onOpenListing, onOpenShop)}
            />
          )}
        />
      ) : (
        // First render (width not yet measured) — show the lead banner so
        // there's no empty gap; the carousel takes over once measured.
        <BannerImage banner={banners[0]} onError={() => markFailed(banners[0].id)} onPress={() => openBanner(banners[0], onOpenListing, onOpenShop)} />
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
