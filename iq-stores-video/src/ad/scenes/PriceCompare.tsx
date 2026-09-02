import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, cairo, SceneBox, CaptionBar, usePop, useGlide, arPrice, useLayout } from "../kit";
import { PhoneGlyph } from "../vector-ui";

// 0:05–0:09 — the hero. The camera pushes into a single listing card and the
// two prices land side by side: the new price struck through in grey, the
// used price big in accent. The savings badge then stamps into the card's
// image block — deliberately ABOVE the numbers, never over them; covering
// the price would defeat the only shot that explains the product.

const NEW_PRICE = 750000;
const USED_PRICE = 450000;
const SAVING = NEW_PRICE - USED_PRICE;

export const ScenePrice: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, mode } = useLayout();

  const push = useGlide(frame, 0);
  const creep = interpolate(frame, [0, 120], [0, 0.05], {
    extrapolateRight: "clamp",
  });

  const newIn = useGlide(frame, 14);
  const strike = interpolate(frame, [26, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const usedIn = usePop(frame, 40);
  const badgeIn = usePop(frame, 62);
  const badgeRot = interpolate(badgeIn, [0, 0.6, 1], [-14, 4, -3]);

  // The card is the whole shot; in wide it can afford to be a little smaller.
  const cardW = mode === "wide" ? 820 * u : 900 * u;

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <SceneBox>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            scale: 0.82 + push * 0.18 + creep,
          }}
        >
          <div
            style={{
              width: cardW,
              backgroundColor: C.surface,
              borderRadius: 44 * u,
              border: `${3 * u}px solid ${C.line}`,
              boxShadow: `0 ${40 * u}px ${90 * u}px rgba(27,26,24,0.20)`,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Image block — also holds the savings stamp */}
            <div
              style={{
                height: 300 * u,
                backgroundColor: "#E2DBCB",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 28 * u,
                position: "relative",
              }}
            >
              <PhoneGlyph size={132 * u} color={C.ink} />
              <div
                style={{
                  backgroundColor: C.surface,
                  borderRadius: 99,
                  padding: `${14 * u}px ${30 * u}px`,
                }}
              >
                <span style={{ fontFamily: cairo, fontWeight: 700, fontSize: 40 * u, color: C.chipInk }}>
                  مستعمل · ٢٥٦ گيگا
                </span>
              </div>

              {/* Savings badge stamps into the corner of the image block */}
              <div
                style={{
                  position: "absolute",
                  left: 28 * u,
                  top: 28 * u,
                  scale: badgeIn * 1.02,
                  rotate: `${badgeRot}deg`,
                }}
              >
                <div
                  style={{
                    backgroundColor: C.green,
                    borderRadius: 24 * u,
                    padding: `${18 * u}px ${32 * u}px`,
                    boxShadow: `0 ${14 * u}px ${32 * u}px rgba(31,107,92,0.34)`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: cairo,
                      fontWeight: 800,
                      fontSize: 50 * u,
                      color: "#fff",
                      direction: "rtl",
                      display: "block",
                    }}
                  >
                    توفّر {arPrice(SAVING)}
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                padding: `${36 * u}px ${44 * u}px ${46 * u}px`,
                display: "flex",
                flexDirection: "column",
                gap: 26 * u,
              }}
            >
              {/* New price — struck through, grey, secondary */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 22 * u,
                  translate: `${(1 - newIn) * 90 * u}px 0px`,
                  opacity: Math.min(1, newIn * 2),
                }}
              >
                <span style={{ fontFamily: cairo, fontWeight: 700, fontSize: 40 * u, color: C.subtle, direction: "rtl" }}>
                  السعر الجديد
                </span>
                <div style={{ position: "relative" }}>
                  <span style={{ fontFamily: cairo, fontWeight: 800, fontSize: 62 * u, color: C.subtle }}>
                    {arPrice(NEW_PRICE)}
                  </span>
                  <div
                    style={{
                      position: "absolute",
                      top: "52%",
                      right: 0,
                      height: 7 * u,
                      borderRadius: 4 * u,
                      backgroundColor: C.red,
                      width: `${strike * 100}%`,
                    }}
                  />
                </div>
              </div>

              {/* Used price — the number the whole ad exists for */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 22 * u,
                  scale: 0.7 + usedIn * 0.3,
                  translate: `0px ${(1 - usedIn) * 40 * u}px`,
                }}
              >
                <span style={{ fontFamily: cairo, fontWeight: 700, fontSize: 44 * u, color: C.ink, direction: "rtl" }}>
                  سعر المستعمل
                </span>
                <span style={{ fontFamily: cairo, fontWeight: 800, fontSize: 104 * u, color: C.accent, lineHeight: 1 }}>
                  {arPrice(USED_PRICE)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </SceneBox>

      <CaptionBar text="تشوف سعر الجديد جنب المستعمل" frame={frame} delay={8} />
    </AbsoluteFill>
  );
};
