import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING } from "../theme";
import { useLayout } from "../layout";
import { AD } from "../data";
import { DeviceCard } from "../components/DeviceCard";
import { PriceCompare } from "../components/PriceCompare";
import { Caption } from "../components/Caption";

// SCENE 4 — THE DIFFERENTIATOR (0:14–0:21) — the longest beat.
// The listing card scales in, the camera pushes slowly toward it, and the
// price comparison plays out inside it: new price, strike, used price
// counting up, savings pill. The final state holds a full 45 frames — this
// is the reason the app exists and the viewer needs time to read it.
export const Scene4Differentiator: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, content, safe, width } = useLayout();

  const cardIn = spring({ frame, fps, config: SPRING.settle, durationInFrames: 30 });
  // Camera push: a slow, clamped scale on the container.
  const push = interpolate(frame, [0, 150], [1, 1.07], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(frame, [exitAt, exitAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cardW = Math.min(content.width, width * 0.82);

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <div
        style={{
          position: "absolute",
          left: safe.left,
          right: safe.right,
          top: safe.top,
          height: content.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          scale: (0.88 + cardIn * 0.12) * push,
          translate: `${-exit * 200 * u}px 0px`,
          opacity: 1 - exit,
        }}
      >
        <DeviceCard
          name={AD.hero.device}
          capacity={AD.hero.capacity}
          governorate={AD.hero.governorate}
          price={AD.hero.usedPrice}
          width={cardW}
        >
          {/* The hero comparison starts once the card has settled */}
          <PriceCompare
            newPrice={AD.hero.newPrice}
            usedPrice={AD.hero.usedPrice}
            from={20}
          />
        </DeviceCard>
      </div>

      <Caption text={AD.hero.caption} from={10} exitAt={exitAt} />
    </AbsoluteFill>
  );
};
