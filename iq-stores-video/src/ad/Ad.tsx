import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { C } from "./kit";
import { SceneProblem } from "./scenes/Problem";
import { SceneApp } from "./scenes/TheApp";
import { ScenePrice } from "./scenes/PriceCompare";
import { SceneContact } from "./scenes/Contact";
import { SceneClose } from "./scenes/Close";

// 15 seconds exactly at 30fps = 450 frames.
// Beat map (frames): the hero price shot gets the longest hold, per brief.
export const BEATS = {
  problem: { from: 0, dur: 60 }, //  0:00–0:02
  app: { from: 60, dur: 90 }, //     0:02–0:05
  price: { from: 150, dur: 120 }, // 0:05–0:09  ← hero
  contact: { from: 270, dur: 90 }, //0:09–0:12
  close: { from: 360, dur: 90 }, //  0:12–0:15
} as const;

export const AD_DURATION = 450;

export type AdProps = {
  /** Music-only vs. with-voiceover renders come from this one switch. */
  withVoiceover: boolean;
};

export const Ad: React.FC<AdProps> = ({ withVoiceover }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <Sequence
        from={BEATS.problem.from}
        durationInFrames={BEATS.problem.dur}
        name="0:00 المشكلة"
      >
        <SceneProblem durationInFrames={BEATS.problem.dur} />
      </Sequence>

      <Sequence from={BEATS.app.from} durationInFrames={BEATS.app.dur} name="0:02 التطبيق">
        <SceneApp />
      </Sequence>

      <Sequence from={BEATS.price.from} durationInFrames={BEATS.price.dur} name="0:05 السعر ★">
        <ScenePrice />
      </Sequence>

      <Sequence from={BEATS.contact.from} durationInFrames={BEATS.contact.dur} name="0:09 التواصل">
        <SceneContact />
      </Sequence>

      <Sequence from={BEATS.close.from} durationInFrames={BEATS.close.dur} name="0:12 الختام">
        <SceneClose />
      </Sequence>

      <AdAudio withVoiceover={withVoiceover} />
    </AbsoluteFill>
  );
};

// ── Audio ────────────────────────────────────────────────────────────
// Both tracks are optional files in public/audio/. They are absent from the
// repo on purpose: the music must be a licensed track, and the voiceover
// must be recorded by an Iraqi speaker (Arabic TTS drifts to Fusha and kills
// the ad — the brief is right about that). Drop the files in and re-render;
// nothing else changes.
//
//   public/audio/music.mp3  — bed, both versions
//   public/audio/vo.mp3     — Iraqi male VO, "with voiceover" version only
//
// The VO line timings the edit is cut to:
//   0:00.3  «تدوّر على موبايل مستعمل؟»
//   0:02.2  «افتح IQ Mobile — أجهزة من كل المحافظات.»
//   0:05.2  «تشوف سعر المستعمل، وسعر الجديد جنبه.»
//   0:09.2  «وتتواصل مع البائع مباشرة، بدون تسجيل.»
//   0:12.3  «IQ Mobile. نزّله مجاناً.»
const AdAudio: React.FC<{ withVoiceover: boolean }> = ({ withVoiceover }) => {
  const [tracks, setTracks] = React.useState<{ music: boolean; vo: boolean }>({
    music: false,
    vo: false,
  });

  // Probe rather than assume: a missing file must not fail the render.
  React.useEffect(() => {
    let alive = true;
    const check = async (name: string) => {
      try {
        const res = await fetch(staticFile(`audio/${name}`), { method: "HEAD" });
        return res.ok;
      } catch {
        return false;
      }
    };
    Promise.all([check("music.mp3"), check("vo.mp3")]).then(([music, vo]) => {
      if (alive) setTracks({ music, vo });
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      {tracks.music ? (
        <Audio
          src={staticFile("audio/music.mp3")}
          // Duck the bed under the voiceover so the Iraqi read stays on top.
          volume={withVoiceover ? 0.28 : 0.85}
        />
      ) : null}
      {withVoiceover && tracks.vo ? (
        <Audio src={staticFile("audio/vo.mp3")} volume={1} />
      ) : null}
    </>
  );
};
