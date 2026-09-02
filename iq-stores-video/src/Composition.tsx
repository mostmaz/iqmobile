import { Composition } from "remotion";
import { StoresPromo } from "./StoresPromo";
import { Ad, AD_DURATION } from "./ad/Ad";

// The 15s ad ships in three aspect ratios × two audio versions. The visuals
// are one component — every scene lays itself out from useVideoConfig(), so
// a copy change lands in all six renders at once.
const FORMATS = [
  { id: "Reels", width: 1080, height: 1920 }, // 9:16 — reels / stories
  { id: "Feed", width: 1080, height: 1080 }, //  1:1  — feed
  { id: "Wide", width: 1920, height: 1080 }, //  16:9 — YouTube / web
] as const;

export const MyComposition = () => {
  return (
    <>
      {FORMATS.map((f) =>
        (
          [
            { suffix: "", withVoiceover: true },
            { suffix: "-MusicOnly", withVoiceover: false },
          ] as const
        ).map((v) => (
          <Composition
            key={f.id + v.suffix}
            id={`Ad-${f.id}${v.suffix}`}
            component={Ad}
            durationInFrames={AD_DURATION}
            fps={30}
            width={f.width}
            height={f.height}
            defaultProps={{ withVoiceover: v.withVoiceover }}
          />
        )),
      )}

      {/* The earlier 10s stores promo, kept alongside. */}
      <Composition
        id="StoresPromo"
        component={StoresPromo}
        durationInFrames={300}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
