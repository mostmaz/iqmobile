// Shimmer / skeleton placeholders shown while a list or detail page is
// doing its FIRST fetch (react-query `isLoading`, i.e. no cached data yet).
//
// Why skeletons instead of the ActivityIndicator we had:
//   - A spinner says "something is happening"; a skeleton says "a list of
//     cards is coming, and here is its shape". On a slow Iraqi mobile
//     connection that difference is most of the perceived speed.
//   - Every skeleton below mirrors the real component's geometry (same
//     widths, paddings, radii, minHeight), so when data lands the rows
//     swap in place with no layout jump.
//
// Why hand-rolled:
//   - No reanimated / expo-linear-gradient in this project, and both are
//     native deps (= a full rebuild). react-native-svg IS already linked
//     (see icons.tsx) and ships LinearGradient, so the sweep is a plain
//     <Svg> translated by RN's built-in Animated on the native driver.
//     Zero new dependencies, no rebuild.
//
// Cost: ONE Animated.Value for the whole app (module-level, ref-counted —
// see useShimmer), so 8 skeleton cards on screen = 1 native animation
// driver and 8 static SVGs, not 8 timers. The loop stops the moment the
// last skeleton unmounts.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, StyleSheet, AccessibilityInfo, StyleProp, ViewStyle, Dimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { theme, radius, shadowSoft } from '../theme';

// Placeholder fill. Deliberately an alpha of the ink colour rather than
// theme.chipBg so it reads correctly on BOTH theme.surface (cards) and
// theme.bg (bare screens) without a per-site variant.
const BLOCK = 'rgba(27,26,24,0.085)';
const SWEEP_MS = 1250;

// ─── Shared driver ───────────────────────────────────────────────
const progress = new Animated.Value(0);
let subscribers = 0;
let loop: Animated.CompositeAnimation | null = null;

function acquire() {
  subscribers += 1;
  if (subscribers > 1) return;
  progress.setValue(0);
  loop = Animated.loop(
    Animated.timing(progress, {
      toValue: 1,
      duration: SWEEP_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }),
  );
  loop.start();
}

function release() {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers === 0) {
    loop?.stop();
    loop = null;
  }
}

function useShimmer() {
  // Respect the OS "reduce motion" switch — a sweeping highlight is
  // exactly the kind of repeating motion that setting exists to kill.
  // Skeletons then render as static blocks, which still communicate the
  // incoming shape.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (alive) setReduceMotion(on); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    acquire();
    return release;
  }, [reduceMotion]);

  return reduceMotion ? null : progress;
}

// Gradient ids must be unique per mounted <Svg>: react-native-svg resolves
// `url(#id)` against a process-wide registry on Android, so two skeletons
// sharing an id makes the second one paint with the first one's (possibly
// unmounted) gradient.
let gradSeq = 0;

const SCREEN_W = Dimensions.get('window').width;

/**
 * Absolutely-positioned shimmer sweep. Drop inside any container that has
 * `overflow: 'hidden'` — it fills the parent and sweeps right→left (Arabic
 * reading direction).
 */
export function Shimmer() {
  const p = useShimmer();
  const id = useRef(`sk${gradSeq++}`).current;
  const [w, setW] = useState(0);

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={StyleSheet.absoluteFill}
    >
      {p && w > 0 ? (
        <Animated.View
          style={{
            ...StyleSheet.absoluteFillObject,
            transform: [{
              // Start fully off the trailing edge, end fully off the
              // leading edge, so there's a beat of stillness between
              // sweeps instead of a hard wrap.
              translateX: p.interpolate({ inputRange: [0, 1], outputRange: [w, -w] }),
            }],
          }}
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.7" />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ─── Primitives ──────────────────────────────────────────────────
export function SkBlock({ w, h, r = 6, style }: {
  w?: number | `${number}%`;
  h: number;
  r?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: BLOCK }, style]} />;
}

/** Card-shaped skeleton surface: real card chrome + one shimmer sweep. */
function SkCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{
      backgroundColor: theme.surface,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: theme.line,
      ...shadowSoft,
      overflow: 'hidden',
      marginBottom: 12,
    }, style]}>
      {children}
      <Shimmer />
    </View>
  );
}

// ─── ListingCard skeleton ────────────────────────────────────────
// Mirrors components/ListingCard.tsx: 128/104 image column, 137/104
// minHeight, 12/10 detail padding, same row rhythm.
export function ListingCardSkeleton({ compact }: { compact?: boolean }) {
  const imgW = compact ? 104 : 128;
  return (
    <SkCard style={{ flexDirection: 'row', minHeight: compact ? 104 : 137 }}>
      {/* image column */}
      <View style={{ width: imgW, backgroundColor: BLOCK }} />

      {/* details column */}
      <View style={{ flex: 1, padding: compact ? 10 : 12, justifyContent: 'center' }}>
        {/* title + relative time */}
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <SkBlock h={compact ? 12 : 13} style={{ flex: 1, maxWidth: 130 }} />
          <SkBlock w={30} h={8} r={4} />
        </View>

        {/* spec chips */}
        {!compact ? (
          <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 7 }}>
            <SkBlock w={44} h={19} r={999} />
            <SkBlock w={36} h={19} r={999} />
            <SkBlock w={40} h={19} r={999} />
          </View>
        ) : null}

        {/* price + governorate */}
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
          marginTop: compact ? 5 : 9, gap: 8,
        }}>
          <SkBlock w={compact ? 78 : 92} h={compact ? 15 : 17} />
          <SkBlock w={62} h={11} r={5} />
        </View>

        {/* seller rating line */}
        {!compact ? <SkBlock w={112} h={10} r={5} style={{ marginTop: 7 }} /> : null}
      </View>
    </SkCard>
  );
}

/**
 * N listing skeletons. Drop straight into a FlatList's
 * `ListEmptyComponent` — the list's own contentContainerStyle supplies
 * the horizontal padding, same as the real cards.
 */
export function ListingListSkeleton({ count = 6, compact }: { count?: number; compact?: boolean }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => <ListingCardSkeleton key={i} compact={compact} />)}
    </View>
  );
}

// ─── ShopRow skeleton ────────────────────────────────────────────
// Mirrors ShopRow in screens/shops/ShopsScreen.tsx.
export function ShopRowSkeleton() {
  return (
    <SkCard style={{ padding: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 12 }}>
      <SkBlock w={56} h={56} r={14} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <SkBlock w={128} h={13} />
        <SkBlock w={92} h={10} r={5} style={{ marginTop: 6 }} />
        <SkBlock w={68} h={10} r={5} style={{ marginTop: 6 }} />
      </View>
      <SkBlock w={10} h={16} r={4} />
    </SkCard>
  );
}

export function ShopListSkeleton({ count = 5 }: { count?: number }) {
  return <View>{Array.from({ length: count }, (_, i) => <ShopRowSkeleton key={i} />)}</View>;
}

/** Shop page header (logo + name + meta + contact buttons) + its listings. */
export function ShopScreenSkeleton() {
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <SkCard style={{ padding: 16, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 14 }}>
          <SkBlock w={68} h={68} r={18} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <SkBlock w={150} h={16} />
            <SkBlock w={104} h={11} r={5} style={{ marginTop: 8 }} />
            <SkBlock w={80} h={11} r={5} style={{ marginTop: 7 }} />
          </View>
        </View>
        <SkBlock w="100%" h={12} r={5} style={{ marginTop: 14 }} />
        <SkBlock w="70%" h={12} r={5} style={{ marginTop: 7 }} />
        <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 14 }}>
          <SkBlock h={48} r={radius.lg} style={{ flex: 1 }} />
          <SkBlock h={48} r={radius.lg} style={{ flex: 1 }} />
        </View>
      </SkCard>
      <ListingListSkeleton count={4} />
    </View>
  );
}

// ─── Listing detail skeleton ─────────────────────────────────────
// Mirrors screens/listing/ListingDetailScreen.tsx: 320pt gallery, then
// the title / price / chips / spec block stack.
export function ListingDetailSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* gallery — full-bleed, gets its own sweep */}
      <View style={{ height: 320, backgroundColor: BLOCK, overflow: 'hidden' }}>
        <Shimmer />
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
        <SkCard style={{ padding: 14 }}>
          <SkBlock w={SCREEN_W * 0.5} h={20} style={{ alignSelf: 'flex-end' }} />
          <SkBlock w={130} h={24} style={{ alignSelf: 'flex-end', marginTop: 12 }} />
          <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 14 }}>
            <SkBlock w={54} h={22} r={999} />
            <SkBlock w={44} h={22} r={999} />
            <SkBlock w={48} h={22} r={999} />
          </View>
        </SkCard>

        <SkCard style={{ padding: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{
              flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
              paddingVertical: 10,
              borderBottomWidth: i === 3 ? 0 : 1,
              borderBottomColor: theme.line,
            }}>
              <SkBlock w={70} h={11} r={5} />
              <SkBlock w={100} h={11} r={5} />
            </View>
          ))}
        </SkCard>

        <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
          <SkBlock h={48} r={radius.lg} style={{ flex: 1 }} />
          <SkBlock h={48} r={radius.lg} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}

// ─── Generic avatar + two-line row ───────────────────────────────
// Used by the chats / deals / notifications / saved-searches lists,
// which share the same avatar-plus-two-lines row shape.
export function RowSkeleton({ avatar = 44 }: { avatar?: number }) {
  return (
    <SkCard style={{
      padding: 12, marginBottom: 8, borderRadius: radius.lg,
      flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    }}>
      <SkBlock w={avatar} h={avatar} r={999} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <SkBlock w={104} h={12} />
        <SkBlock w={168} h={10} r={5} style={{ marginTop: 7 }} />
      </View>
    </SkCard>
  );
}

export function RowListSkeleton({ count = 6, avatar }: { count?: number; avatar?: number }) {
  return <View>{Array.from({ length: count }, (_, i) => <RowSkeleton key={i} avatar={avatar} />)}</View>;
}

// ─── Text row + trailing action ──────────────────────────────────
// Wishlist / saved-searches rows: no avatar, two text lines, and a small
// trailing close button. `pad` supplies the horizontal padding these two
// screens normally get from the FlatList contentContainerStyle — the
// skeleton replaces the whole list, not just its empty slot.
export function TextRowListSkeleton({ count = 4, pad = 16 }: { count?: number; pad?: number }) {
  return (
    <View style={{ paddingHorizontal: pad }}>
      {Array.from({ length: count }, (_, i) => (
        <SkCard key={i} style={{
          padding: 14, marginBottom: 10, borderRadius: radius.lg,
          flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
        }}>
          <View style={{ flex: 1 }}>
            <SkBlock w={140} h={12} />
            <SkBlock w={190} h={10} r={5} style={{ marginTop: 8 }} />
          </View>
          <SkBlock w={16} h={16} r={4} />
        </SkCard>
      ))}
    </View>
  );
}
