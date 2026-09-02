import React from "react";
import { colors } from "../theme";

// Flat vector figure: rounded-rect torso, circle head, simple limb shapes.
// Facial detail is deliberately two dot eyes and a single-stroke mouth —
// mood changes ONLY the mouth curve and the eyebrow angle, so the same
// person carries every scene.

export type Mood = "frustrated" | "neutral" | "happy";
export type CharacterVariant = "charcoal" | "rust";

const MOOD = {
  // mouthCurve: negative bows down (frustrated), positive bows up (happy)
  frustrated: { mouthCurve: -14, brow: 14 },
  neutral: { mouthCurve: 0, brow: 0 },
  happy: { mouthCurve: 16, brow: -6 },
} as const;

const VARIANT = {
  charcoal: { shirt: "#3A352D", shirtDark: "#2A261F" },
  rust: { shirt: colors.accent, shirtDark: colors.deep },
} as const;

export const Character: React.FC<{
  mood: Mood;
  holdingPhone?: boolean;
  variant?: CharacterVariant;
  /** Rendered height in px; width follows the 300:460 rig aspect. */
  height: number;
  /** 0→1 blend between the previous mood and this one. */
  moodBlend?: number;
  previousMood?: Mood;
}> = ({
  mood,
  holdingPhone = false,
  variant = "charcoal",
  height,
  moodBlend = 1,
  previousMood,
}) => {
  const from = MOOD[previousMood ?? mood];
  const to = MOOD[mood];
  const mouthCurve = from.mouthCurve + (to.mouthCurve - from.mouthCurve) * moodBlend;
  const brow = from.brow + (to.brow - from.brow) * moodBlend;
  const v = VARIANT[variant];

  return (
    <svg
      viewBox="0 0 300 460"
      width={height * (300 / 460)}
      height={height}
      style={{ overflow: "visible" }}
    >
      {/* Ground shadow keeps the figure from floating */}
      <ellipse cx="150" cy="440" rx="96" ry="15" fill="rgba(27,26,24,0.10)" />

      {/* Legs */}
      <rect x="112" y="300" width="30" height="132" rx="15" fill="#2E2A26" />
      <rect x="158" y="300" width="30" height="132" rx="15" fill="#2E2A26" />

      {/* Torso — rounded rect, per spec */}
      <rect x="86" y="150" width="128" height="176" rx="46" fill={v.shirt} />

      {/* Arms. When holding a phone both forearms angle inward to meet it. */}
      <rect
        x="60"
        y="176"
        width="34"
        height={holdingPhone ? 108 : 140}
        rx="17"
        fill={v.shirtDark}
        transform={holdingPhone ? "rotate(-16 77 200)" : undefined}
      />
      <rect
        x="206"
        y="176"
        width="34"
        height={holdingPhone ? 108 : 140}
        rx="17"
        fill={v.shirtDark}
        transform={holdingPhone ? "rotate(16 223 200)" : undefined}
      />

      {/* Phone held in front */}
      {holdingPhone ? (
        <g>
          <rect x="122" y="252" width="56" height="94" rx="12" fill={colors.ink} />
          <rect x="128" y="258" width="44" height="82" rx="8" fill={colors.surface} />
          <rect x="134" y="266" width="32" height="7" rx="3.5" fill={colors.accent} />
          <rect x="134" y="280" width="32" height="20" rx="5" fill={colors.chip} />
          <rect x="134" y="306" width="32" height="20" rx="5" fill={colors.chip} />
        </g>
      ) : null}

      {/* Neck + head */}
      <rect x="136" y="118" width="28" height="40" rx="14" fill="#B9834F" />
      <circle cx="150" cy="86" r="56" fill="#D9A273" />
      {/* Hair: short, dark, with a straight front line */}
      <path
        d="M96 74 C 96 36 120 24 150 24 C 180 24 204 36 204 74 C 196 56 178 50 150 50 C 122 50 104 56 96 74 Z"
        fill={colors.ink}
      />
      {/* Trimmed beard along the jaw */}
      <path
        d="M100 92 C 100 132 122 142 150 142 C 178 142 200 132 200 92 C 200 118 182 126 150 126 C 118 126 100 118 100 92 Z"
        fill={colors.ink}
        opacity={0.85}
      />

      {/* Brows — angle is the only other mood signal */}
      <rect
        x="118"
        y="70"
        width="24"
        height="6"
        rx="3"
        fill={colors.ink}
        transform={`rotate(${brow} 130 73)`}
      />
      <rect
        x="158"
        y="70"
        width="24"
        height="6"
        rx="3"
        fill={colors.ink}
        transform={`rotate(${-brow} 170 73)`}
      />

      {/* Two dot eyes */}
      <circle cx="130" cy="90" r="6.5" fill={colors.ink} />
      <circle cx="170" cy="90" r="6.5" fill={colors.ink} />

      {/* Single-stroke mouth; the curve carries the mood */}
      <path
        d={`M132 112 Q 150 ${112 + mouthCurve} 168 112`}
        stroke={colors.ink}
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
};
