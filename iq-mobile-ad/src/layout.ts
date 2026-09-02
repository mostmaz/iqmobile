import { useVideoConfig } from "remotion";
import { MIN_FONT_SIZE } from "./theme";

// One design, three formats. Scenes never hard-code pixels: they read `u`
// (the design unit — 1/1080 of the governing dimension) and the safe box,
// so the same components lay out correctly at 1:1, 9:16 and 16:9.

export type LayoutMode = "square" | "vertical" | "wide";

export type Layout = {
  width: number;
  height: number;
  mode: LayoutMode;
  /** Design unit: multiply every authored dimension by this. */
  u: number;
  /** Platform-safe content box, in px, measured from the frame edges. */
  safe: { top: number; bottom: number; left: number; right: number };
  /** Usable content box after safe zones. */
  box: { width: number; height: number };
  /** Height the caption bar occupies at the bottom of the safe box. */
  captionH: number;
  /** The box scenes should actually lay art into: `box` minus the caption. */
  content: { width: number; height: number };
  /** Vertical centre of the usable box, in px from the top of the frame. */
  centerY: number;
  /** Clamp a font size to the 32px floor. */
  font: (size: number) => number;
};

export const useLayout = (): Layout => {
  const { width, height } = useVideoConfig();
  const ratio = width / height;
  const mode: LayoutMode =
    ratio > 1.2 ? "wide" : ratio < 0.85 ? "vertical" : "square";

  // Wide is height-bound; square and vertical are width-bound.
  const u = (mode === "wide" ? height : width) / 1080;

  // Safe zones per the brief. Vertical reserves the platform's own chrome:
  // 240 at the top, 400 at the bottom, where Reels/Stories UI sits.
  const safe =
    mode === "vertical"
      ? { top: 240, bottom: 400, left: 80, right: 80 }
      : mode === "wide"
        ? { top: 60, bottom: 60, left: 120, right: 120 }
        : { top: 80, bottom: 80, left: 80, right: 80 };

  const box = {
    width: width - safe.left - safe.right,
    height: height - safe.top - safe.bottom,
  };

  // The caption bar plus its breathing room. Scenes centre their art in
  // `content`, never in `box`, so nothing can end up underneath the words.
  const captionH = 190 * u;
  const content = { width: box.width, height: box.height - captionH };

  return {
    width,
    height,
    mode,
    u,
    safe,
    box,
    captionH,
    content,
    centerY: safe.top + content.height / 2,
    font: (size: number) => Math.max(size * u, MIN_FONT_SIZE),
  };
};
