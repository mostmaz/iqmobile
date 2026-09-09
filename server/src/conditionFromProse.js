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
// The leading «و»/«ف» is part of the word in Arabic writing: «وبدون تبديل»
// has no separator before the negator, and without this «بدون» was invisible
// and the phone came back as repaired.
const NEG_SEPARATED = new RegExp(`(?:^|${SEP})(?:و|ف)?(?:ما|مو|لا|ولا|ابد|بدون|بلا|ماكو|مافي|مب|خالي|غير)(?:${SEP}|$)`);
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
    // «عدا» is an EXCEPTION marker, not a negator: «مكفول من التصليح … عدا
    // بي فطر بل كلاسه» introduces the one defect there is. It splits a
    // clause, and must never suppress what follows it.
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
const NEG_FALSE = new RegExp(
  '(مثل ما|مثلما|كما|زي ما|شلون ما|ما بين|مايبين|ما يبين|ما يبان|ما واضح|ما واظح|ما مبين)'
  // «بدون» is usually about what is missing from the BOX, not about defects,
  // and it reached across half a sentence: «جهاز نضيف بدون ملحقات بي شخوط بل
  // شاشه» is a phone with no accessories AND a scratched screen, and this
  // negator turned it into a clean one.
  + '|بدون\\s*(ملحقات|كارتون|كرتون|علبه|شاحن|كيبل|سماعات|كفر|اغراض|غراض|توصيل|معامله|مجال|ضمان|كفاله)',
  'g',
);

/** Blank the false negators, keeping every index intact for the distance test. */
function maskFalseNegators(clause) {
  return clause.replace(NEG_FALSE, (m) => ' '.repeat(m.length));
}

function negated(clause) {
  return NEG.test(maskFalseNegators(clause));
}

/**
 * Is there a negator NEAR this defect word — not merely somewhere in the
 * clause?
 *
 * Clause-wide negation was the last thing to break, and in the worst
 * direction. «مبدل شاشة وبطارية وكامرة … السعر 450 قفل من الاخير بدون عمله»
 * is a phone with three replaced parts; «بدون عمله» is about the commission
 * and sits nowhere near the repair, yet it marked the listing as never
 * repaired. Sellers write negation next to what they are denying, so the
 * negator has to be within reach — the same distance rule the locators use.
 */
function negatedNear(clause, at, len) {
  const masked = maskFalseNegators(clause);
  for (const re of [NEG_SEPARATED, NEG_GLUED]) {
    for (const h of hits(masked, re)) {
      if (gap(at, len, h.at, h.len) < MAX_LOCATOR_DISTANCE) return true;
    }
  }
  return false;
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
  + '|(بقعه|نقطه سوده|بكسل محروق|لمس مفطور|لمس ما يشتغل|اللمس ما|ما يشتغل اللمس|ميته|متفلشه)'
  // A fault named ON the screen. Bare «عاطل» is not enough — «فيس ايدي عاطل»
  // is Face ID, and it appears beside a screen far more often than a broken
  // display does.
  + '|(عطل بالشاش|عطل بل شاش|عطل بشاش|مشكله بالشاش|مشكله بشاش|خلل بالشاش|الشاشه عاطل)',
);
const DENT = /(كدمه|كدمات|ضربه|ضربات|مضروب|انبعاج|معوج|مثني)/;

/** Beyond this many characters the two words are not talking about each other. */
const MAX_LOCATOR_DISTANCE = 22;

/**
 * Gap between two spans, where OVERLAP counts as zero.
 *
 * The glued negators overlap what they negate — «مامبدل» contains «مبدل» —
 * and a naive subtraction makes that gap negative, so the closest possible
 * negation was the one being thrown away.
 */
function gap(aAt, aLen, bAt, bLen) {
  if (bAt >= aAt + aLen) return bAt - (aAt + aLen);
  if (bAt + bLen <= aAt) return aAt - (bAt + bLen);
  return 0;
}

/** Each occurrence of `re` in the clause, with where it sat. */
function hits(clause, re) {
  const out = [];
  const g = new RegExp(re.source, 'g');
  let m;
  while ((m = g.exec(clause)) !== null) {
    out.push({ at: m.index, len: m[0].length });
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

/**
 * Which surface a defect word is about: the NEAREST locator to it, if one is
 * close enough to be in the same breath.
 *
 * "The clause mentions the screen" is not good enough. «ضهر مفطر وشاشه بيها
 * خدش بسيط» names both surfaces and two different defects, and asking only
 * whether the clause contained «شاشه» put the crack on the screen and lost
 * the scratch entirely. Distance settles it: «مفطر» is next to «ضهر», «خدش»
 * is next to «شاشه», and both facts survive.
 */
function surfaceOf(clause, at, len) {
  let best = null;
  let bestD = MAX_LOCATOR_DISTANCE;
  for (const [kind, re] of [['screen', SCREEN], ['back', BACK]]) {
    for (const h of hits(clause, re)) {
      const d = gap(at, len, h.at, h.len);
      if (d < bestD) { bestD = d; best = kind; }
    }
  }
  return best;
}

/**
 * The screen and the body in one pass, because a single clause routinely
 * answers for both and they cannot be decided independently.
 */
function surfaceAnswers(cs) {
  const screen = [];
  const body = [];
  for (const c of cs) {
    if (NOT_THE_PHONE.test(c)) continue;        // the protector, not the glass
    const claim = NO_DEFECT_CLAIM.test(c);
    // A crack in «الشاشة الخلفية» is the back glass, whatever the word says.
    const rearGlass = /شاشه الخلفيه|الشاشه الخلفيه|شاشه خلفيه/.test(c);

    for (const h of hits(c, DISPLAY_FAULT)) {
      if (negatedNear(c, h.at, h.len)) continue;
      if (surfaceOf(c, h.at, h.len) === 'back') continue;
      screen.push('display_fault');
    }
    for (const h of hits(c, CRACK)) {
      if (PRICE_TALK.test(c) || HYPOTHETICAL.test(c) || negatedNear(c, h.at, h.len)) continue;
      const where = rearGlass ? 'back' : surfaceOf(c, h.at, h.len);
      if (where === 'screen') screen.push('cracked');
      else if (where === 'back') body.push('cracked_back');
    }
    for (const h of hits(c, DENT)) {
      if (negatedNear(c, h.at, h.len)) continue;
      if (surfaceOf(c, h.at, h.len) === 'back') body.push('dents');
    }
    for (const h of hits(c, SCRATCH)) {
      const where = surfaceOf(c, h.at, h.len);
      if (!where) continue;
      const clean = negatedNear(c, h.at, h.len) || claim;
      (where === 'screen' ? screen : body).push(clean ? 'clean' : 'scratches');
    }
  }
  // A blanket "not a single scratch" claim covers both surfaces, but only
  // where nothing more specific was said.
  const blanket = globalNoScratch(cs);
  if (!screen.length && blanket) screen.push('clean');
  if (!body.length && blanket) body.push('clean');
  return { screen: settle(screen), body: settle(body) };
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
    const anyNeg = hits(c, SCRATCH).some((h) => negatedNear(c, h.at, h.len));
    if (anyNeg || NO_DEFECT_CLAIM.test(c)) claim = true;
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

/**
 * Spec-sheet prose, which is not a repair report.
 *
 * «تقنية LTPO التي تعمل على تغيير معدل تحديث الشاشة» is a phone DESCRIBING
 * its refresh rate, and «تغيير» beside «شاشة» read it as a replaced screen.
 * Copy-pasted spec sheets are common on this marketplace and they are the
 * one place a repair verb appears with no repair behind it.
 */
const SPEC_SHEET = /(يدعم|هرتز|هيرتز|ميجابكسل|ميجا بكسل|ميكا بكسل|معالج|نانومتر|واط|مللي امبير|معدل تحديث|تقنيه|بدقه|dolby|hdr|ltpo|snapdragon|mediatek)/;

// Which part was replaced is decided by ADJACENCY, not by the part being
// mentioned anywhere in the clause. «مبدل بطاريه 100% وبه عطل بالشاشه» is a
// replaced battery and a faulty screen; keying on "does the clause contain
// شاشة" turned it into a replaced screen and lost both facts.
const REPLACED_SCREEN = /(مبدل|مبدله|مبدلة|مستبدل|مستبدله|مستبدلة|بدلت|بدلته|بدلتها|تبديل|تغيير|مغير)\s*(?:ال)?\s*(شاشه|شاشة|كلاس|قزاز|زجاج)|(?:ال)?(شاشه|شاشة)\s*(مبدله|مبدلة|مستبدله|مستبدلة|مبدل|مغيره)/;
const REPLACED_BATTERY = /(مبدل|مبدله|مبدلة|مستبدل|مستبدله|مستبدلة|بدلت|بدلته|بدلتها|تبديل|تغيير|مغير)\s*(?:ال)?\s*(بطاري|باتري|battery)|(?:ال)?(بطاريه|بطارية)\s*(مبدله|مبدلة|مستبدله|مستبدلة|مبدل)/;

function repairsAnswer(cs) {
  const votes = [];
  for (const c of cs) {
    for (const h of hits(c, REPAIR_WORD)) {
      if (negatedNear(c, h.at, h.len)) { votes.push('none'); continue; }
      if (REPAIR_NOT_DONE.test(c)) continue;
      if (SPEC_SHEET.test(c) && !REPLACED_SCREEN.test(c) && !REPLACED_BATTERY.test(c)) continue;
      if (REPLACED_SCREEN.test(c)) { votes.push('screen_replaced'); continue; }
      if (REPLACED_BATTERY.test(c)) { votes.push('battery_replaced'); continue; }
      votes.push('other_repair');
    }
  }
  return settle(votes);
}

// «بلل» was in this list and matched inside «بللعاب» — "a beast at games".
// The listing then read as a water-damage declaration, negated into «no».
// Water words need a word start; the concept is too rare in this corpus to
// be worth a loose pattern.
const WATER_DAMAGE = new RegExp(`(?:^|${SEP})(?:دخل.{0,8}(?:ماي|مويه|ماء)|غرق|وقع.{0,10}(?:ماي|مويه|ماء)|تبلل|رطوبه)`);
const WATER_CLEAR = /((ما|مو|لا|ولا|ابد|بدون)\s*(دخل|داخل)?\s*(ماي|مويه|ماء)|ما دخله ماي|ما دخل ماي)/;

function waterAnswer(cs) {
  const votes = [];
  for (const c of cs) {
    // Every «ماء» in a thousand live listings is an IP rating. Marketing copy
    // about water RESISTANCE must never become a water-damage declaration.
    if (WATER_SPEC.test(c)) continue;
    for (const h of hits(c, WATER_DAMAGE)) votes.push(negatedNear(c, h.at, h.len) ? 'no' : 'yes');
    if (WATER_DAMAGE.test(c)) continue;
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
  const { screen, body } = surfaceAnswers(cs);
  const repairs = repairsAnswer(cs);
  const water = waterAnswer(cs);
  if (screen) out.screen = screen;
  if (body) out.body = body;
  if (repairs) out.repairs = repairs;
  if (water) out.water = water;
  return out;
}
