# Request tab: look before you ask

The «اطلب جهاز» tab opens on a funnel — **brand → that brand's most-listed
models → those models' listings from the last year** — with a floating
«اطلب جهاز آخر» that opens the request form pre-filled with whatever the buyer
was just looking at. The three-tab board (كل الطلبات / طلباتي / عروضي) is
unchanged and sits one tap away behind «طلباتي» in the header.

Most requests are for phones that are already for sale. Showing that first is
cheaper for everyone than a request nobody needed.

## The two things that had to be built

**`GET /listings/top-models?brand=&days=365&limit=10`.** The catalogue could
not do this job: `/device-catalog/devices` ranks membership, so a model with no
listings sorts level with one that has fifty, and tapping it lands on nothing.
This ranks by listings posted in the **same window the next step displays**,
which is the whole guarantee: a chip can never open onto an empty list.

**`model_exact=1` on `GET /listings`.** The existing `model=` is `LIKE '%…%'`,
so a chip for `iPhone 13` would return every `iPhone 13 Pro Max`. With the flag
both the stored model and the bound parameter go through `arabicNormalizeSql`
— **the same SQL function `/top-models` grouped on** — so what was grouped and
what is filtered cannot disagree. `modelExact.test.js` runs the real
expression against a real table; the first test is the `LIKE` over-match,
pinned.

## Rules that look like details and are not

- **Sold and expired are excluded** from both steps. The funnel answers "what
  can I buy"; dead stock in the top ten is the dead end by another road.
- **The chip label is the spelling sellers use most**, chosen in JS. SQLite's
  value for a bare column in `GROUP BY` is arbitrary, and a chip whose wording
  changes between refreshes looks broken.
- **A call-for-price row never becomes `min_price`.** Its sentinel
  `asking_price=1` would put "from 1 د.ع" on a chip — the bug #9 removed from
  the cards, and it must not return here.
- **«أخرى» means "the rest", not the brand called Other.** The catalogue has a
  literal `Other` brand with real listings; it appears as a row in the modal
  like any other. The pill opens the remaining brands ordered by real supply.
- **Head brands the server doesn't have are skipped, never invented.** A pill
  for an unknown brand would filter on a name the server ignores and silently
  return everything.

## What this deliberately does **not** do

- **Merge spellings that differ by a word.** `Galaxy S26 Ultra` and
  `S26 Ultra` stay two chips. The leading-line-word canonicalisation that
  would join them is done against the catalogue in `listingNameNormalize.js`,
  and the project notes record it once renaming an Apple Watch to an iPhone.
  Grouping here is the search fold only: case, Arabic orthography, digits,
  whitespace.
- **Rank by demand.** Supply-based by decision. The views/contacts query
  exists at `shopAdmin.js` `/top-devices` if that is ever wanted.
- **Include sold listings as price references.** See above. Revisit if the
  active pool proves thin for smaller brands: the Samsung sample had
  34 distinct models across its last 50 listings, so rank 10 is often a
  single listing.
- **Touch the board.** `RequestsScreen.tsx` moved behind a link; the compose
  sheet moved to `components/RequestComposeSheet.tsx` and gained two optional
  `initial*` props. Neither changed behaviour.

## One step at a time

Each step **replaces** the one before it. Brand cards, then that brand's
device cards, then that device's listings. Stacking them instead — the first
attempt — put three rows of brand cards plus five rows of device cards above
the listings, about 1100pt of chooser on a 390pt screen, so the answer a buyer
asked for opened below all of it.

Every step is a **card**: 2-up, 18pt corner, 1.5pt border, a picture well over
a name-and-count row. Text chips were the first attempt at both chooser steps
and they read as a different screen from the design, which is why this is
written down.

- **Brands** — logo well, name, listing count. «أخرى» is dashed so it does not
  read as an eighth brand.
- **Devices** — the same card with the **newest listing's photo** in the well.
  `image_path` already comes back from `/top-models`, so the photo costs no
  extra request, and a buyer recognises the phone by sight long before they
  parse "Galaxy S24 Ultra".
- **Listings** — filters, the price line, the cards.

**The window is a year, for the ranking and the list alike.** Which devices a
brand is known for is a slow fact, and a 60-day ranking let one busy fortnight
decide the top ten. Both steps use the same number on purpose: a device card
opening onto an empty list is the one failure this ranking exists to prevent,
and two different windows is exactly how that happens. Listings stay
active-or-reserved only, so a wider window means more stock, not stale stock.

**The device card carries a price range**, from `min_price`/`max_price` on the
same ranking response — the same real-price filter, so a call-for-price row
cannot become either end, and both null means no line rather than a dash
between two blanks. The figures are abbreviated (`1.07م – 1.7م`): two full IQD
prices do not fit the ~146pt of usable width on a half-width card and wrap
under the device name. Equal ends print once; "900ألف – 900ألف" reads as a
bug.

**Back is the header's own arrow**, in the slot the iQ badge normally holds:
leading edge, beside the title, with «طلباتي» keeping the other side. It walks
one step back. There is deliberately no second control that does the same
thing.

**The header carries the identity of the step, and is the only thing that
does.** Title and eyebrow are «اطلب جهاز / شوف الموجود أولاً», then
«Samsung / اختر الجهاز», then «Galaxy S25 Ultra / Samsung». A summary card
under that header printed the same two lines twice, so it was removed.

## Brand logos

Three sources, in order: an operator's upload wins, then the mark bundled with
the app, then the brand's initial rendered in the same tile — a
deliberate-looking card, never an empty box or a broken-image glyph.

`mobile/assets/brands/` ships the seven head brands, from Wikimedia Commons
and the English Wikipedia file pages at 256px on the long edge, alpha-trimmed,
about 42KB in total. Six are tagged public domain as below the threshold of
originality; Samsung's wordmark is CC BY 4.0. They remain manufacturer
trademarks and identify the brand whose phones a listing is for.

An earlier version of this file said the app would never ship them, on the
grounds that trademark use is the operator's call. That is answered by the
override above, not by shipping nothing: with zero of twenty-two logos
uploaded the grid was seven letters, and the owner asked for the marks. An
operator who wants a different one uploads it and the bundled file stops being
used.

`PATCH /admin/brands/:id` also accepts `logo_path`, restricted to a
`/uploads/…` path: an off-site URL there would put a third-party host in every
buyer's brand grid, and `null` is how a logo is removed.
