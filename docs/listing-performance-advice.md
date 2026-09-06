# Listing performance advice

Sellers now see what their listing's numbers mean, not just the numbers.

## The rule this follows

The operator dashboard has never been allowed to render a bare metric. From
`shopDiagnostics.js`: *"a weak metric never travels alone. Every row this produces
carries a reason_code, and the panel renders metrics only through the component that
demands one."* `DeviceDiagnostic` enforces it by taking `reason` as a required prop.

The app did not follow the same rule. "My listings" showed «١٢ مشاهدة · ٠ تواصل» and
stopped — a verdict with no verb. `ListingAdvice` now takes the whole advice object as
a required prop, so a number cannot reach the screen without its reason and its action.

## One verdict per listing

First match wins. A seller handed four things to fix does none of them.

1. **A buyer is waiting.** Ahead of everything else: a real person is on the other side
   now, and it is the only problem fixable in under a minute.
2. **Nobody is finding it** — fewer than 25 views in 30 days. Blamed on photos when
   photos are short, on reach otherwise.
3. **People look and nobody asks.** Price is named only when the daily job has a real
   comparison behind it (at least three same-model peers, more than 15% above the
   median); otherwise the advice says to review price, photos and description without
   pretending to know which.
4. **It is working.** Said out loud, because a seller who only ever hears from us when
   something is wrong learns to dread the screen.

A listing under three days old gets nothing at all. Silence is the honest answer for an
ad that has not had time to fail.

## Definitions that differ from the dashboard's

An **inquiry** is a contact tap *or* a buyer's chat message, following
`sellerSummaries.js`. `listing_diagnostics.contacts_30d` counts taps only, which misses
every buyer who used in-app chat — the channel the app pushes hardest.

A **reply** must come after the buyer's first message, so a seller's opening greeting is
not mistaken for an answer. This is the per-listing form of the shop-card measurement in
`routes/shops.js`, minus its five-conversation floor: that floor exists because a median
over four chats is a bad statistic, while "one buyer is waiting" is not a statistic at
all. A thread whose messages have aged past the 90-day purge is not counted as waiting —
there is nothing left to answer.

The seller's own views and taps never count.

## Scope

The daily diagnostics job now covers every seller with live stock, not only shops. Price
comparison needs a marketplace-wide scan and so cannot be computed on demand; without it
an individual seller could never be told their price is the problem.

Advice is attached only to active and reserved listings. A sold or expired ad cannot be
improved, and advising it would be noise.

Validation: 62 server tests and 12 mobile tests pass; mobile TypeScript is clean.
Verified on the simulator against seeded listings covering all four verdicts.
