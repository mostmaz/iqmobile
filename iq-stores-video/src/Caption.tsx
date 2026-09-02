import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { theme } from "./theme";
import { loadFont } from "@remotion/google-fonts/Cairo";

const { fontFamily } = loadFont();

// Bottom caption bar. One line of frank Arabic per beat, on an ink slab so it
// stays readable over any screenshot. Rises and fades with its scene rather
// than cutting, so the eye is never yanked off the phone above it.
export const Caption: React.FC<{
  text: string;
  accent?: string;
  durationInFrames: number;
}> = ({ text, accent, durationInFrames }) => {
  const frame = useCurrentFrame();

  return (
    <Interactive.Div
      name="Caption"
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        bottom: 150,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        opacity: interpolate(
          frame,
          [0, 10, durationInFrames - 10, durationInFrames],
          [0, 1, 1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
        translate: interpolate(frame, [0, 14], ["0px 40px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      <div
        style={{
          backgroundColor: theme.ink,
          borderRadius: 28,
          padding: "26px 44px",
          maxWidth: 900,
        }}
      >
        <span
          style={{
            fontFamily,
            fontWeight: 700,
            fontSize: 58,
            lineHeight: 1.35,
            color: theme.surface,
            direction: "rtl",
            display: "block",
            textAlign: "center",
          }}
        >
          {text}
        </span>
      </div>
      {accent ? (
        <div
          style={{
            backgroundColor: theme.accent,
            borderRadius: 999,
            padding: "14px 34px",
          }}
        >
          <span
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: 40,
              color: "#fff",
              direction: "rtl",
              display: "block",
            }}
          >
            {accent}
          </span>
        </div>
      ) : null}
    </Interactive.Div>
  );
};
