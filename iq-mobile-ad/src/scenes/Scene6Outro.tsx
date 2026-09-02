import React from "react";
import { AbsoluteFill } from "remotion";
import { colors } from "../theme";
import { LogoOutro } from "../components/LogoOutro";

// SCENE 6 — OUTRO (0:26–0:30)
// Solid background, logo, store badges, and the required price disclaimer.
export const Scene6Outro: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: colors.bg }}>
    <LogoOutro from={4} />
  </AbsoluteFill>
);
