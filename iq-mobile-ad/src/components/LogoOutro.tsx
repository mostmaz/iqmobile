import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING, radius } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";
import { AD } from "../data";
import { LogoMark } from "./icons";

// Closing card: the logo springs in, the wordmark follows, store badges
// slide up beneath on a stagger, and the price disclaimer sits at the very
// bottom — Meta can reject a price-claim ad without it.
export const LogoOutro: React.FC<{ from?: number }> = ({ from = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, font, safe } = useLayout();
  const fontFamily = useCairo();
  const f = frame - from;

  const logo = spring({ frame: f, fps, config: SPRING.pop, durationInFrames: 30 });
  const word = spring({ frame: f - 8, fps, config: SPRING.settle, durationInFrames: 22 });

  return (
    <div
      dir="rtl"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28 * u,
      }}
    >
      <div style={{ scale: logo }}>
        <LogoMark size={220 * u} />
      </div>

      <span
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: font(80),
          color: colors.ink,
          opacity: word,
          translate: `0px ${(1 - word) * 24 * u}px`,
        }}
      >
        {AD.brand.name}
      </span>

      {/* Store badges slide up, staggered by index */}
      <div style={{ display: "flex", flexDirection: "row-reverse", gap: 20 * u, marginTop: 8 * u }}>
        {AD.outro.stores.map((store, i) => {
          const b = spring({
            frame: f - 20 - i * 5,
            fps,
            config: SPRING.settle,
            durationInFrames: 22,
          });
          return (
            <div
              key={store}
              style={{
                backgroundColor: colors.ink,
                borderRadius: radius.pill,
                padding: `${18 * u}px ${36 * u}px`,
                translate: `0px ${(1 - b) * 70 * u}px`,
                opacity: b,
              }}
            >
              <span style={{ fontFamily, fontWeight: 700, fontSize: font(36), color: colors.surface }}>
                {store}
              </span>
            </div>
          );
        })}
      </div>

      {/* Required disclaimer — caption size, subtle, inside the safe zone */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: safe.bottom * 0.35, textAlign: "center" }}>
        <span style={{ fontFamily, fontWeight: 400, fontSize: font(32), color: colors.subtle }}>
          {AD.outro.disclaimer}
        </span>
      </div>
    </div>
  );
};
