// Design tokens. Single source for colour, type, spacing and radius — every
// component reads from here so a brand tweak never means hunting hex codes.

export const colors = {
  accent: "#D9583A",
  deep: "#B23F25",
  bg: "#ECE6DA",
  surface: "#F5F0E6",
  ink: "#1B1A18",
  subtle: "#6E6A62",
  chip: "#E2DBCB",
  green: "#1F6B5C",
  red: "#B43A2E",
  white: "#FFFFFF",
} as const;

// Type scale, authored at 1080 width. Components multiply by the layout's
// `u` so the same numbers hold in every format. The floor is 32 — nothing
// in this ad is allowed to render smaller.
export const type = {
  display: { size: 96, weight: 900 },
  title: { size: 64, weight: 700 },
  body: { size: 40, weight: 400 },
  caption: { size: 32, weight: 400 },
} as const;

export const MIN_FONT_SIZE = 32;

export const space = { xs: 8, sm: 16, md: 24, lg: 40, xl: 64, xxl: 96 } as const;

export const radius = { card: 24, pill: 999 } as const;

// Spring presets. Entrances never use linear easing:
//   settle → heavy, no overshoot, for anything large arriving
//   pop    → light, deliberate overshoot, for badges/pills/checkmarks
export const SPRING = {
  settle: { damping: 200, stiffness: 100 },
  pop: { damping: 12 },
} as const;
