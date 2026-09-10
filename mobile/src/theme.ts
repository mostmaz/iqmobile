// Cream + terracotta design system, restyled to a light surface.
//
// The brief for the restyle was "modernise, keep the terracotta exactly as
// it is". So the accent family, the success/danger families and every ink
// value below are UNCHANGED, and only the four surfaces lighten: the page
// goes near-white, cards go pure white, and the chip fill lightens with
// them. That is the whole colour change — anything that looks different and
// is not one of those four is a bug, not a redesign.
export const theme = {
  bg: '#FAF8F5',
  surface: '#FFFFFF',
  /**
   * The tone for something nested INSIDE a white card — an input, a chip on
   * a card, a stepper track.
   *
   * It exists because `chipBg` no longer works there. On the old cream
   * surface a chip could share one fill with the page furniture; on white,
   * `chipBg` is dark enough that a nested chip reads as a second card edge.
   * `bg` is the other tempting reuse and is wrong for the opposite reason —
   * it is the page, so a chip painted with it looks like a hole.
   */
  inset: '#F7F4EF',
  ink: '#1B1A18',
  // Secondary text. Kept at the value the old cream palette forced: it was
  // darkened until it cleared WCAG AA on the DARKEST surface it appears on,
  // which was the old `chipBg` at 5.29:1. Every surface it sits on is now
  // lighter, so it clears AA everywhere by a wider margin than before —
  // lightening it back would undo that for no gain.
  subtle: '#5A564F',
  // A hair stronger than the 0.08 the cream palette used. The same alpha
  // over a lighter background is a fainter line, and dividers inside a white
  // card were disappearing.
  line: 'rgba(27,26,24,0.09)',
  accent: '#D9583A',
  accentSoft: 'rgba(217,88,58,0.14)',
  accentDeep: '#B23F25',
  // A dashed accent outline at full strength shouts; at half it reads as an
  // invitation. Used by the «ما لقيت جهازك؟» card, which sits INSIDE a list
  // of real listings and must not out-rank them.
  accentBorder: 'rgba(217,88,58,0.5)',
  accentInk: '#FFFFFF',
  chipBg: '#F2EEE8',
  chipInk: '#3A352D',
  button: '#1B1A18',
  buttonInk: '#FFFFFF',
  success: '#1F6B5C',
  successSoft: 'rgba(31,107,92,0.14)',
  // Error text sits on an 8%-tint banner of itself, which lightens the
  // background toward the red and pulled the pair down to 4.22:1.
  danger: '#9C3126',
  dangerSoft: 'rgba(180,58,46,0.25)',
  dangerInk: '#FFB8AC',
} as const;

export const fonts = {
  ar: 'IBMPlexSansArabic_500Medium',
  arBold: 'IBMPlexSansArabic_700Bold',
  arRegular: 'IBMPlexSansArabic_400Regular',
  ltr: 'Inter_500Medium',
  ltrBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
} as const;

// The whole scale grows by 2 and gains a step at the top. Names are kept so
// that no call site has to move: what was `radius.xxl` on a card is still
// `radius.xxl`, it is simply rounder.
//
// `xxxl` is new and is for the largest cards only — the profile header, the
// request card. Bottom sheets round harder still (26) and set that inline;
// it is one number in two files and does not earn a token.
export const radius = { sm: 10, md: 12, lg: 14, xl: 16, xxl: 18, xxxl: 20, pill: 999 } as const;

// How far OS font scaling may enlarge text inside a fixed-size control.
//
// Font scaling is on by default and nothing in the app clamped it. On a
// device set to 1.3× — common on Arabic HONOR and Xiaomi handsets — chips,
// buttons and tab labels overflow the rounded shapes they sit in and get
// clipped mid-glyph, which is what "the first character of the string is
// cut" turns out to be. Verified on the emulator at font_scale 1.3.
//
// Two limits rather than one: a control whose height is fixed (a pill, a
// tab label, a badge) can only give away a little, while body copy and
// headings reflow freely and should keep scaling for the people who need
// it. Only the first is clamped hard.
export const FONT_SCALE_TIGHT = 1.15;   // pills, buttons, tabs, badges
export const FONT_SCALE_RELAXED = 1.4;  // titles and single-line labels

// A cream-tinted 24pt blur at 6% was a soft haze under a cream card. Under
// a WHITE card on a near-white page the same shadow has nothing to sit
// against and reads as dirt around the edges. Tight and faint instead: the
// card is separated by being whiter than the page, and the shadow only has
// to stop it floating.
export const shadowSoft = {
  shadowColor: '#261C0E',
  shadowOpacity: 0.05,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
};

// The accent glow survives, tightened, and is now for two things only: the
// iQ logo tile and a primary accent CTA. Spreading it over every accent
// surface is what made the old UI look lit from underneath.
export const shadowAccent = {
  shadowColor: '#D9583A',
  shadowOpacity: 0.28,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 8 },
  elevation: 4,
};

export const shadowHero = shadowAccent;

/**
 * For a bar pinned to the bottom of the screen, where the content scrolls
 * UNDER it — the filter sheet's apply bar, the listing detail's contact bar.
 * Shadows that fall downward are invisible there; this one falls up.
 */
export const shadowUp = {
  shadowColor: '#261C0E',
  shadowOpacity: 0.06,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: -6 },
  elevation: 8,
};
