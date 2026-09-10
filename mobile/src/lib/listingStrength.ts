// «قوة الإعلان» — the one number a seller sees on every step of the wizard.
//
// The quality checks already existed; what they lacked was a place. They
// rendered in a card BELOW the step's content, which on a phone means below
// the fold, so the seller reached the publish button having never seen them.
// This turns the same issue list into a score that sits beside the step dots
// and is therefore unavoidable.
//
// Pure, and the interesting part is the scale rather than the arithmetic: a
// seller who has filled in nothing must not be shown 0%, and a seller with
// one cosmetic note left must not be shown 100%.

/**
 * Structurally what `listingQuality` already returns, with `advice` named
 * `hint` and optional — this module must accept that type unchanged rather
 * than force every call site to map it, because a mapping step is where the
 * two lists drift apart.
 */
export interface StrengthNote {
  id: string;
  step: number;
  title: string;
  hint?: string;
  advice?: string;
}

export interface ListingStrength {
  /** 0-100, but never below FLOOR — see below. */
  score: number;
  notes: StrengthNote[];
  /** 'weak' | 'ok' | 'strong' — drives the colour, not the wording. */
  band: 'weak' | 'ok' | 'strong';
}

/**
 * The bar never starts empty.
 *
 * A seller on step 1 has, by definition, already chosen a brand and a model,
 * and showing them 0% for that is both false and discouraging at the exact
 * moment they are deciding whether this form is worth finishing. 20 is the
 * floor: visibly a beginning, not a failure.
 */
const FLOOR = 20;

/**
 * How many checks the wizard can raise in total.
 *
 * Derived from the issues themselves rather than hardcoded: `listingQuality`
 * gains and loses rules, and a denominator that did not move with it would
 * quietly re-scale every seller's score without anyone editing this file.
 */
export function listingStrength(issues: StrengthNote[], totalChecks: number): ListingStrength {
  const total = Math.max(1, totalChecks);
  const open = Math.min(total, issues.length);
  const raw = Math.round(((total - open) / total) * 100);
  // A listing with anything still open is never 100%. Rounding could
  // otherwise show 100% with one note left on a long checklist, which reads
  // as the app contradicting itself two lines further down.
  const score = open === 0 ? 100 : Math.max(FLOOR, Math.min(99, raw));
  return {
    score,
    notes: issues,
    band: open === 0 ? 'strong' : score >= 70 ? 'ok' : 'weak',
  };
}

/**
 * The one-line summary on the collapsed rail.
 *
 * Counts, not adjectives: «٣ ملاحظات» tells a seller how much work is left,
 * where "your listing is weak" only tells them how to feel about it.
 */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ar = (n: number) => String(Math.max(0, Math.floor(n))).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

export function strengthChipLabel(open: number): string {
  if (open === 0) return 'مكتمل';
  if (open === 1) return 'ملاحظة واحدة';
  if (open === 2) return 'ملاحظتان';
  return `${ar(open)} ملاحظات`;
}
