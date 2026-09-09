// Read a seller's description and answer the structured condition questions.
//
// Every listing written before conditionDetails.js existed has an empty
// `condition_details_json` and, often, a sentence that already answers two or
// three of the questions. This reads those sentences so the funnel's filters,
// the review queue's contradiction check, and the buyer's card all work on
// old listings instead of only new ones.
//
// PRECISION OVER COVERAGE, and not as a slogan — three things in this corpus
// punish a keyword sweep, and each one is a rule below:
//
//   1. Water is never water. Every «ماء» in a thousand live listings is a
//      spec — «مقاوم للماء», «ضد الماء», IP67. A keyword rule would declare
//      water damage on phones advertised as water RESISTANT, which is the
//      exact opposite claim.
//   2. «كسر» is usually money. «لا تكسر بالسعر», «لحد يكسر» is haggling, not
//      a crack, and it is more common than the breakage sense.
//   3. The scratched thing is often the screen PROTECTOR. «لاصق الشاشة
//      مخدوش», «شاشة حماية» — the seller is saying the glass underneath is
//      fine, and reading it as a scratched screen inverts them.
//
// So a defect word alone decides nothing. It has to survive a window check
// for a negator, a locator (screen vs back), and a disqualifier, and any
// field that collects two different answers is left UNANSWERED rather than
// guessed. Unanswered is a real state here: `unknown` means the seller was
// asked and said they don't know, and this module must never forge that.

/** Unify the spellings one corpus actually contains, without losing spaces. */
export function fold(input) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── the window vocabulary ────────────────────────────────────────────
//
// Negators include the Iraqi postfix form: «شخط ما بي» puts the negation
// AFTER the noun, so both sides of the keyword are searched.
//
// `\b` is useless here and was the first version's bug: JavaScript word
// boundaries are defined against [A-Za-z0-9_], so there is no boundary
// between a space and an Arabic letter and `/\bما\b/` matches nothing at
// all. Every negation check silently passed, and «الجهاز ما مبدل بي أي شي»
// — a phone with no repairs — was recorded as repaired. Separators are
// spelled out instead.
const SEP = '[\\s،,.|:؛!؟()\\-]';
const NEG_SEPARATED = new RegExp(`(?:^|${SEP})(?:ما|مو|لا|ولا|ابد|بدون|بلا|ماكو|مافي|مب|خالي|عدا|غير)(?:${SEP}|$)`);
// Iraqi writing glues the negator to the verb as often as not, and none of
// these survive a separator rule: «مامبدل», «مابي», «ماداخل», «مامفتوح».
const NEG_GLUED = /(?:ما|مو)(?:مبدل|مصلح|مفتوح|داخل|بي|بيه|بيها|كو|في|اكو|شي)/;
const NEG = { test: (w) => NEG_SEPARATED.test(w) || NEG_GLUED.test(w) };

/**
 * «مكفول من كلشي حته شخط», «كفاله من الشخط», «شخوطه معدومه».
 *
 * A warranty phrased as an absence-of-defect claim. Kept apart from NEG on
 * purpose: «مكفول» beside «تصليح» is a warranty ON a repair, not the absence
 * of one, so this may only ever relax a scratch rule.
 */
const NO_DEFECT_CLAIM = /(مكفول من|كفاله من|كفول من|معدوم|ما يبين|مايبين)/;
const SCREEN = /(شاش|زجاج|كلاس|قزاز|لمس|ديسبلي|display|screen|touch)/;
const BACK = /(ظهر|ضهر|شاصي|هيكل|جسم|بادي|حاف|اطار|جوانب|كفر خلفي|back|frame|body)/;
// Things that are scratched or cracked but are NOT the phone.
const NOT_THE_PHONE = /(لاصق|جلاتين|حمايه|حماية|واقي|سكرين بروتكتر|كفر|غلاف|كارتون|كرتون|علبه|عدسه|كامرا|كامره|كاميرا|زر )/;
// «كسر» as haggling, and water as a spec.
const PRICE_TALK = /(سعر|بسعر|السعر|مجال|تنزل|يكسر|تكسر|كسر بالسعر)/;
// A break that HASN'T happened. «ضمان ٢٠٠ يوم اذا ينكسر الشاشه تصليح ابلاش»
// is a warranty offer, and reading it as a cracked screen inverts the seller.
const HYPOTHETICAL = /(اذا |لو |ضمان|كفاله|مكفول|بحال|في حال)/;
const WATER_SPEC = /(مقاوم|ضد الماء|ضد المي|ip\s?6|ip\s?5|ip\s?7|رذاذ|غبار|waterproof|resistant)/;

/**
 * Split into clauses, and mean it — this is where negation scope lives.
 *
 * A window of N characters around a keyword was the first design and it
 * leaks: «نظيف بدون خلل فقط خدش بقاعدة سيم كارت» put «بدون» within reach of
 * «خدش» and turned a declared scratch into a clean phone. Iraqi sellers mark
 * the exception explicitly — «بس», «فقط», «لكن», «الا» — so those words split
 * a clause exactly like a full stop does, and a negator can then only reach
 * the defect it was actually written about.
 */
export function clauses(text) {
  return String(text)
    .split(/[.،,؛!؟\n|()]+|\s(?:بس|فقط|لكن|لاكن|الا|ماعدا|عدا|سوى)\s/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Words that contain a negator but negate nothing.
 *
 * «مثل ما واضح بالصور» is "as shown in the photos" and «شخط ما يبين» is "a
 * scratch you can barely see" — both describe a defect that EXISTS. Left in,
 * they flipped exactly those listings to clean. Blanked before the negation
 * test rather than fought inside it.
 */
const NEG_FALSE = /(مثل ما|مثلما|كما|زي ما|شلون ما|ما بين|مايبين|ما يبين|ما يبان|ما واضح|ما واظح|ما مبين)/g;

function negated(clause) {
  return NEG.test(clause.replace(NEG_FALSE, ' '));
}

/**
 * One field's votes. Two different values cancel; one value stands.
 *
 * Cancelling matters more than it looks: a description that says the phone is
 * spotless and then names a cracked screen has answered the question twice,
 * differently. Rather than rank the two, the field is left unanswered — a
 * buyer filtering on «سليمة» must never be handed a phone whose own
 * description says otherwise.
 */
function settle(votes) {
  const set = new Set(votes.filter(Boolean));
  return set.size === 1 ? [...set][0] : null;
}

const SCRATCH = /(شخط|شخوط|شخطه|خدش|خدوش|مخدوش|خربوش|زلغ)/;
const CRACK = /(فطر|مفطور|مفطوره|مفطر|مفطره|انكسر|مكسور|مكسوره|كسر)/;
// Bare «ظل» and «طيف» were in the first list and matched inside ordinary
// words in marketing copy. A display fault has to be spelled out.
//
// The «خط» family needs a word start, and this is not pedantry: «شخط», the
// commonest word for a scratch in the corpus, ENDS in «خط». Without the
// guard every scratched screen also voted "display fault", the two answers
// cancelled, and the listing came back with nothing at all.
const DISPLAY_FAULT = new RegExp(
  `(?:(?:^|${SEP})(?:خط بالشاش|خط بشاش|خطين|خطوط))`
  + '|(بقعه|نقطه سوده|بكسل محروق|لمس مفطور|لمس ما يشتغل|اللمس ما|ما يشتغل اللمس|ميته|متفلشه)',
);
const DENT = /(كدمه|كدمات|ضربه|ضربات|مضروب|انبعاج|معوج|مثني)/;

function screenAnswer(cs) {
  const votes = [];
  for (const c of cs) {
    if (NOT_THE_PHONE.test(c)) continue;        // the protector, not the glass
    if (DISPLAY_FAULT.test(c) && (SCREEN.test(c) || /خطين|نقطه سوده|بقعه/.test(c)) && !negated(c)) {
      votes.push('display_fault');
    }
    // «لا تكسر بالسعر» is haggling. A crack beside price talk is not a crack.
    if (CRACK.test(c) && SCREEN.test(c) && !PRICE_TALK.test(c) && !HYPOTHETICAL.test(c) && !negated(c)) {
      votes.push('cracked');
    }
    // A clause naming BOTH the screen and the back cannot say which one the
    // scratch is on. «مبدل شاشه ... بي شخوط بلضهر» is scratches on the back,
    // and crediting the screen with them is a defect the seller never wrote.
    if (SCRATCH.test(c) && SCREEN.test(c) && !BACK.test(c)) {
      votes.push(negated(c) || NO_DEFECT_CLAIM.test(c) ? 'clean' : 'scratches');
    }
  }
  // A global "not a single scratch" claim covers the screen too, but only
  // when nothing more specific was said about it.
  if (!votes.length && globalNoScratch(cs)) votes.push('clean');
  return settle(votes);
}

function bodyAnswer(cs) {
  const votes = [];
  for (const c of cs) {
    if (NOT_THE_PHONE.test(c)) continue;
    if (CRACK.test(c) && BACK.test(c) && !PRICE_TALK.test(c) && !HYPOTHETICAL.test(c) && !negated(c)) {
      votes.push('cracked_back');
    }
    if (DENT.test(c) && BACK.test(c) && !negated(c)) votes.push('dents');
    if (SCRATCH.test(c) && BACK.test(c)) {
      votes.push(negated(c) || NO_DEFECT_CLAIM.test(c) ? 'clean' : 'scratches');
    }
  }
  if (!votes.length && globalNoScratch(cs)) votes.push('clean');
  return settle(votes);
}

/**
 * «ولا شخطه», «شخط ما بي», «مكفول من كلشي حته شخط», «بدون خدوش».
 *
 * Only counted when the sentence carries no locator at all — a seller who
 * says "no scratches on the back" has not said anything about the screen.
 */
function globalNoScratch(cs) {
  let claim = false;
  for (const c of cs) {
    if (!SCRATCH.test(c)) continue;
    if (SCREEN.test(c) || BACK.test(c) || NOT_THE_PHONE.test(c)) continue;
    if (negated(c) || NO_DEFECT_CLAIM.test(c)) claim = true;
    // An un-negated scratch anywhere kills the blanket claim outright: the
    // seller has said there IS one, and only the location is missing.
    else return false;
  }
  return claim;
}

const REPAIR_WORD = /(تصليح|مصلح|صلح|اصلاح|صيانه|صيانة|تبديل|مبدل|مبدله|تبدل|مغير|مغيره|تغيير|بدلت|بدلته)/;

/**
 * A repair the phone NEEDS, or one a warranty would pay for, is not a repair
 * that happened. «يحتاج تبدله شاشه», «معوز تصليح بطارية», «ضمان ٢٠٠ يوم اذا
 * ينكسر الشاشه تصليح ابلاش» — recording those as work already done would tell
 * a buyer the opposite of what the seller wrote.
 */
const REPAIR_NOT_DONE = /(يحتاج|محتاج|معوز|لازم|اذا |ضمان|كفاله|مكفول|يريد تبديل|تصليحها)/;

function repairsAnswer(cs) {
  const votes = [];
  for (const c of cs) {
    if (!REPAIR_WORD.test(c)) continue;
    if (negated(c)) { votes.push('none'); continue; }
    if (REPAIR_NOT_DONE.test(c)) continue;
    if (SCREEN.test(c)) { votes.push('screen_replaced'); continue; }
    if (/بطاري|باتري|battery/.test(c)) { votes.push('battery_replaced'); continue; }
    votes.push('other_repair');
  }
  return settle(votes);
}

const WATER_DAMAGE = /(دخل.{0,8}(ماي|مويه|ماء|مي)|غرق|وقع.{0,10}(ماي|مويه|ماء)|بلل|تبلل|رطوبه)/;
const WATER_CLEAR = /((ما|مو|لا|ولا|ابد|بدون)\s*(دخل|داخل)?\s*(ماي|مويه|ماء)|ما دخله ماي|ما دخل ماي)/;

function waterAnswer(cs) {
  const votes = [];
  for (const c of cs) {
    // Every «ماء» in a thousand live listings is an IP rating. Marketing copy
    // about water RESISTANCE must never become a water-damage declaration.
    if (WATER_SPEC.test(c)) continue;
    if (WATER_DAMAGE.test(c)) votes.push(negated(c) ? 'no' : 'yes');
    else if (WATER_CLEAR.test(c)) votes.push('no');
  }
  return settle(votes);
}

/**
 * @param description  the listing's own text, as the seller wrote it.
 * @returns only the fields the prose actually answers. Never `unknown`:
 *          that is a seller's answer, not an inference.
 */
export function inferConditionDetails(description) {
  const t = fold(description);
  if (!t) return {};
  const cs = clauses(t);
  const out = {};
  const screen = screenAnswer(cs);
  const body = bodyAnswer(cs);
  const repairs = repairsAnswer(cs);
  const water = waterAnswer(cs);
  if (screen) out.screen = screen;
  if (body) out.body = body;
  if (repairs) out.repairs = repairs;
  if (water) out.water = water;
  return out;
}
