// The seller's structured answers about condition — mirrored from
// server/src/conditionDetails.js, plus the Arabic the server has no business
// knowing. Same convention as governorates.ts: the vocabulary is shared, the
// wording lives on the client.
//
// Why fixed answers at all: the app already nagged for screen / body /
// repairs as regex over the description, and the AI inspector already
// described what it saw using a defect enum. A paragraph and an enum cannot
// be compared, so the two halves could never agree. Every option below maps
// to the inspector's own vocabulary, which is what makes "the seller says the
// screen is cracked" and "the photos show a cracked screen" the same claim.
//
// «غير معروف» is a real answer, not a missing one. Someone who bought the
// phone used genuinely does not know whether the screen was replaced, and a
// form that forces a guess produces a confident lie.

export type ConditionDetails = Record<string, string>;

export interface ConditionOption { value: string; label: string; defect: string | null }
export interface ConditionField {
  id: string;
  question: string;
  /** Shown on the listing page as the row label. */
  spec: string;
  options: ConditionOption[];
}

export const CONDITION_FIELDS: ConditionField[] = [
  {
    id: 'screen',
    question: 'حالة الشاشة',
    spec: 'الشاشة',
    options: [
      { value: 'clean', label: 'بلا خدوش', defect: null },
      { value: 'scratches', label: 'خدوش', defect: 'deep_scratches' },
      { value: 'cracked', label: 'مكسورة', defect: 'cracked_screen' },
      { value: 'display_fault', label: 'عيب بالعرض أو اللمس', defect: 'screen_defect' },
      { value: 'replaced', label: 'مبدّلة', defect: 'repaired_before' },
      { value: 'unknown', label: 'غير معروف', defect: null },
    ],
  },
  {
    id: 'body',
    question: 'حالة الهيكل والظهر',
    spec: 'الهيكل',
    options: [
      { value: 'clean', label: 'نظيف', defect: null },
      { value: 'scratches', label: 'خدوش', defect: 'deep_scratches' },
      { value: 'dents', label: 'ضربات أو انحناء', defect: 'dent_or_bend' },
      { value: 'cracked_back', label: 'ظهر مكسور', defect: 'cracked_back' },
      { value: 'unknown', label: 'غير معروف', defect: null },
    ],
  },
  {
    id: 'repairs',
    question: 'هل صُلّح أو بُدّل شيء؟',
    spec: 'الإصلاحات',
    options: [
      { value: 'none', label: 'لا شيء', defect: null },
      { value: 'screen_replaced', label: 'الشاشة مبدّلة', defect: 'repaired_before' },
      { value: 'battery_replaced', label: 'البطارية مبدّلة', defect: 'repaired_before' },
      { value: 'other_repair', label: 'إصلاح آخر', defect: 'repaired_before' },
      { value: 'unknown', label: 'غير معروف', defect: null },
    ],
  },
  {
    id: 'water',
    question: 'هل دخله ماء؟',
    spec: 'ضرر الماء',
    options: [
      { value: 'no', label: 'لا', defect: null },
      { value: 'yes', label: 'نعم', defect: 'water_damage' },
      { value: 'unknown', label: 'غير معروف', defect: null },
    ],
  },
];

const BY_ID = new Map(CONDITION_FIELDS.map((f) => [f.id, f]));

/** A brand-new sealed phone has no repair history to ask about. */
export function fieldsFor(condition: string): ConditionField[] {
  return condition === 'new' || condition === 'sealed' ? [] : CONDITION_FIELDS;
}

export function parseConditionDetails(input: any): ConditionDetails {
  let raw = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ConditionDetails = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = BY_ID.get(k);
    if (f && f.options.some((o) => o.value === v)) out[k] = v as string;
  }
  return out;
}

export function labelFor(fieldId: string, value: string): string | null {
  return BY_ID.get(fieldId)?.options.find((o) => o.value === value)?.label ?? null;
}

/**
 * Which questions the seller has answered.
 *
 * The prose rules in listingQuality.ts consult this and stand down for the
 * fields it contains. Without that, a seller who ticks «الشاشة بلا خدوش» is
 * still told to «وضّح حالة الشاشة» — the app asking a question it just got an
 * answer to, which reads as not listening.
 */
export function answeredFields(details: any): Set<string> {
  return new Set(Object.keys(parseConditionDetails(details)));
}

/** Rows to render on the listing page: answered questions, in field order. */
export function conditionRows(details: any): { id: string; spec: string; label: string }[] {
  const d = parseConditionDetails(details);
  return CONDITION_FIELDS
    .filter((f) => d[f.id])
    .map((f) => ({ id: f.id, spec: f.spec, label: labelFor(f.id, d[f.id])! }));
}
