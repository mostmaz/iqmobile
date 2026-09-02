import React from "react";
import { colors } from "../theme";

// Phone body with an ink bezel and a surface screen. Children render INSIDE
// the screen — this is where the app UI is rebuilt in vector.
export const PhoneFrame: React.FC<{
  children?: React.ReactNode;
  /** Screen width in px; the body scales around it. */
  width: number;
  tilt?: number;
  scale?: number;
}> = ({ children, width, tilt = 0, scale = 1 }) => {
  const height = width * 2.02;
  const bezel = width * 0.03;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: width * 0.12,
        backgroundColor: colors.ink,
        padding: bezel,
        boxShadow: `0 ${width * 0.08}px ${width * 0.18}px rgba(27,26,24,0.26)`,
        rotate: `${tilt}deg`,
        scale,
      }}
    >
      <div
        dir="rtl"
        style={{
          width: "100%",
          height: "100%",
          borderRadius: width * 0.095,
          backgroundColor: colors.surface,
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
};
