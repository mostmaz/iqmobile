import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, cairo, SceneBox, CaptionBar, usePop, useGlide, bob, useLayout } from "../kit";
import { Character } from "../Character";

// 0:00–0:02 — the problem. He's scrolling, shoulders down; question marks and
// price tags with "؟" drift around him, then scatter outward on the beat that
// ends the shot. Nothing blames a seller: the frustration is the unknown
// price, which is exactly what the app answers.

// Positions are percentages of the safe box, so the ring of doubts holds its
// shape in 9:16, 1:1 and 16:9 alike.
const DOUBTS = [
  { x: 4, y: 30, r: -14, kind: "q" as const, d: 4 },
  { x: 66, y: 24, r: 12, kind: "tag" as const, d: 10 },
  { x: 0, y: 54, r: 9, kind: "tag" as const, d: 16 },
  { x: 74, y: 50, r: -10, kind: "q" as const, d: 22 },
  { x: 40, y: 12, r: 6, kind: "q" as const, d: 28 },
];

export const SceneProblem: React.FC<{ durationInFrames: number }> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const enter = useGlide(frame, 0);
  const scatterAt = durationInFrames - 12;
  const scatter = Math.max(0, (frame - scatterAt) / 12);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <SceneBox>
        {/* Character anchored to the floor of the box */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            translate: `0px ${(1 - enter) * 90 * u}px`,
          }}
        >
          <Character pose="slumped" fromPose="slumped" frame={frame} height={700 * u} />
        </div>

        {DOUBTS.map((d, i) => {
          const p = usePop(frame, d.d);
          const drift = bob(frame, 12 * u, 120, i * 30);
          const dx = (d.x - 38) * scatter * 16 * u;
          const dy = (d.y - 40) * scatter * 16 * u - scatter * 40 * u;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${d.x}%`,
                top: `${d.y}%`,
                scale: p * (1 - scatter * 0.6),
                rotate: `${d.r + scatter * d.r * 3}deg`,
                translate: `${dx}px ${dy + drift}px`,
              }}
            >
              {d.kind === "q" ? <QuestionMark u={u} /> : <PriceTag u={u} />}
            </div>
          );
        })}
      </SceneBox>

      <CaptionBar text="تدوّر على موبايل مستعمل؟" frame={frame} delay={6} />
    </AbsoluteFill>
  );
};

const QuestionMark: React.FC<{ u: number }> = ({ u }) => (
  <div
    style={{
      width: 104 * u,
      height: 104 * u,
      borderRadius: 999,
      backgroundColor: C.surface,
      border: `${5 * u}px solid ${C.ink}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <span style={{ fontFamily: cairo, fontWeight: 800, fontSize: 62 * u, color: C.ink }}>
      ؟
    </span>
  </div>
);

const PriceTag: React.FC<{ u: number }> = ({ u }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "row-reverse",
      alignItems: "center",
      gap: 10 * u,
      backgroundColor: C.surface,
      border: `${5 * u}px solid ${C.ink}`,
      borderRadius: 20 * u,
      padding: `${13 * u}px ${24 * u}px`,
    }}
  >
    <span style={{ fontFamily: cairo, fontWeight: 800, fontSize: 46 * u, color: C.ink }}>
      ؟؟؟
    </span>
    <span style={{ fontFamily: cairo, fontWeight: 700, fontSize: 28 * u, color: C.subtle }}>
      د.ع
    </span>
  </div>
);
