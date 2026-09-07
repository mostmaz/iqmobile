# Structured condition details (#7)

Four fixed questions — screen, body, repairs, water — stored as one
`condition_details_json` column on `phone_listings`.

## Why an enum and not more prose

The concepts already existed twice and could never be compared:

- `mobile/src/lib/listingQuality.ts` nagged for screen / body / repairs by
  running **regex over the description**.
- `server/src/listingInspect.js` already had a **defect vocabulary** the AI
  inspector uses to describe what it sees in the photos.

A paragraph and an enum cannot be checked against each other, so the seller's
account and the inspector's verdict lived in separate worlds. Every option a
seller can pick therefore maps to a `defects_json[].kind` — that is the whole
design, and `conditionDetails.test.js` fails if anyone adds an option whose
defect the inspector does not know.

## One column, not four

`accessories_json` is the precedent. The question set will grow and a
migration per question is not a plan.

## «غير معروف» is an answer

It is stored, it is distinct from unanswered, and it silences the prose nag.
Someone who bought the phone second-hand genuinely does not know whether the
screen was replaced; a form that forces a guess produces a listing that is
confidently wrong. It renders muted on the listing page so a buyer cannot
mistake "we don't know" for a fact.

## Confession vs contradiction

`annotateDisclosure` marks each prose-detected defect as declared or not.
A seller who ticks «الشاشة مكسورة» *and* writes about the crack is being
maximally honest; a seller who ticks «بلا خدوش» and writes about a crack is
not. Both still reach the review queue — nothing is suppressed — but an
operator can now tell them apart, and `contradicts` is keyed on **whether the
relevant question was answered**, not on whether any defect was declared.
That distinction is the bug the tests caught: ticking "clean" declares no
defect at all, so a check for "declared something" misses exactly the case
worth catching.

## What this deliberately does **not** do

- **Does not gate publishing.** Every question can be left blank and the
  listing still posts. Slots suggest; they never block.
- **Does not ask about a sealed phone.** `fieldsFor()` returns nothing for
  `new`/`sealed` — a boxed device has no repair history, and asking anyway
  teaches sellers the form is not paying attention.
- **Does not suppress the prose gate.** The wordlist still runs on the
  description; the structured answer only annotates what it finds.
- **Does not verify anything.** These are the seller's claims. The inspector
  is what checks them, and it stays independent on purpose.
- **Does not reject unknown questions.** A newer app sending a field this
  server has not learned drops that field rather than failing the save —
  losing a seller's whole form over an ignorable extra is never right.
