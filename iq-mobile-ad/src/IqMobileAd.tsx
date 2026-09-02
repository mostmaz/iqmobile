import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { fade } from "@remotion/transitions/fade";
import { Audio } from "@remotion/media";
import { colors } from "./theme";
import { Scene1Problem } from "./scenes/Scene1Problem";
import { Scene2Advice } from "./scenes/Scene2Advice";
import { Scene3Listing } from "./scenes/Scene3Listing";
import { Scene4Differentiator } from "./scenes/Scene4Differentiator";
import { Scene5Contact } from "./scenes/Scene5Contact";
import { Scene6Outro } from "./scenes/Scene6Outro";

// 30 seconds at 30fps = 900 frames.
//
// TransitionSeries subtracts each transition's duration from the total, so
// the scene durations below are the on-screen beat PLUS the 15-frame
// overlap they hand to the next scene. Five transitions × 15 = 75, so the
// durations sum to 975 and the composition lands on exactly 900.
export const TRANSITION = 15;
export const AD_DURATION = 900;

const BEATS = {
  problem: 150,
  advice: 120,
  listing: 150,
  differentiator: 210, // longest — the reason the app exists
  contact: 150,
  outro: 120,
} as const;

export type IqMobileAdProps = {
  /** Voiceover is recorded separately; mount stays muted until it lands. */
  muted: boolean;
};

export const IqMobileAd: React.FC<IqMobileAdProps> = ({ muted }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={BEATS.problem + TRANSITION}>
          <Scene1Problem exitAt={BEATS.problem - 10} />
        </TransitionSeries.Sequence>
        {/* Slide left: content exits toward the left, the RTL reading exit */}
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: TRANSITION })}
        />

        <TransitionSeries.Sequence durationInFrames={BEATS.advice + TRANSITION}>
          <Scene2Advice exitAt={BEATS.advice - 10} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: TRANSITION })}
        />

        <TransitionSeries.Sequence durationInFrames={BEATS.listing + TRANSITION}>
          <Scene3Listing exitAt={BEATS.listing - 10} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: TRANSITION })}
        />

        <TransitionSeries.Sequence durationInFrames={BEATS.differentiator + TRANSITION}>
          {/* Holds its final state for the last 45 frames — no early cut */}
          <Scene4Differentiator exitAt={BEATS.differentiator - 10} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: TRANSITION })}
        />

        <TransitionSeries.Sequence durationInFrames={BEATS.contact + TRANSITION}>
          <Scene5Contact exitAt={BEATS.contact - 10} />
        </TransitionSeries.Sequence>
        {/* The outro arrives on a fade — a slide would fight the logo pop */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION })}
        />

        <TransitionSeries.Sequence durationInFrames={BEATS.outro}>
          <Scene6Outro />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* Voiceover mount point. The ad is built silent on purpose: Arabic TTS
          drifts to Fusha, so the track is recorded by a real Iraqi speaker and
          dropped in at public/audio/vo.mp3. Nothing else needs restructuring —
          flip `muted` to false once the file exists. */}
      <Sequence from={0} durationInFrames={AD_DURATION} name="VO (mount)">
        <VoiceoverMount muted={muted} />
      </Sequence>
    </AbsoluteFill>
  );
};

const VoiceoverMount: React.FC<{ muted: boolean }> = ({ muted }) => {
  const [exists, setExists] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    fetch(staticFile("audio/vo.mp3"), { method: "HEAD" })
      .then((r) => alive && setExists(r.ok))
      .catch(() => alive && setExists(false));
    return () => {
      alive = false;
    };
  }, []);
  if (!exists) return null;
  return <Audio src={staticFile("audio/vo.mp3")} volume={muted ? 0 : 1} />;
};
