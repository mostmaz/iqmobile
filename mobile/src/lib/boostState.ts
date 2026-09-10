// What the boost UI should say, given what the server said and what time it is.
//
// Pure, and separate from the screens for one reason: every interesting case
// here is a boundary — the moment a cooldown ends, the moment the second
// boost is spent, the moment a highlight expires — and a boundary you can
// only reach by waiting is a boundary nobody tests.
//
// The server owns every timestamp. Nothing here derives a deadline from the
// device clock; it only measures the distance to one the server sent. A phone
// an hour fast shows a countdown an hour short, which is survivable. A phone
// that decided for itself when the cooldown ended would not be.

// Deliberately dependency-free, like every other module under lib/ that has
// tests: `node --test` strips types but does not resolve extensionless
// relative imports, so a single runtime import here would cost this module
// its coverage. `ltrNum` is four lines, and format.ts owns the canonical
// copy — see the comment there for why iOS needs it at all.
const LRM = String.fromCharCode(0x200e);
const ltrNum = (n: number | string): string => LRM + String(n) + LRM;

export interface BoostServerState {
  enabled: boolean;
  max_per_24h: number;
  used: number;
  remaining: number;
  allowed: boolean;
  reason: 'disabled' | 'daily_limit' | 'cooldown' | null;
  next_available_at: number | null;
  streak: number;
  streak_used_today: boolean;
  day_ends_at: number;
  eligible?: boolean;
  ineligible_reason?: string | null;
  listing?: {
    is_boosted: boolean;
    boost_highlight_until: number | null;
    scheduled_bump_at: number | null;
  } | null;
}

export type BoostUiState =
  | { kind: 'hidden' }
  | { kind: 'ineligible'; reason: string }
  | { kind: 'available'; remaining: number }
  | { kind: 'cooldown'; remaining: number; msLeft: number }
  | { kind: 'exhausted'; msLeft: number };

/**
 * `hidden` means render nothing at all — the operator has not switched the
 * feature on, or this build is talking to a server that predates it. It is
 * deliberately distinct from `ineligible`, which is a listing that could be
 * boosted if it were not sold, and which the seller deserves to be told about.
 */
export function boostUiState(s: BoostServerState | null | undefined, now: number): BoostUiState {
  if (!s || !s.enabled) return { kind: 'hidden' };
  if (s.eligible === false) return { kind: 'ineligible', reason: s.ineligible_reason || 'listing_not_active' };

  const msLeft = s.next_available_at ? Math.max(0, s.next_available_at - now) : 0;

  // A countdown that has run out is not a countdown. The server is the
  // authority, but between polls the clock is all the screen has, and
  // freezing on «بعد ٠د ٠ث» looks broken.
  if (s.allowed || msLeft === 0) {
    if (s.remaining > 0) return { kind: 'available', remaining: s.remaining };
  }
  if (s.remaining > 0) return { kind: 'cooldown', remaining: s.remaining, msLeft };
  return { kind: 'exhausted', msLeft };
}

/**
 * "٧ ساعات ١٢ دقيقة" — the long form, for a sentence.
 *
 * `formatCountdown` in format.ts gives the terse «٣س ٢٧د»; this one is for
 * the places the design writes it out. Both wrap digits in LRM so iOS does
 * not render them as Arabic-Indic glyphs against the neighbouring letters.
 */
export function longCountdownAr(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0 && m > 0) return `${ltrNum(h)} ساعة و${ltrNum(m)} دقيقة`;
  if (h > 0) return `${ltrNum(h)} ساعة`;
  if (m > 0) return `${ltrNum(m)} دقيقة`;
  return 'أقل من دقيقة';
}

/** "07:12:44" for the big clock on the spent screen. */
export function clockCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * The pill beside the boost title: «٢ متبقية اليوم», or the wait.
 *
 * Arabic-Indic digits here on purpose — this is a count inside Arabic copy,
 * where the design uses ٢/١, unlike the monospace clock above which stays
 * Latin because it is a ticking readout.
 */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function arDigits(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

export function boostPillLabel(state: BoostUiState): string {
  switch (state.kind) {
    case 'available': return `${arDigits(state.remaining)} متبقية اليوم`;
    case 'cooldown': return `ترجع بعد ${longCountdownAr(state.msLeft)}`;
    case 'exhausted': return `ترجع بعد ${longCountdownAr(state.msLeft)}`;
    default: return '';
  }
}

/** How many slot tiles to draw, and which are spent. */
export function boostSlots(s: BoostServerState | null | undefined): boolean[] {
  const max = Math.max(1, Number(s?.max_per_24h) || 2);
  const used = Math.min(max, Math.max(0, Number(s?.used) || 0));
  return Array.from({ length: max }, (_, i) => i < used);
}
