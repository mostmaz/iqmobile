import React from "react";
import { spring, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Cairo";

const { fontFamily } = loadFont();
export const cairo = fontFamily;

// Strict palette from the brief (matches the app's own theme.ts).
export const C = {
  accent: "#D9583A",
  deep: "#B23F25",
  bg: "#ECE6DA",
  surface: "#F5F0E6",
  ink: "#1B1A18",
  subtle: "#6E6A62",
  green: "#1F6B5C",
  red: "#B43A2E",
  line: "rgba(27,26,24,0.08)",
  chipInk: "#3A352D",
  // Support tones derived from the palette (shadows / skin), kept minimal.
  skin: "#D9A273",
  skinDark: "#B9834F",
} as const;

// ── Motion helpers ───────────────────────────────────────────────────
// Every entrance is a spring — the brief bans linear fades, so nothing
// here interpolates opacity on its own; things arrive by scaling and
// travelling, and opacity only ever rides along for the first few frames.

/** Snappy pop for badges and chips. Overshoots, then settles. */
export const usePop = (frame: number, delay = 0) => {
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 11, mass: 0.6, stiffness: 190 },
  });
};

/** Softer arrival for larger objects (cards, the phone, the character). */
export const useGlide = (frame: number, delay = 0) => {
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 15, mass: 0.9, stiffness: 120 },
  });
};

/** Continuous bob — used for floating elements, never for entrances. */
export const bob = (frame: number, amplitude = 6, period = 90, phase = 0) =>
  Math.sin(((frame + phase) / period) * Math.PI * 2) * amplitude;

// ── Layout ───────────────────────────────────────────────────────────
// One design, three deliverables. Rather than pinning art into a fixed
// square (which left dead space in 9:16 and let elements collide), every
// scene fills a SAFE CONTENT BOX and sizes itself from `u` — one design
// unit, 1/1080 of the frame's governing dimension. A value of 100 is the
// same visual weight in all three formats.
export type LayoutMode = "vertical" | "square" | "wide";

export const useLayout = () => {
  const { width, height } = useVideoConfig();
  const ratio = width / height;
  const mode: LayoutMode =
    ratio > 1.2 ? "wide" : ratio < 0.85 ? "vertical" : "square";
  // Wide formats are height-bound; the others are width-bound.
  const u = (mode === "wide" ? height : width) / 1080;
  // Room reserved at the bottom for the burned-in caption.
  const captionBand = mode === "wide" ? height * 0.2 : height * 0.17;
  return { width, height, mode, u, captionBand };
};

/**
 * The safe content box: full frame minus the caption band and a margin.
 * Scenes position inside it with percentages, so nothing can drift under
 * the caption or off the edge in any format.
 */
export const SceneBox: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { width, height, captionBand, u } = useLayout();
  return (
    <div
      style={{
        position: "absolute",
        left: 60 * u,
        right: 60 * u,
        top: 70 * u,
        height: height - captionBand - 70 * u,
        width: width - 120 * u,
      }}
    >
      {children}
    </div>
  );
};

// ── Burned-in Arabic caption ─────────────────────────────────────────
export const CaptionBar: React.FC<{
  text: string;
  frame: number;
  delay?: number;
}> = ({ text, frame, delay = 4 }) => {
  const { width, captionBand, u } = useLayout();
  const p = usePop(frame, delay);
  // Brief floor is 40px at 1080 wide; headline captions run well above it.
  const size = 56 * u;

  return (
    <div
      style={{
        position: "absolute",
        left: 50 * u,
        right: 50 * u,
        bottom: 0,
        height: captionBand,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        scale: 0.86 + p * 0.14,
        translate: `0px ${(1 - p) * 44 * u}px`,
      }}
    >
      <div
        style={{
          backgroundColor: C.ink,
          borderRadius: 26 * u,
          padding: `${size * 0.4}px ${size * 0.78}px`,
          maxWidth: width * 0.88,
        }}
      >
        <span
          style={{
            fontFamily: cairo,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1.32,
            color: C.surface,
            direction: "rtl",
            display: "block",
            textAlign: "center",
            whiteSpace: "pre-line",
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
};

// Arabic-Indic numerals, the way prices are written locally.
const AR = "٠١٢٣٤٥٦٧٨٩";
export const arNum = (n: number | string) =>
  String(n).replace(/\d/g, (d) => AR[+d]);
export const arPrice = (n: number) =>
  arNum(n.toLocaleString("en-US"));
