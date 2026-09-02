import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";
import { AD } from "../data";
import { IconWhatsApp, IconChatBubble, IconCall } from "./icons";

// Three circular channel buttons. They stagger in from the right, then the
// first (WhatsApp — the channel Iraqi buyers actually use) scales up and
// pulses once so the eye lands on it.
export const ContactRow: React.FC<{ from?: number }> = ({ from = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, font } = useLayout();
  const fontFamily = useCairo();
  const f = frame - from;

  const items = [
    { icon: <IconWhatsApp size={72 * u} />, label: AD.contact.channels[0] },
    { icon: <IconChatBubble size={72 * u} />, label: AD.contact.channels[1] },
    { icon: <IconCall size={72 * u} />, label: AD.contact.channels[2] },
  ];

  // One pulse on the first button after all three have landed.
  const pulse = interpolate(f, [30, 38, 46], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      dir="rtl"
      style={{
        display: "flex",
        flexDirection: "row-reverse",
        justifyContent: "center",
        gap: 32 * u,
      }}
    >
      {items.map((item, i) => {
        // 4-frame stagger by index.
        const p = spring({
          frame: f - i * 4,
          fps,
          config: SPRING.settle,
          durationInFrames: 20,
        });
        const isFirst = i === 0;
        return (
          <div
            key={item.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12 * u,
              // Enters from the right, per the RTL motion rule.
              translate: `${(1 - p) * 90 * u}px 0px`,
              opacity: p,
              scale: isFirst ? 1 + pulse * 0.12 : 1,
            }}
          >
            <div
              style={{
                width: 116 * u,
                height: 116 * u,
                borderRadius: 999,
                backgroundColor: colors.surface,
                border: `${2 * u}px solid rgba(27,26,24,0.08)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: isFirst
                  ? `0 0 0 ${pulse * 14 * u}px rgba(31,107,92,0.14)`
                  : "none",
              }}
            >
              {item.icon}
            </div>
            <span style={{ fontFamily, fontWeight: 400, fontSize: font(32), color: colors.subtle }}>
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};
