import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING, radius } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";
import { AD } from "../data";
import { PhoneFrame } from "../components/PhoneFrame";
import { Caption } from "../components/Caption";
import { IconCamera, IconPriceTag, IconBell, IconCheck } from "../components/icons";

// SCENE 3 — THE LISTING (0:09–0:14)
// The phone scales up and the three steps to publish animate in sequence,
// each with a checkmark stamping in after it. Publishing is three taps, and
// the shot's job is to make that feel like three taps.
export const Scene3Listing: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, font, content, safe, width } = useLayout();
  const fontFamily = useCairo();

  const phone = spring({ frame, fps, config: SPRING.settle, durationInFrames: 30 });
  const exit = interpolate(frame, [exitAt, exitAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ICONS = { camera: IconCamera, price: IconPriceTag, bell: IconBell };
  // The phone fills ~60% of the frame, per the brief.
  const screenW = Math.min(width * 0.44, content.height * 0.42);

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
          translate: `${-exit * 200 * u}px 0px`,
          opacity: 1 - exit,
        }}
      >
        <PhoneFrame width={screenW} scale={0.86 + phone * 0.14}>
          <div style={{ padding: `${screenW * 0.09}px ${screenW * 0.07}px`, display: "flex", flexDirection: "column", gap: screenW * 0.05 }}>
            {AD.steps.items.map((step, i) => {
              // 5-frame stagger per row.
              const row = spring({
                frame: frame - 16 - i * 5,
                fps,
                config: SPRING.settle,
                durationInFrames: 22,
              });
              // The checkmark stamps in after its row has settled.
              const check = spring({
                frame: frame - 34 - i * 5,
                fps,
                config: SPRING.pop,
                durationInFrames: 20,
              });
              const Icon = ICONS[step.icon];
              return (
                <div
                  key={step.label}
                  dir="rtl"
                  style={{
                    display: "flex",
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    gap: screenW * 0.045,
                    backgroundColor: colors.bg,
                    borderRadius: radius.card * u,
                    padding: `${screenW * 0.05}px ${screenW * 0.05}px`,
                    // Rows enter from the right.
                    translate: `${(1 - row) * 160 * u}px 0px`,
                    opacity: row,
                  }}
                >
                  <div
                    style={{
                      width: screenW * 0.16,
                      height: screenW * 0.16,
                      borderRadius: radius.card * u * 0.7,
                      backgroundColor: colors.chip,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={screenW * 0.095} />
                  </div>
                  <span
                    style={{
                      flex: 1,
                      fontFamily,
                      fontWeight: 700,
                      fontSize: font(38),
                      color: colors.ink,
                    }}
                  >
                    {step.label}
                  </span>
                  <div
                    style={{
                      width: screenW * 0.1,
                      height: screenW * 0.1,
                      borderRadius: 999,
                      backgroundColor: colors.green,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      scale: check,
                    }}
                  >
                    <IconCheck size={screenW * 0.06} />
                  </div>
                </div>
              );
            })}
          </div>
        </PhoneFrame>
      </div>

      <Caption text={AD.steps.caption} from={10} exitAt={exitAt} />
    </AbsoluteFill>
  );
};
