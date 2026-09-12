# The requests view: two counts that must never become one

«طلبات الأجهزة» in the console is the demand side of the site. Every other
page there measures what the marketplace HAS; this one measures what somebody
came asking for. Each request carries two numbers, and the whole page exists
because they answer different questions:

- **أجهزة مطابقة** — listings live right now that satisfy the request.
- **عروض** — sellers who actually replied to it.

A request with devices and no offers is a **broadcast that failed**: the
phones are on the site and the sellers holding them said nothing. That is a
nudge — the detail view names those sellers and their phone numbers. A request
with neither is **unmet demand**: stock nobody carries, i.e. an import
decision. Merged into one "unanswered" column the two look identical and lead
to opposite work, so the table never merges them and the KPI row counts them
apart (`بدون أي عرض` alongside `طلب بلا جهاز مطابق`).

## One matching rule, read from both ends

`requestMatch.js` holds it. `requestsAnsweredBy` answers "which open requests
does this new listing satisfy" and drives the seller push; `listingsAnsweringRequest`
answers "what is on the site for this request" and drives both the broadcast's
own seller list (`sellersWithMatchingListing` in `phoneRequests.js`) and every
count on this page.

They were two copies of the same rule until this page needed one. The failure
mode of two copies is specific: the console reports supply the broadcast never
used, so an operator chases "seven sellers ignored this" when the seven were
never told.

What the rule is, precisely:

- same brand, and the **folded** model — `savedSearches.norm`, so "iPhone 13"
  and «ايفون ١٣» are one device and "iPhone 13 Pro Max" is not;
- `asking_price ≤ max_price × 1.2` — the broadcast's own `CEILING_SLACK`. A
  stated budget is an opening position, so stock a little over it is still a
  lead, flagged `فوق السقف` rather than hidden;
- `active` or `reserved`, never a draft, and never the buyer's own listing.

`matched_in_budget` re-counts the same rows against the buyer's stated ceiling
with no slack, because "6 devices, 2 within budget" is a different sentence
from "6 devices".

**A call-for-price listing (`asking_price = 1`) is a device, never a price.**
It counts in `matched_devices`, appears as `بالاتصال`, and is excluded from
`matched_in_budget` and from `cheapest_match` — the sentinel against a ceiling
satisfies every request ever written, and "from 1 د.ع" on a dashboard is the
bug #9 removed from the cards.

## Live, not open

`status='open'` is not the same as visible. The expirer is a lazy sweep, so a
request whose window has passed can still be sitting at `open`. The list's
default tab is **الحية** (`status='open' AND expires_at > now`), the same
predicate `requestPulse.js` counts on, and the page reports the difference
(`open_awaiting_expiry`) rather than quietly counting demand no seller can see.

## What is exact and what is scanned

The totals — by status, by age, offers, answer rate, median first response —
are SQL over the whole table and always exact. The supply figures cannot be:
the model fold runs in JS, so they are computed over a scanned window (600
requests for the summary, 300 for the landing overview, 500 for the list's
`unmatched=1` filter). Every response carries `scan_capped`, and the page says
so on screen. A dashboard that silently reported a smaller site than it has
would be worse than one that admits its bound.

Supply for a page of requests is **one query per distinct brand**, bucketed by
folded model, then arithmetic per row — not one query per request. Fifty rows
used to mean fifty scans of the brand index.

## Offers are counted from the rows

`phone_requests.offer_count` is denormalised and maintained by the offer
create/withdraw paths only. The app renders that counter; this page counts
`request_offers` directly and reports the difference as `offer_count_drift`.
Zero everywhere means those paths are holding. Anything else is a bug with a
request id already attached to it.

Withdrawn offers stop counting as answers but stay on the record — a seller
who quoted and pulled out is not the same as one who never replied, and the
detail view shows both.

## Read-only, deliberately

There is no admin button to close, fulfil or reopen a request. A request
belongs to the buyer who posted it, and the close/fulfil paths carry his rate
limits and his notifications; an admin control that reached past them would be
a bug filed later. The console's job here is to tell the operator which phones
to buy and which sellers to call.
