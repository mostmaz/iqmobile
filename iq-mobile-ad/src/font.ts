import { loadFont } from "@remotion/google-fonts/Cairo";

// Cairo at 400/700/900 — the weights the type scale calls for.
const { fontFamily, waitUntilDone } = loadFont("normal", {
  weights: ["400", "700", "900"],
  subsets: ["arabic", "latin"],
});

// Block the render until the font is ready, so no frame is rasterised with
// a fallback face (which would break Arabic shaping).
waitUntilDone();

export const useCairo = () => fontFamily;
export const cairo = fontFamily;
