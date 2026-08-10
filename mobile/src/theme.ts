// Cream + terracotta design system from /Buyer Screens.html
export const theme = {
  bg: '#ECE6DA',
  surface: '#F5F0E6',
  ink: '#1B1A18',
  subtle: '#6E6A62',
  line: 'rgba(27,26,24,0.08)',
  accent: '#D9583A',
  accentSoft: 'rgba(217,88,58,0.14)',
  accentDeep: '#B23F25',
  accentInk: '#FFFFFF',
  chipBg: '#E2DBCB',
  chipInk: '#3A352D',
  button: '#1B1A18',
  buttonInk: '#F5F0E6',
  success: '#1F6B5C',
  successSoft: 'rgba(31,107,92,0.14)',
  danger: '#B43A2E',
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

export const radius = { sm: 8, md: 10, lg: 12, xl: 14, xxl: 16, pill: 999 } as const;

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

export const shadowSoft = {
  shadowColor: '#261C0E',
  shadowOpacity: 0.06,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 8 },
  elevation: 2,
};

export const shadowAccent = {
  shadowColor: '#D9583A',
  shadowOpacity: 0.16,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 12 },
  elevation: 4,
};

export const shadowHero = {
  shadowColor: '#D9583A',
  shadowOpacity: 0.28,
  shadowRadius: 30,
  shadowOffset: { width: 0, height: 14 },
  elevation: 6,
};
