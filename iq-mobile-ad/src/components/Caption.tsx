import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING, radius } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";

// Bottom-anchored Arabic caption. Words reveal one at a time on a stagger,
// and the whole bar has a defined exit so no scene cuts away from live text.
export const Caption: React.FC<{
  text: string;
  /** Frame the reveal starts on, relative to the scene. */
  from?: number;
  /** Frame the bar starts leaving; omit to hold to the end of the scene. */
  exitAt?: number;
}> = ({ text, from = 6, exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, safe, width, font } = useLayout();
  const fontFamily = useCairo();
  const words = text.split(" ");

  const bar = spring({
    frame: frame - from,
    fps,
    config: SPRING.settle,
    durationInFrames: 22,
  });

  // Exit: slides left (RTL reading direction) and fades out.
  const exit =
    exitAt === undefined
      ? 0
      : interpolate(frame, [exitAt, exitAt + 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const size = font(44);

  return (
    <div
      dir="rtl"
      style={{
        position: "absolute",
        left: safe.left,
        right: safe.right,
        bottom: safe.bottom,
        display: "flex",
        justifyContent: "center",
        translate: `${-exit * width * 0.6}px ${(1 - bar) * 40 * u}px`,
        opacity: 1 - exit,
      }}
    >
      <div
        style={{
          backgroundColor: colors.ink,
          borderRadius: radius.card * u,
          padding: `${size * 0.4}px ${size * 0.75}px`,
          display: "flex",
          flexDirection: "row-reverse",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `${size * 0.08}px ${size * 0.3}px`,
          maxWidth: "100%",
        }}
      >
        {words.map((word, i) => {
          // 4-frame stagger per word — grouped elements never animate as one
          // block (animation rule 3).
          const w = spring({
            frame: frame - from - i * 4,
            fps,
            config: SPRING.settle,
            durationInFrames: 18,
          });
          return (
            <span
              key={`${word}-${i}`}
              style={{
                fontFamily,
                fontWeight: 700,
                fontSize: size,
                lineHeight: 1.3,
                color: colors.surface,
                opacity: w,
                translate: `0px ${(1 - w) * 16 * u}px`,
                display: "inline-block",
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
};
