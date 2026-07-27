// Quality gate for user-posted listings. The marketplace wants a clean
// catalogue, so a listing whose model/description advertises a broken,
// non-working, locked, or stolen device is rejected at creation.
//
// Two match tiers, tuned to reject the obvious while sparing honest
// sellers who mention these words in the negative:
//
//   PHRASES — multi-word negatives that ARE the violation ("لا يعمل" =
//     doesn't work). Always block; a negation guard makes no sense here.
//
//   WORDS — single terms that can legitimately appear in a positive claim
//     ("بدون مشكلة" = no problem, "مو مقفول" = not locked, "بلا خدوش").
//     We only flag these when they are NOT preceded by a negation word
//     within a short window, so a good listing isn't punished for saying
//     what's *not* wrong with the phone.
//
// Deliberately conservative and short: better to let a borderline listing
// through than to block an honest seller. Enforced only on the mobile
// create path — admin quick-add curates and is exempt.

const PHRASES = [
  'لا يعمل', 'لايعمل', 'ما يعمل', 'مايعمل', 'مايشتغل', 'ما يشتغل',
  'ماتشتغل', 'ما تشتغل', 'مو شغال', 'مب شغال', 'مو شغّال',
  'for parts', 'not working', 'doesnt work', "doesn't work",
];

const WORDS = [
  'مكسور', 'مكسورة', 'مكسوره', 'عاطل', 'عاطلة', 'عاطله', 'معطل', 'معطّل',
  'خربان', 'خربانة', 'خربانه', 'تشليح', 'شليح', 'مسروق', 'مسروقة', 'مسروقه',
  'مقفول', 'مقفل', 'مغلق', 'مشكلة', 'مشكله',
  'broken', 'cracked', 'stolen', 'faulty', 'damaged',
];

// Negations that, when they appear just before a WORD, flip it to a
// positive claim and clear the flag. Trailing space keeps short particles
// like "مو"/"مب"/"no" from matching inside unrelated words.
const NEGATIONS = ['بدون', 'بلا', 'مو ', 'مب ', 'غير ', 'ماكو', 'مافي', 'no ', 'not '];

// Returns the offending term (string) if the text should be rejected, or
// null if it passes. Accepts any number of text parts (model, description).
export function checkListingQuality(...parts) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text.trim()) return null;

  for (const p of PHRASES) {
    if (text.includes(p)) return p;
  }

  for (const w of WORDS) {
    let idx = text.indexOf(w);
    while (idx !== -1) {
      const before = text.slice(Math.max(0, idx - 14), idx);
      const negated = NEGATIONS.some((n) => before.includes(n));
      if (!negated) return w;
      idx = text.indexOf(w, idx + w.length);
    }
  }

  return null;
}
