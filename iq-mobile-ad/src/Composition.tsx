import { Composition } from "remotion";
import { IqMobileAd, AD_DURATION } from "./IqMobileAd";

// Square master plus vertical and wide. All three share the same scene
// components; each scene reads useLayout() and lays itself out to that
// format's safe zones, so there is one edit to maintain, not three.
export const MyComposition = () => {
  return (
    <>
      <Composition
        id="IqMobileAd"
        component={IqMobileAd}
        durationInFrames={AD_DURATION}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{ muted: true }}
      />
      <Composition
        id="IqMobileAd-Vertical"
        component={IqMobileAd}
        durationInFrames={AD_DURATION}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ muted: true }}
      />
      <Composition
        id="IqMobileAd-Wide"
        component={IqMobileAd}
        durationInFrames={AD_DURATION}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ muted: true }}
      />
    </>
  );
};
