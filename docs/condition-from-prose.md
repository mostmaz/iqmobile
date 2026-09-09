# Filling the condition answers from what the seller already wrote

`conditionDetails.js` asks four questions — screen, body, repairs, water — in
fixed answers. Every listing written before it existed has an empty
`condition_details_json` and, often, a sentence that already answers two or
three of them. `conditionFromProse.js` reads those sentences;
`src/scripts/backfillConditionDetails.js` writes the result.

    node src/scripts/backfillConditionDetails.js            # dry run
    node src/scripts/backfillConditionDetails.js --show 40  # sample the diff
    node src/scripts/backfillConditionDetails.js --apply

Across all 1,347 live listings, 1,123 have a description and **196 of them
answer at least one question** — 253 answers, mostly «no repairs» and «no
scratches». The rest say nothing about condition, and are left alone.

## Precision over coverage, for a specific reason

The failure here is silent and permanent. A wrong «الشاشة سليمة» on a cracked
phone is a listing that lies to every buyer who filters on it, and nothing
downstream re-checks it. So a defect word alone decides nothing: it has to
survive a clause check, and any field that collects two different answers is
left **unanswered**.

Unanswered is a real state. `unknown` means the seller was asked and said they
don't know — an honest answer this module must never forge.

## What the corpus punishes

Each of these was a real, measurable error before it was a rule.

- **Water is never water.** Every «ماء» in a thousand listings is a spec:
  «مقاوم للماء», «ضد الماء», IP67. A keyword rule declares water damage on
  phones advertised as water *resistant*.
- **«كسر» is usually money.** «لا تكسر بالسعر», «لحد يكسر» is haggling, and it
  is more common than the breakage sense.
- **The scratched thing is often the protector.** «لاصق الشاشة مخدوش»,
  «شاشة حماية» — the seller is saying the glass underneath is fine.
- **A break that hasn't happened.** «ضمان ٢٠٠ يوم اذا ينكسر الشاشه تصليح
  ابلاش» is a warranty offer. «يحتاج تبدله شاشه» is a repair the phone needs,
  not one it had.
- **«شخط» ends in «خط».** The commonest word for a scratch contains the word
  for a line, so every scratched screen also voted "display fault", the two
  cancelled, and the listing came back empty. The «خط» family needs a word
  start.
- **A spec sheet is not a repair report.** «تقنية LTPO التي تعمل على تغيير
  معدل تحديث الشاشة» is a phone describing its refresh rate; «تغيير» beside
  «شاشة» read it as a replaced screen.
- **«بلل» inside «بللعاب»** — "a beast at games" — was read as a water
  declaration and then negated into «no».
- **«بدون» is usually about the box.** «جهاز نضيف بدون ملحقات بي شخوط بل
  شاشه» is a phone with no accessories and a scratched screen; the negator
  reached across and made it clean.
- **«عدا» introduces the defect, it does not deny it.** «مكفول من التصليح …
  عدا بي فطر بل كلاسه» names the one thing that is wrong.

## Two bugs worth remembering

**`\b` does not work on Arabic.** JavaScript word boundaries are defined
against `[A-Za-z0-9_]`, so there is no boundary between a space and an Arabic
letter and `/\bما\b/` matches *nothing*. The first version's negation checks
all silently passed, and «الجهاز ما مبدل بي أي شي» — a phone with no repairs —
was recorded as repaired. Separators are spelled out instead.

**Nothing decides at clause scope — everything decides at word distance.**
Three rules landed in the same place by different roads. Which surface a
defect belongs to is the NEAREST locator to it: «ضهر مفطر وشاشه بيها خدش
بسيط» names two surfaces and two defects, and asking only whether the clause
contained «شاشة» put the crack on the screen and lost the scratch. Which part
was replaced is the one ADJACENT to the repair word: «مبدل بطارية 100% وبه
عطل بالشاشة» is a replaced battery and a faulty screen. And a negator only
counts when it is near what it denies — «مبدل شاشة وبطارية وكامرة … بدون
عمله» is a phone with three replaced parts, and the commission clause marked
it as never repaired. Overlap counts as distance zero, because the glued
negators contain what they negate: «مامبدل» holds «مبدل».

**Negation scope is also a clause, not a character window.** A window of N characters put
«بدون» within reach of «خدش» in «نظيف بدون خلل فقط خدش بقاعدة سيم كارت» and
turned a declared scratch into a clean phone. Iraqi sellers mark the exception
explicitly — «بس», «فقط», «لكن», «الا» — so those split a clause exactly like a
full stop, and a negator can only reach the defect it was written about.
Separately, «مثل ما واضح بالصور» and «شخط ما يبين» contain a negator and negate
nothing; they are blanked before the test.

## What the script guarantees

1. **A field the seller answered is never overwritten.** Their word beats an
   inference from their own prose, always.
2. **Only fields the prose answers are written.** Nothing is deleted; the write
   merges.
3. **Dry run is the default**, and re-running after `--apply` fills nothing —
   verified on a seeded copy: 21 written, then 0.

Every one of the 253 answers above was read by hand against its listing before
this shipped. Seven errors were found that way and each became a rule and a
test; a self-check for «clean» or «none» written over an undenied defect word
now flags nothing real.

## What this deliberately does not do

- **Ask an LLM.** `listingInspect.js` already reads descriptions and photos
  with Claude and has the vocabulary this module borrows. It costs money per
  listing and needs a key on the box; the deterministic pass is free, testable,
  and auditable, and it is the one that should run first. The listings it
  leaves unanswered are the honest candidates for the model.
- **Guess from the `condition` field.** A listing marked `used` says nothing
  about whether the screen is cracked, and defaulting it to «سليمة» would
  invent an answer for every used phone on the marketplace.
- **Touch photos.** The inspector does that.
