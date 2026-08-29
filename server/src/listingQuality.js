// Quality gate for user-posted listings. Two different answers, because
// two different things are wrong with a listing:
//
//   BLOCK  — the device is not sellable here at all: it doesn't work, it's
//            stolen, it's locked to someone else's account. Refused at
//            creation; there is nothing for an operator to weigh up.
//
//   REVIEW — the device is damaged but real, and the seller said so. A
//            cracked screen honestly disclosed and priced at a third of
//            the market is a legitimate listing, and refusing it outright
//            drove those sellers off the app. These go live and land in
//            the inspection queue for a human.
//
// The split matters in the data: a scan of production found cracked-screen
// listings priced accordingly and disclosed in the first line — exactly the
// honest behaviour the marketplace wants — sitting alongside iCloud-locked
// phones that should never have been posted. One verdict cannot serve both.
//
// Within each tier there are two match kinds:
//
//   PHRASES — multi-word negatives that ARE the violation ("لا يعمل" =
//     doesn't work). A negation guard makes no sense here.
//
//   WORDS — single terms that can legitimately appear in a positive claim
//     ("بدون مشكلة" = no problem, "مو مقفول" = not locked, "بلا خدوش").
//     Flagged only when NOT preceded by a negation, so an honest listing
//     isn't punished for saying what's *not* wrong with the phone. This is
//     load-bearing: Iraqi sellers overwhelmingly write what is fine
//     ("ما مبدل شي"، "خدش مابي")، and a naive matcher reads every one of
//     those as a defect.
//
// Deliberately conservative: better to let a borderline listing through
// than to block an honest seller.

const PHRASES = [
  'لا يعمل', 'لايعمل', 'ما يعمل', 'مايعمل', 'مايشتغل', 'ما يشتغل',
  'ماتشتغل', 'ما تشتغل', 'مو شغال', 'مب شغال', 'مو شغّال',
  'for parts', 'not working', 'doesnt work', "doesn't work",
];

const WORDS = [
  'عاطل', 'عاطلة', 'عاطله', 'معطل', 'معطّل',
  'خربان', 'خربانة', 'خربانه', 'تشليح', 'شليح', 'مسروق', 'مسروقة', 'مسروقه',
  'مقفول', 'مقفل', 'مغلق', 'مشكلة', 'مشكله',
  // Swapped/replaced parts — a "مبدل" screen or board is a repaired device,
  // not the clean stock the catalogue advertises. The negation guard still
  // clears the honest "غير مبدل" / "مو مبدل".
  'مبدل', 'مبدلة', 'مبدله',
  'broken', 'stolen', 'faulty', 'damaged',
];

// ─── review tier ─────────────────────────────────────────────────────
// Damage a seller disclosed. The listing goes live and a human decides.
//
// Every entry here was chosen from real production text. The nouns matter
// as much as the adjectives: the gate already knew "مكسور" but not "كسر",
// and "بي كسر بالشاشة" — the commonest way an Iraqi seller says it — sailed
// straight through. "قفل" is deliberately ABSENT even though it means
// locked, because "سعره قفل" is how half the market says the price is firm.
const REVIEW_PHRASES = [
  'قفل ايكلود', 'قفل الايكلود', 'مقفول ايكلود',
  'cracked screen', 'icloud locked',
];

const REVIEW_WORDS = [
  // cracks — noun forms first, they are what sellers actually write
  'كسر', 'كسور', 'مكسور', 'مكسورة', 'مكسوره', 'منكسر', 'انكسر',
  'شرخ', 'مشروخ', 'شروخ',
  'نشلعت', 'منشلعه', 'منشلع',
  // battery swelling — a safety matter, not cosmetics
  'منفوخ', 'منفوخة', 'منفوخه', 'منتفخ', 'منتفخة', 'منتفخه',
  // an iCloud mention is not proof of a lock ("حساب ايكلود نظيف" is a
  // selling point), so it earns a human glance rather than a refusal
  'ايكلود', 'ايكلاود', 'icloud',
  'cracked',
];

// Which queue label a matched term gets, so the operator sees the reason
// rather than the raw word. Keys match DEFECT_AR in the dashboard.
const KIND_OF = new Map([
  ...['كسر', 'كسور', 'مكسور', 'مكسورة', 'مكسوره', 'منكسر', 'انكسر', 'شرخ', 'مشروخ',
      'شروخ', 'نشلعت', 'منشلعه', 'منشلع', 'cracked', 'cracked screen']
    .map((w) => [w, 'cracked_screen']),
  ...['منفوخ', 'منفوخة', 'منفوخه', 'منتفخ', 'منتفخة', 'منتفخه']
    .map((w) => [w, 'battery_fault']),
  ...['ايكلود', 'ايكلاود', 'icloud', 'قفل ايكلود', 'قفل الايكلود', 'مقفول ايكلود', 'icloud locked']
    .map((w) => [w, 'locked_account']),
]);

// Negations that, when they appear just before a WORD, flip it to a
// positive claim and clear the flag. Trailing space keeps short particles
// like "مو"/"مب"/"no" from matching inside unrelated words.
const NEGATIONS = [
  'بدون', 'بلا', 'مو ', 'مب ', 'غير ', 'ماكو', 'مافي', 'no ', 'not ',
  // "لا يوجد كسر" is a seller saying the phone is INTACT. Without these the
  // matcher read that as a crack — the single most common way an honest
  // listing was misread in testing.
  'لا ', 'ولا ', 'ليس', 'مابي', 'مافيه', 'لايوجد',
];

// Returns the offending term (string) if the text should be rejected, or
// null if it passes. Accepts any number of text parts (model, description).
export function checkListingQuality(...parts) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text.trim()) return null;

  for (const p of PHRASES) {
    if (text.includes(p)) return p;
  }

  const w = firstUnnegated(text, WORDS);
  if (w) return w;

  // "مطلوب" (wanted) flags a buyer's request post, which doesn't belong in a
  // for-SALE catalogue. But "المطلوب" (with the ال article) is how sellers
  // commonly write "the asking price", so allow that form — only the bare
  // "wanted" usage is rejected.
  let mi = text.indexOf('مطلوب');
  while (mi !== -1) {
    const two = text.slice(Math.max(0, mi - 2), mi);
    if (!two.endsWith('ال')) return 'مطلوب';
    mi = text.indexOf('مطلوب', mi + 'مطلوب'.length);
  }

  return null;
}

/**
 * First term in `words` that appears un-negated, or null.
 *
 * The window is 14 characters rather than a token count because Arabic
 * negation particles attach to what follows ("مامبدل"، "مابيه") as often as
 * they stand alone, and a character window catches both without a tokenizer.
 */
function firstUnnegated(text, words) {
  for (const w of words) {
    let idx = text.indexOf(w);
    while (idx !== -1) {
      const before = text.slice(Math.max(0, idx - 14), idx);
      if (!NEGATIONS.some((n) => before.includes(n))) return w;
      idx = text.indexOf(w, idx + w.length);
    }
  }
  return null;
}

/**
 * Damage the seller disclosed: the listing may go live, but a human should
 * see it. Returns `{ term, kind }` or null.
 *
 * Only consulted when checkListingQuality() has already passed — a listing
 * that is blocked outright never reaches the queue, because there is no
 * decision left to make about it.
 */
export function reviewListingQuality(...parts) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text.trim()) return null;

  // Every distinct fault, not just the first. A phone with a cracked back
  // AND a swollen battery is two different questions for the operator, and
  // reporting only the crack buried the safety one — which is exactly what
  // happened on the listing that prompted this.
  const byKind = new Map();
  const add = (term) => {
    const kind = KIND_OF.get(term) || 'screen_defect';
    if (!byKind.has(kind)) byKind.set(kind, term);
  };

  for (const p of REVIEW_PHRASES) if (text.includes(p)) add(p);
  for (const w of REVIEW_WORDS) if (firstUnnegated(text, [w])) add(w);

  if (!byKind.size) return null;
  const defects = [...byKind].map(([kind, term]) => ({ kind, term }));
  // First entry stays the headline, so existing single-value callers read
  // the same shape they always did.
  return { ...defects[0], defects };
}
