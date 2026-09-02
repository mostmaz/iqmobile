import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING, radius } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";
import { AD } from "../data";
import { Character } from "../components/Character";
import { Caption } from "../components/Caption";
import { LogoMark } from "../components/icons";

// SCENE 2 — THE ADVICE (0:05–0:09)
// A friend arrives from the right and tells him about the app. The first
// character's mood blends frustrated → neutral as the advice lands; the
// logo pops inside the speech bubble.
export const Scene2Advice: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, font, content, safe, captionH } = useLayout();
  const fontFamily = useCairo();

  const friend = spring({ frame, fps, config: SPRING.settle, durationInFrames: 26 });
  const bubble = spring({ frame: frame - 20, fps, config: SPRING.pop, durationInFrames: 28 });
  const logo = spring({ frame: frame - 34, fps, config: SPRING.pop, durationInFrames: 24 });
  // The mood flip is a blend, not a cut.
  const moodBlend = spring({ frame: frame - 40, fps, config: SPRING.settle, durationInFrames: 24 });

  const exit = interpolate(frame, [exitAt, exitAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const charH = content.height * 0.54;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <div style={{ position: "absolute", inset: 0, translate: `${-exit * 200 * u}px 0px`, opacity: 1 - exit }}>
        {/* Man A — left, mood blending to neutral */}
        <div style={{ position: "absolute", left: safe.left, bottom: safe.bottom + content.height * 0.04 }}>
          <Character
            mood="neutral"
            previousMood="frustrated"
            moodBlend={moodBlend}
            holdingPhone
            height={charH}
            variant="charcoal"
          />
        </div>

        {/* Man B — slides in from the right */}
        <div
          style={{
            position: "absolute",
            right: safe.right,
            bottom: safe.bottom + captionH,
            translate: `${(1 - friend) * 320 * u}px 0px`,
            opacity: friend,
          }}
        >
          <Character mood="happy" height={charH} variant="rust" />
        </div>

        {/* Speech bubble expands from him, logo pops inside */}
        <div
          style={{
            position: "absolute",
            right: safe.right + content.width * 0.16,
            top: safe.top + content.height * 0.06,
            scale: bubble,
            transformOrigin: "bottom right",
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              border: `${3 * u}px solid rgba(27,26,24,0.10)`,
              borderRadius: radius.card * u * 1.6,
              borderBottomRightRadius: 8 * u,
              padding: `${28 * u}px ${36 * u}px`,
              display: "flex",
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: 20 * u,
              boxShadow: `0 ${20 * u}px ${44 * u}px rgba(27,26,24,0.14)`,
            }}
          >
            <div style={{ scale: logo }}>
              <LogoMark size={92 * u} />
            </div>
            <span dir="rtl" style={{ fontFamily, fontWeight: 700, fontSize: font(52), color: colors.ink }}>
              {AD.advice.bubble}
            </span>
          </div>
        </div>
      </div>

      <Caption text={AD.advice.caption} from={10} exitAt={exitAt} />
    </AbsoluteFill>
  );
};
