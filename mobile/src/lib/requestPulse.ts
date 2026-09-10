// The wording around «١٨ طلب بآخر ٢٤ ساعة · بغداد».
//
// Pure and dependency-free so `node --test` can import it directly (the
// mobile suite relies on type stripping, which cannot resolve React Native).
// The numbers themselves come from GET /phone-requests/pulse; what lives
// here is only how they are said — which is the part that is easy to get
// wrong in Arabic and impossible to notice in English.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Arabic-Indic digits. Counts written into prose use these; prices do not. */
export function arNum(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

/**
 * «طلب» counted properly.
 *
 * Arabic has four cases where English has two, and getting it wrong is the
 * kind of mistake a native speaker reads as "written by a machine":
 *   1  → طلب واحد        (singular, no numeral)
 *   2  → طلبان           (dual, no numeral)
 *   3–10 → ٣ طلبات       (numeral + broken plural)
 *   11+  → ١١ طلباً      (numeral + accusative singular)
 * 0 is handled by the caller — a feed with nothing in it says something else.
 */
export function requestCountAr(n: number): string {
  const c = Math.max(0, Math.floor(n));
  if (c === 1) return 'طلب واحد';
  if (c === 2) return 'طلبان';
  if (c <= 10) return `${arNum(c)} طلبات`;
  return `${arNum(c)} طلباً`;
}

/**
 * The line under «الطلبات».
 *
 * @param govAr the governorate in Arabic, or '' when we do not know it — the
 *   line then drops the place rather than inventing one. A subtitle claiming
 *   «· بغداد» to somebody in Basra is worse than a shorter subtitle.
 */
export function pulseLine(count24h: number, govAr: string): string {
  const where = govAr ? ` · ${govAr}` : '';
  if (count24h <= 0) return `لا طلبات جديدة بآخر ٢٤ ساعة${where}`;
  return `${requestCountAr(count24h)} بآخر ٢٤ ساعة${where}`;
}

/**
 * The invite card's promise.
 *
 * Quotes a number only when the server gave us one it can keep. `reach` is a
 * FLOOR — shops in your governorate, which the broadcast reaches on location
 * alone — so «N تاجر» is never an overstatement. At 0 (no governorate, or a
 * city with no shops yet) the sentence still works without it, and that is
 * the honest version rather than a placeholder.
 */
export function invitePitch(reach: number): string {
  const n = Math.max(0, Math.floor(reach));
  if (n <= 0) return 'اطلب الجهاز وخل التجار يشوفون طلبك.';
  if (n === 1) return 'اطلب الجهاز وخل تاجراً واحداً يشوف طلبك.';
  if (n === 2) return 'اطلب الجهاز وخل تاجرين يشوفون طلبك.';
  if (n <= 10) return `اطلب الجهاز وخل ${arNum(n)} تجار يشوفون طلبك.`;
  return `اطلب الجهاز وخل ${arNum(n)} تاجراً يشوفون طلبك.`;
}

/**
 * «٣ نتائج» — the search screen's result count.
 *
 * Lives here rather than in the search screen because it is the SAME Arabic
 * counting problem as «طلب», and because this number is what decides whether
 * the request invitation is worth showing: a buyer told «٣ نتائج» knows the
 * list is short, and that is the sentence the card answers.
 *
 * @param more whether a further page may exist — «١٥+ نتيجة» rather than a
 *   count we cannot stand behind.
 */
export function resultsCountAr(n: number, more = false): string {
  const c = Math.max(0, Math.floor(n));
  if (c === 0) return 'لا نتائج';
  if (more) return `${arNum(c)}+ نتيجة`;
  if (c === 1) return 'نتيجة واحدة';
  if (c === 2) return 'نتيجتان';
  if (c <= 10) return `${arNum(c)} نتائج`;
  return `${arNum(c)} نتيجة`;
}

/**
 * What the الطلبات tab badge shows, or null for no badge.
 *
 * `count_new` is already clamped into the 24-hour window server-side, so this
 * only has to decide the cap. Returning null rather than 0 keeps the caller
 * from rendering an empty dot.
 */
export function badgeLabel(countNew: number | undefined, cap = 99): string | null {
  const n = Math.max(0, Math.floor(countNew || 0));
  if (n <= 0) return null;
  return n > cap ? `${cap}+` : arNum(n);
}
