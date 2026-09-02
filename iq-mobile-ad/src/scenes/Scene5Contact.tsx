import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, SPRING, radius } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";
import { AD } from "../data";
import { PhoneFrame } from "../components/PhoneFrame";
import { ContactRow } from "../components/ContactRow";
import { Character } from "../components/Character";
import { Caption } from "../components/Caption";

// SCENE 5 — THE CONTACT (0:21–0:26)
// EXACTLY ONE incoming message. The platform's real average is ~1.4
// contacts per listing; a notification stack would oversell the product and
// set an expectation the marketplace can't meet. The bubble slides in from
// the right and vibrates briefly, the way a phone does when it buzzes.
export const Scene5Contact: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, font, content, safe, width, mode } = useLayout();
  const fontFamily = useCairo();

  const phone = spring({ frame, fps, config: SPRING.settle, durationInFrames: 28 });
  const msg = spring({ frame: frame - 22, fps, config: SPRING.settle, durationInFrames: 24 });

  // Subtle vibration: a decaying sine on x over 8 frames, once the message
  // has landed. Clamped so it never re-triggers.
  const buzzT = interpolate(frame, [46, 54], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const buzz = buzzT > 0 && buzzT < 1 ? Math.sin(buzzT * Math.PI * 6) * (1 - buzzT) * 8 * u : 0;

  // His mood flips to happy once the message is in.
  const moodBlend = spring({ frame: frame - 40, fps, config: SPRING.settle, durationInFrames: 22 });

  const exit = interpolate(frame, [exitAt, exitAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const screenW = Math.min(width * 0.4, content.height * 0.36);

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <div
        style={{
          position: "absolute",
          left: safe.left,
          right: safe.right,
          top: safe.top,
          height: content.height,
          translate: `${-exit * 200 * u}px 0px`,
          opacity: 1 - exit,
        }}
      >
        {/* Phone with the single message on screen */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            display: "flex",
            justifyContent: "center",
            translate: `0px ${(1 - phone) * 50 * u}px`,
            opacity: phone,
          }}
        >
          <PhoneFrame width={screenW}>
            <div style={{ padding: screenW * 0.07, display: "flex", flexDirection: "column", gap: screenW * 0.05 }}>
              {/* Chat header */}
              <div style={{ display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: screenW * 0.04 }}>
                <div style={{ width: screenW * 0.13, height: screenW * 0.13, borderRadius: 999, backgroundColor: colors.chip }} />
                <div style={{ height: screenW * 0.05, width: "45%", borderRadius: 999, backgroundColor: colors.chip }} />
              </div>
              {/* The one message */}
              <div
                dir="rtl"
                style={{
                  alignSelf: "flex-start",
                  backgroundColor: colors.chip,
                  borderRadius: radius.card * u,
                  borderTopRightRadius: 6 * u,
                  padding: `${screenW * 0.05}px ${screenW * 0.06}px`,
                  maxWidth: "88%",
                  translate: `${(1 - msg) * 140 * u + buzz}px 0px`,
                  opacity: msg,
                }}
              >
                <span style={{ fontFamily, fontWeight: 400, fontSize: font(34), color: colors.ink, lineHeight: 1.4 }}>
                  {AD.contact.message}
                </span>
              </div>
            </div>
          </PhoneFrame>
        </div>

        {/* Contact channels beneath the phone */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: content.height * (mode === "wide" ? 0.02 : 0.12) }}>
          <ContactRow from={30} />
        </div>

        {/* He's pleased — one real buyer is the whole promise */}
        {mode !== "wide" ? (
          <div style={{ position: "absolute", right: 0, bottom: content.height * 0.1 }}>
            <Character
              mood="happy"
              previousMood="neutral"
              moodBlend={moodBlend}
              height={content.height * 0.3}
              variant="charcoal"
            />
          </div>
        ) : null}
      </div>

      <Caption text={AD.contact.caption} from={12} exitAt={exitAt} />
    </AbsoluteFill>
  );
};
