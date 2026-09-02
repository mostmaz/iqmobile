import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING, radius } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";
import { AD, formatPrice } from "../data";
import { Character } from "../components/Character";
import { Caption } from "../components/Caption";
import { IconArrowDown } from "../components/icons";

// SCENE 1 — THE PROBLEM (0:00–0:05)
// He sold at 250,000 what was worth 400,000. The two tags stack with a
// dashed line between them so the gap is a shape you can see, not a number
// you have to compute. Nothing here blames a buyer or a shop.
export const Scene1Problem: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, font, content, safe, captionH } = useLayout();
  const fontFamily = useCairo();

  const man = spring({ frame, fps, config: SPRING.settle, durationInFrames: 26 });
  const soldTag = spring({ frame: frame - 18, fps, config: SPRING.settle, durationInFrames: 24 });
  const arrow = spring({ frame: frame - 34, fps, config: SPRING.pop, durationInFrames: 24 });
  const worthTag = spring({ frame: frame - 48, fps, config: SPRING.settle, durationInFrames: 24 });
  const dash = interpolate(frame, [62, 82], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Everything leaves to the LEFT (RTL exit) before the transition.
  const exit = interpolate(frame, [exitAt, exitAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const tagW = Math.min(content.width * 0.46, 420 * u);

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <div style={{ position: "absolute", inset: 0, translate: `${-exit * 200 * u}px 0px`, opacity: 1 - exit }}>
        {/* Character, anchored to the bottom of the safe box */}
        <div
          style={{
            position: "absolute",
            left: safe.left,
            bottom: safe.bottom + captionH,
            translate: `0px ${(1 - man) * 60 * u}px`,
            opacity: man,
          }}
        >
          <Character mood="frustrated" holdingPhone height={content.height * 0.6} variant="charcoal" />
        </div>

        {/* Price tags, stacked on the right with the gap between them */}
        <div
          style={{
            position: "absolute",
            right: safe.right,
            top: safe.top + content.height * 0.1,
            width: tagW,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 12 * u,
          }}
        >
          {/* What it was worth — subtle grey, on top */}
          <div
            style={{
              translate: `${(1 - worthTag) * 160 * u}px 0px`,
              opacity: worthTag,
              backgroundColor: colors.surface,
              border: `${3 * u}px solid ${colors.subtle}`,
              borderRadius: radius.card * u,
              padding: `${16 * u}px ${28 * u}px`,
              width: "100%",
              textAlign: "center",
            }}
          >
            <span style={{ fontFamily, fontWeight: 700, fontSize: font(52), color: colors.subtle }}>
              {formatPrice(AD.problem.worth)}
            </span>
          </div>

          {/* The gap, drawn as a dashed line */}
          <svg width={10 * u} height={90 * u} style={{ opacity: dash }}>
            <line
              x1={5 * u}
              y1={0}
              x2={5 * u}
              y2={90 * u * dash}
              stroke={colors.subtle}
              strokeWidth={4 * u}
              strokeDasharray={`${10 * u} ${10 * u}`}
            />
          </svg>

          {/* The red arrow: the drop */}
          <div style={{ scale: arrow, opacity: arrow }}>
            <IconArrowDown size={64 * u} />
          </div>

          {/* What he actually sold for — accent-red border, the sting */}
          <div
            style={{
              translate: `${(1 - soldTag) * 160 * u}px 0px`,
              opacity: soldTag,
              backgroundColor: colors.surface,
              border: `${4 * u}px solid ${colors.red}`,
              borderRadius: radius.card * u,
              padding: `${20 * u}px ${28 * u}px`,
              width: "100%",
              textAlign: "center",
            }}
          >
            <span style={{ fontFamily, fontWeight: 900, fontSize: font(64), color: colors.red }}>
              {formatPrice(AD.problem.soldFor)}
            </span>
          </div>
        </div>
      </div>

      <Caption text={AD.problem.caption} from={8} exitAt={exitAt} />
    </AbsoluteFill>
  );
};
