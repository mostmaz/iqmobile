import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, cairo, SceneBox, CaptionBar, usePop, useGlide, useLayout } from "../kit";
import { Character } from "../Character";
import { IconWhatsApp, IconChat, IconPhone } from "../vector-ui";

// 0:09–0:12 — contact. Three channels rise and line up across the top, he
// taps WhatsApp, and ONE message flies to the seller. Exactly one: the real
// average is ~1.4 contacts per listing, and burying him in notifications
// would be both untrue and stressful to watch.

export const SceneContact: React.FC = () => {
  const frame = useCurrentFrame();
  const { u } = useLayout();

  const tap = interpolate(frame, [40, 46, 52], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const msg = usePop(frame, 50);
  const chip = usePop(frame, 66);

  const ICONS = [
    { el: <IconWhatsApp size={104 * u} />, label: "واتساب" },
    { el: <IconChat size={104 * u} />, label: "محادثة" },
    { el: <IconPhone size={104 * u} />, label: "اتصال" },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <SceneBox>
        {/* Channels across the top — the row is the subject of this shot */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "4%",
            display: "flex",
            flexDirection: "row-reverse",
            justifyContent: "center",
            gap: 40 * u,
          }}
        >
          {ICONS.map((ic, i) => {
            const p = useGlide(frame, 4 + i * 6);
            const isWhatsApp = i === 0;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 14 * u,
                  translate: `0px ${(1 - p) * 120 * u}px`,
                  scale: (0.8 + p * 0.2) * (isWhatsApp ? 1 - tap * 0.12 : 1),
                }}
              >
                <div
                  style={{
                    width: 168 * u,
                    height: 168 * u,
                    borderRadius: 48 * u,
                    backgroundColor: C.surface,
                    border: `${3 * u}px solid ${C.line}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: isWhatsApp
                      ? `0 0 0 ${tap * 12 * u}px rgba(31,107,92,0.16)`
                      : "none",
                  }}
                >
                  {ic.el}
                </div>
                <span style={{ fontFamily: cairo, fontWeight: 700, fontSize: 34 * u, color: C.subtle, direction: "rtl" }}>
                  {ic.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* One message flies from the WhatsApp tile toward the seller */}
        <div
          style={{
            position: "absolute",
            right: "4%",
            top: "40%",
            scale: msg,
            translate: `${msg * -60 * u}px ${msg * -30 * u}px`,
            rotate: `${(1 - msg) * -12}deg`,
          }}
        >
          <div
            style={{
              backgroundColor: C.green,
              borderRadius: 30 * u,
              borderBottomRightRadius: 8 * u,
              padding: `${24 * u}px ${38 * u}px`,
              boxShadow: `0 ${16 * u}px ${36 * u}px rgba(31,107,92,0.28)`,
            }}
          >
            <span style={{ fontFamily: cairo, fontWeight: 700, fontSize: 46 * u, color: "#fff", direction: "rtl", display: "block" }}>
              الجهاز متوفر؟
            </span>
          </div>
        </div>

        {/* Character bottom-left, clear of the bubble */}
        <div style={{ position: "absolute", left: "2%", bottom: 0 }}>
          <Character pose="upright" fromPose="upright" frame={frame} height={640 * u} />
        </div>

        {/* "No signup" chip stamps in at the bottom right */}
        <div
          style={{
            position: "absolute",
            right: "2%",
            bottom: "6%",
            scale: chip,
            rotate: `${interpolate(chip, [0, 0.6, 1], [-10, 3, -2])}deg`,
          }}
        >
          <div
            style={{
              backgroundColor: C.ink,
              borderRadius: 26 * u,
              padding: `${20 * u}px ${38 * u}px`,
              display: "flex",
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: 14 * u,
            }}
          >
            <span style={{ fontFamily: cairo, fontWeight: 800, fontSize: 50 * u, color: C.surface, direction: "rtl" }}>
              بدون تسجيل
            </span>
            <svg width={44 * u} height={44 * u} viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke={C.green} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </SceneBox>

      <CaptionBar text="تواصل مباشر — بدون تسجيل" frame={frame} delay={10} />
    </AbsoluteFill>
  );
};
