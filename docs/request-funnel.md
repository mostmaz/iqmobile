# Request tab: look before you ask

The «اطلب جهاز» tab opens on a funnel — **brand → that brand's most-listed
models → those models' listings from the last 60 days** — with a floating
«اطلب جهاز آخر» that opens the request form pre-filled with whatever the buyer
was just looking at. The three-tab board (كل الطلبات / طلباتي / عروضي) is
unchanged and sits one tap away behind «طلباتي» in the header.

Most requests are for phones that are already for sale. Showing that first is
cheaper for everyone than a request nobody needed.

## The two things that had to be built

**`GET /listings/top-models?brand=&days=60&limit=10`.** The catalogue could
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
  60-day active pool proves thin for smaller brands: the Samsung sample had
  34 distinct models across its last 50 listings, so rank 10 is often a
  single listing.
- **Touch the board.** `RequestsScreen.tsx` moved behind a link; the compose
  sheet moved to `components/RequestComposeSheet.tsx` and gained two optional
  `initial*` props. Neither changed behaviour.
