// What the seller says about the device's condition, in fixed answers.
//
// The concepts already existed twice over and agreed with each other nowhere:
// `listingQuality.ts` nags for screen / body / repairs as REGEX OVER PROSE,
// and `listingInspect.js` has a defect vocabulary the model uses to describe
// what it sees in the photos. A seller wrote a paragraph, we grepped it, and
// the AI's verdict and the seller's own words could never be compared because
// one was an enum and the other was Arabic.
//
// So the answers below are drawn from `defects_json[].kind` deliberately:
// every choice a seller can make maps to the same vocabulary the inspector
// speaks, which is what makes "the seller declared a cracked screen" and "the
// photos show a cracked screen" the same sentence.
//
// One JSON column, not five columns. `accessories_json` is the precedent and
// the set will grow — a migration per question is not a plan.
//
// `unknown` is a first-class answer, distinct from unanswered. A seller who
// bought the phone second-hand genuinely does not know whether the screen was
// replaced, and forcing them to guess produces a listing that is confidently
// wrong. Saying so is the honest option and must stay cheap to pick.

/**
 * Fields, their allowed values, and the inspector defect each value declares.
 * `null` means "this answer declares no defect".
 */
export const CONDITION_FIELDS = [
  {
    id: 'screen',
    options: [
      { value: 'clean', defect: null },
      { value: 'scratches', defect: 'deep_scratches' },
      { value: 'cracked', defect: 'cracked_screen' },
      { value: 'display_fault', defect: 'screen_defect' },
      { value: 'replaced', defect: 'repaired_before' },
      { value: 'unknown', defect: null },
    ],
  },
  {
    id: 'body',
    options: [
      { value: 'clean', defect: null },
      { value: 'scratches', defect: 'deep_scratches' },
      { value: 'dents', defect: 'dent_or_bend' },
      { value: 'cracked_back', defect: 'cracked_back' },
      { value: 'unknown', defect: null },
    ],
  },
  {
    id: 'repairs',
    options: [
      { value: 'none', defect: null },
      { value: 'screen_replaced', defect: 'repaired_before' },
      { value: 'battery_replaced', defect: 'repaired_before' },
      { value: 'other_repair', defect: 'repaired_before' },
      { value: 'unknown', defect: null },
    ],
  },
  {
    id: 'water',
    options: [
      { value: 'no', defect: null },
      { value: 'yes', defect: 'water_damage' },
      { value: 'unknown', defect: null },
    ],
  },
];

const BY_ID = new Map(CONDITION_FIELDS.map((f) => [f.id, f]));

export const CONDITION_FIELD_IDS = CONDITION_FIELDS.map((f) => f.id);

/**
 * Parse and validate whatever arrived. Unknown fields and unknown values are
 * DROPPED rather than rejected: a listing must not fail to save because a
 * newer app sent a question this server has not learned yet, and a value we
 * cannot interpret must never be stored as if we could.
 */
export function parseConditionDetails(input) {
  let raw = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = BY_ID.get(k);
    if (!field) continue;
    if (field.options.some((o) => o.value === v)) out[k] = v;
  }
  return out;
}

export function serializeConditionDetails(details) {
  return JSON.stringify(parseConditionDetails(details));
}

/**
 * Which questions carry a real answer.
 *
 * `unknown` counts as answered — the seller was asked and told us. This is
 * what lets the prose rules stand down: nagging someone to "describe the
 * screen" after they have ticked a screen answer is the app not listening.
 */
export function answeredFields(details) {
  const d = parseConditionDetails(details);
  return new Set(Object.keys(d));
}

/** The defects the seller has declared, in the inspector's vocabulary. */
export function declaredDefects(details) {
  const d = parseConditionDetails(details);
  const out = new Set();
  for (const [k, v] of Object.entries(d)) {
    const opt = BY_ID.get(k)?.options.find((o) => o.value === v);
    if (opt?.defect) out.add(opt.defect);
  }
  return out;
}

/**
 * Defects the inspector found that the seller did not declare.
 *
 * The point of a shared vocabulary: this is the only set worth showing a
 * reviewer, because a defect the seller already owned up to is not a
 * discrepancy — it is a seller being honest, and flagging it would train the
 * queue to ignore the signal.
 */
export function undeclaredDefects(details, inspectorKinds) {
  const declared = declaredDefects(details);
  return [...new Set(inspectorKinds || [])].filter((k) => !declared.has(k));
}

/**
 * Mark which prose-detected defects the seller had already declared.
 *
 * Without this the two systems talk past each other: a seller who ticks
 * «الشاشة مكسورة» AND writes «بي كسر بالشاشة» is being maximally honest, and
 * the review queue would show that as a flag identical to the one raised
 * against a seller who ticked «سليمة» and hoped nobody read the description.
 * Those are opposite behaviours and must not look the same to an operator.
 *
 * Nothing is suppressed — a disclosed defect is still a defect and still
 * belongs in the queue. Only the annotation is added, so the queue can sort
 * a contradiction above a confession.
 */
export function annotateDisclosure(review, details) {
  if (!review?.defects) return review;
  const declared = declaredDefects(details);
  const answered = answeredFields(details);
  const defects = review.defects.map((d) => ({ ...d, declared: declared.has(d.kind) }));

  // A contradiction is not "they declared nothing" — it is "they answered the
  // very question this defect belongs to, and their answer did not include
  // it". Ticking «الشاشة سليمة» and then writing «بي كسر بالشاشة» declares no
  // defect at all, so a check based on declared defects being non-empty
  // misses precisely the case worth catching.
  const contradicts = defects.some(
    (d) => !d.declared && [...fieldsThatCanDeclare(d.kind)].some((f) => answered.has(f)),
  );
  return { ...review, defects, contradicts };
}

/** Which questions could have declared this defect, if the seller had said so. */
function fieldsThatCanDeclare(kind) {
  const out = new Set();
  for (const f of CONDITION_FIELDS) {
    if (f.options.some((o) => o.defect === kind)) out.add(f.id);
  }
  return out;
}
