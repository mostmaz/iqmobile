import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, SceneBox, CaptionBar, usePop, useGlide, useLayout } from "../kit";
import { Character } from "../Character";
import { PhoneFrame, DeviceCard, GovPin, Logo } from "../vector-ui";

// 0:02–0:05 — he sits up and the app opens. The logo lands first, listing
// cards slide in from alternating sides, then governorate pins pop around
// the phone: the promise of this shot is "devices from everywhere", so the
// pins are its payload.

// Pins live at the box's four corners, clear of the phone in the middle.
const GOVS = [
  { label: "بغداد", x: 0, y: 8, d: 30 },
  { label: "الموصل", x: 72, y: 0, d: 36 },
  { label: "البصرة", x: 0, y: 58, d: 42 },
  { label: "النجف", x: 74, y: 26, d: 48 },
];

export const SceneApp: React.FC = () => {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const sitUp = useGlide(frame, 0);
  const phoneIn = useGlide(frame, 6);
  const logoIn = usePop(frame, 10);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <SceneBox>
        {/* Character sits low-right, behind the phone */}
        <div
          style={{
            position: "absolute",
            right: "-6%",
            bottom: 0,
            opacity: 0.95,
          }}
        >
          <Character
            pose="upright"
            fromPose="slumped"
            blend={sitUp}
            frame={frame}
            showPhone={false}
            height={560 * u}
          />
        </div>

        {/* The phone owns the centre */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "2%",
            display: "flex",
            justifyContent: "center",
            scale: 0.86 + phoneIn * 0.14,
            translate: `0px ${(1 - phoneIn) * 120 * u}px`,
          }}
        >
          <PhoneFrame width={430 * u}>
            <div
              style={{
                padding: `${22 * u}px ${18 * u}px ${10 * u}px`,
                display: "flex",
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: 12 * u,
                scale: 0.7 + logoIn * 0.3,
              }}
            >
              <Logo size={54 * u} />
              <div
                style={{
                  flex: 1,
                  height: 34 * u,
                  borderRadius: 99,
                  backgroundColor: C.surface,
                  border: `${2 * u}px solid ${C.line}`,
                }}
              />
            </div>

            <div
              style={{
                padding: `${6 * u}px ${18 * u}px`,
                display: "flex",
                flexWrap: "wrap",
                gap: 12 * u,
                flexDirection: "row-reverse",
              }}
            >
              {[0, 1, 2, 3].map((i) => {
                const p = useGlide(frame, 14 + i * 5);
                const fromLeft = i % 2 === 0;
                return (
                  <div
                    key={i}
                    style={{
                      translate: `${(fromLeft ? -320 : 320) * (1 - p) * u}px 0px`,
                      scale: 0.9 + p * 0.1,
                    }}
                  >
                    <DeviceCard w={178 * u} />
                  </div>
                );
              })}
            </div>
          </PhoneFrame>
        </div>

        {/* Pins pop in and settle at the corners */}
        {GOVS.map((g) => {
          const p = usePop(frame, g.d);
          return (
            <div
              key={g.label}
              style={{
                position: "absolute",
                left: `${g.x}%`,
                top: `${g.y}%`,
                scale: p,
                translate: `0px ${(1 - p) * -30 * u}px`,
              }}
            >
              <GovPin label={g.label} scale={1.15 * u} />
            </div>
          );
        })}
      </SceneBox>

      <CaptionBar text="أجهزة من كل المحافظات" frame={frame} delay={20} />
    </AbsoluteFill>
  );
};
