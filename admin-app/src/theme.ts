// Deliberately NOT the marketplace's cream-and-terracotta palette.
//
// This app and the buyer app will sit next to each other on the same phone,
// and an operator glancing at a notification needs to know instantly which
// one they are about to open. So: dark, dense, and neutral — a tool, not a
// storefront. The accent is shared with the marketplace only where it means
// "needs you", which is the one thing both products agree on.

export const theme = {
  bg: '#131316',
  surface: '#1C1C21',
  surfaceAlt: '#25252C',
  ink: '#F2F2F4',
  subtle: '#9B9BA6',
  faint: '#6C6C78',
  line: 'rgba(255,255,255,0.09)',

  accent: '#E4643F',
  accentSoft: 'rgba(228,100,63,0.16)',

  // Queue severity. Orders are the only thing that wakes someone at speed,
  // so they get the loudest colour; everything else is "when you sit down".
  urgent: '#E4643F',
  warn: '#D9A441',
  ok: '#4BAE8C',
  danger: '#E5544B',
  info: '#5B93C7',
} as const;

export const fonts = {
  ar: 'System',
  arBold: 'System',
  mono: 'monospace',
} as const;

export const radius = { sm: 8, md: 10, lg: 14, xl: 18, pill: 999 } as const;

/** Arabic-friendly thousands, always Western digits. */
export function iqd(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('en-US');
}
