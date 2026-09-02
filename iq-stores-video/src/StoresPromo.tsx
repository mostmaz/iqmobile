import {
  AbsoluteFill,
  CanvasImage,
  Easing,
  Interactive,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Cairo";
import { theme } from "./theme";
import { Caption } from "./Caption";

const { fontFamily } = loadFont();

// Real product screenshots, captured from the app running against production.
const SHOT_HUB = staticFile("shot-hub.png");
const SHOT_DIRECTORY = staticFile("shot-directory.png");

// Three beats over 10s: the entry point on the home feed → the directory with
// its filters → the call to action. Each screenshot drifts slowly upward
// (a slow push, not a pan) so the frame breathes without pulling focus off
// the caption.
const SCENE_1 = 100; // 0.0s – 3.3s
const SCENE_2 = 110; // 3.3s – 7.0s
const SCENE_3 = 90; //  7.0s – 10.0s

export const StoresPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Sequence durationInFrames={SCENE_1} name="١ · المتاجر بالصفحة الرئيسية">
        <PhoneScene
          src={SHOT_HUB}
          caption="كل محلات الموبايل بمكان واحد"
          accent="٦٩ متجر"
          durationInFrames={SCENE_1}
        />
      </Sequence>

      <Sequence from={SCENE_1} durationInFrames={SCENE_2} name="٢ · الدليل والفلاتر">
        <PhoneScene
          src={SHOT_DIRECTORY}
          caption="فلتر حسب الماركة والتوصيل والمحافظة"
          durationInFrames={SCENE_2}
          startScale={1.04}
        />
      </Sequence>

      <Sequence from={SCENE_1 + SCENE_2} durationInFrames={SCENE_3} name="٣ · التحميل">
        <OutroScene durationInFrames={SCENE_3} />
      </Sequence>
    </AbsoluteFill>
  );
};

// A screenshot shown as a phone: rounded frame, soft shadow, slow push-in.
const PhoneScene: React.FC<{
  src: string;
  caption: string;
  accent?: string;
  durationInFrames: number;
  startScale?: number;
}> = ({ src, caption, accent, durationInFrames, startScale = 1 }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {/* Warm glow behind the phone so the beige screenshot lifts off the
          beige background instead of merging with it. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 38%, rgba(217,88,58,0.22), rgba(236,230,218,0) 62%)`,
        }}
      />

      <Interactive.Div
        name="Phone"
        style={{
          position: "absolute",
          top: 90,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: interpolate(frame, [0, 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(
            frame,
            [0, durationInFrames],
            [startScale, startScale + 0.06],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              output: "perceptual-scale",
            },
          ),
          translate: interpolate(
            frame,
            [0, durationInFrames],
            ["0px 30px", "0px -40px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.4, 0, 0.6, 1),
            },
          ),
        }}
      >
        <div
          style={{
            width: 640,
            height: 1391,
            borderRadius: 62,
            overflow: "hidden",
            border: `10px solid ${theme.ink}`,
            boxShadow: "0 50px 120px rgba(27,26,24,0.32)",
            backgroundColor: theme.surface,
          }}
        >
          <CanvasImage
            src={src}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      </Interactive.Div>

      {/* The caption sits over the phone's lower third, so the screenshot is
          never fully hidden and the words land where the eye already is. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(236,230,218,1) 12%, rgba(236,230,218,0.86) 26%, rgba(236,230,218,0) 46%)",
        }}
      />
      <Caption
        text={caption}
        accent={accent}
        durationInFrames={durationInFrames}
      />
    </AbsoluteFill>
  );
};

// Closing card — logo mark, the promise, and where to get it.
const OutroScene: React.FC<{ durationInFrames: number }> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.ink,
        alignItems: "center",
        justifyContent: "center",
        gap: 46,
      }}
    >
      <Interactive.Div
        name="Logo"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 240,
          height: 240,
          borderRadius: 64,
          backgroundColor: theme.accent,
          scale: interpolate(frame, [0, 26], [0.6, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
          opacity: interpolate(frame, [0, 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span
          style={{
            fontFamily,
            fontWeight: 700,
            fontSize: 112,
            color: "#fff",
          }}
        >
          iQ
        </span>
      </Interactive.Div>

      <Interactive.Div
        name="Headline"
        style={{
          paddingLeft: 80,
          paddingRight: 80,
          opacity: interpolate(frame, [14, 30], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [14, 32], ["0px 30px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <span
          style={{
            fontFamily,
            fontWeight: 700,
            fontSize: 92,
            lineHeight: 1.3,
            color: theme.surface,
            direction: "rtl",
            display: "block",
            textAlign: "center",
          }}
        >
          دوّر على متجرك
          <br />
          من تطبيق iQ Mobile
        </span>
      </Interactive.Div>

      <Interactive.Div
        name="Stores"
        style={{
          display: "flex",
          flexDirection: "row-reverse",
          gap: 22,
          opacity: interpolate(frame, [30, 46], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [30, 48], ["0px 26px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {["Google Play", "App Store"].map((store) => (
          <div
            key={store}
            style={{
              border: `3px solid ${theme.surface}`,
              borderRadius: 999,
              padding: "20px 44px",
            }}
          >
            <span
              style={{
                fontFamily,
                fontWeight: 700,
                fontSize: 42,
                color: theme.surface,
              }}
            >
              {store}
            </span>
          </div>
        ))}
      </Interactive.Div>

      {/* Fade the whole card out on the last beat so the loop is clean. */}
      <AbsoluteFill
        style={{
          backgroundColor: theme.ink,
          opacity: interpolate(
            frame,
            [durationInFrames - 12, durationInFrames],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          ),
        }}
      />
    </AbsoluteFill>
  );
};
