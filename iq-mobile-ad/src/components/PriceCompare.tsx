import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING, radius } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";
import { AD, formatPrice } from "../data";

// THE HERO COMPONENT. Two stacked rows — the new price struck through in
// subtle grey, the used price in accent at display size — then a green
// savings pill that stamps in with overshoot. Both figures COUNT UP rather
// than appearing, which is what makes the comparison land as a gap the
// viewer watches open rather than two static numbers.
export const PriceCompare: React.FC<{
  newPrice: number;
  usedPrice: number;
  /** Scene-relative frame the sequence starts on. */
  from?: number;
}> = ({ newPrice, usedPrice, from = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, font } = useLayout();
  const fontFamily = useCairo();
  const f = frame - from;

  // 1. New price arrives from the right (RTL motion), settling.
  const newIn = spring({ frame: f, fps, config: SPRING.settle, durationInFrames: 20 });
  const newCount = interpolate(f, [0, 20], [0, newPrice], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 2. The strike draws across it.
  const strike = interpolate(f, [26, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 3. The used price counts up in accent at display size.
  const usedIn = spring({ frame: f - 44, fps, config: SPRING.settle, durationInFrames: 20 });
  const usedCount = interpolate(f, [44, 66], [0, usedPrice], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 4. The savings pill stamps in — bouncy spring, deliberate overshoot.
  const pill = spring({ frame: f - 70, fps, config: SPRING.pop, durationInFrames: 26 });
  const pillRotate = interpolate(pill, [0, 0.55, 1], [-12, 4, -2], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const saving = newPrice - usedPrice;

  return (
    <div
      dir="rtl"
      style={{ display: "flex", flexDirection: "column", gap: 24 * u, width: "100%" }}
    >
      {/* Row 1 — new price, struck through */}
      <div
        style={{
          display: "flex",
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: 20 * u,
          translate: `${(1 - newIn) * 120 * u}px 0px`,
          opacity: newIn,
        }}
      >
        <span style={{ fontFamily, fontWeight: 400, fontSize: font(40), color: colors.subtle }}>
          سعر الجديد
        </span>
        <div style={{ position: "relative" }}>
          <span style={{ fontFamily, fontWeight: 700, fontSize: font(56), color: colors.subtle }}>
            {formatPrice(newCount)}
          </span>
          <div
            style={{
              position: "absolute",
              top: "54%",
              right: 0,
              height: 6 * u,
              borderRadius: 3 * u,
              backgroundColor: colors.red,
              width: `${strike * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Row 2 — used price, accent, display size */}
      <div
        style={{
          display: "flex",
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: 20 * u,
          translate: `${(1 - usedIn) * 120 * u}px 0px`,
          opacity: usedIn,
        }}
      >
        <span style={{ fontFamily, fontWeight: 700, fontSize: font(44), color: colors.ink }}>
          سعر المستعمل
        </span>
        <span
          style={{
            fontFamily,
            fontWeight: 900,
            fontSize: font(96),
            color: colors.accent,
            lineHeight: 1,
          }}
        >
          {formatPrice(usedCount)}
        </span>
      </div>

      {/* Savings pill — stamps in last, the payoff of the whole ad */}
      <div
        style={{
          alignSelf: "flex-start",
          scale: pill,
          rotate: `${pillRotate}deg`,
        }}
      >
        <div
          style={{
            backgroundColor: colors.green,
            borderRadius: radius.pill,
            padding: `${16 * u}px ${34 * u}px`,
            boxShadow: `0 ${12 * u}px ${28 * u}px rgba(31,107,92,0.32)`,
          }}
        >
          <span
            style={{
              fontFamily,
              fontWeight: 900,
              fontSize: font(48),
              color: colors.white,
              display: "block",
            }}
          >
            {AD.hero.savingsLabel} {formatPrice(saving)}
          </span>
        </div>
      </div>
    </div>
  );
};
