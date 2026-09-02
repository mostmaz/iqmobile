import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, cairo, SceneBox, CaptionBar, usePop, useGlide, useLayout } from "../kit";
import { Character } from "../Character";
import { Logo } from "../vector-ui";

// 0:12–0:15 — the close. He holds the phone up, pleased, on the left; the
// logo, wordmark and store badges stack on the right so nothing lands on
// top of him. The price disclaimer sits under the caption: the hero shot's
// numbers are illustrative and the ad has to say so.

export const SceneClose: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, width } = useLayout();

  const raise = useGlide(frame, 0);
  const logoIn = usePop(frame, 12);
  const badges = useGlide(frame, 26);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <SceneBox>
        {/* Logo + wordmark + badges: one centred column in the upper half */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24 * u,
          }}
        >
          <div style={{ scale: 0.7 + logoIn * 0.3 }}>
            <Logo size={200 * u} />
          </div>
          <span
            style={{
              fontFamily: cairo,
              fontWeight: 800,
              fontSize: 86 * u,
              color: C.ink,
              scale: 0.85 + logoIn * 0.15,
            }}
          >
            IQ Mobile
          </span>
          <div
            style={{
              display: "flex",
              flexDirection: "row-reverse",
              gap: 20 * u,
              translate: `0px ${(1 - badges) * 80 * u}px`,
              scale: 0.9 + badges * 0.1,
            }}
          >
            {["Google Play", "App Store"].map((s) => (
              <div
                key={s}
                style={{
                  backgroundColor: C.ink,
                  borderRadius: 99,
                  padding: `${20 * u}px ${40 * u}px`,
                }}
              >
                <span style={{ fontFamily: cairo, fontWeight: 700, fontSize: 40 * u, color: C.surface }}>
                  {s}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* He holds the phone up at the bottom, clear of the stack above */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            translate: `0px ${(1 - raise) * 60 * u}px`,
          }}
        >
          <Character pose="raised" fromPose="upright" blend={raise} frame={frame} height={620 * u} />
        </div>
      </SceneBox>

      <CaptionBar text="IQ Mobile — نزّله مجاناً" frame={frame} delay={16} />

      {/* Disclaimer — smallest type in the ad, still legible on a phone */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 22 * u,
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontFamily: cairo,
            fontWeight: 600,
            fontSize: Math.max(26 * u, width * 0.022),
            color: C.subtle,
            direction: "rtl",
          }}
        >
          الأسعار للتوضيح فقط
        </span>
      </div>
    </AbsoluteFill>
  );
};
