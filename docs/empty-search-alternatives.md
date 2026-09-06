# Empty search results

A search that finds nothing now offers labelled alternatives instead of a dead end,
and a failed request is no longer reported as an empty marketplace.

## Error is not absence

Browse never read the query's error state, so once the retries were spent it showed
"لا توجد إعلانات" — telling a user whose phone had no signal that there was nothing
for sale. Offline and zero-results were identical, and the only way out was a
pull-to-refresh nobody thinks to try on a screen that looks legitimately empty. A
failed load now says so and offers a retry. The listing page had the same fault in a
different shape: a failed fetch left the loading skeleton shimmering forever, which
also made the server's own "not found" unreachable, so a deleted listing shimmered too.

The app distinguishes a stalled connection from an unreachable server, because the
two call for different advice. Both messages previously collapsed into one four-word
string.

## Alternatives are counted, and never applied on their own

The rule is the same one the price guidance follows: no broader location, different
size or higher budget is ever substituted silently. `GET /listings/search-alternatives`
answers only "here is what else exists". It returns, for each option, the number of
listings behind it and the exact filter change that would apply it; tapping is what
changes the search, and the screen says so.

Three kinds are offered: another storage size, a bordering governorate, and a ceiling
20% above the stated budget — the same slack the buyer-request matcher uses. Storage
values come from the listings themselves rather than a fixed list, because the server
matches storage exactly and an invented spelling would apply to nothing. Dropping the
governorate entirely is offered last, and only when it reaches stock the neighbours
cannot.

Counts obey the same visibility rules as the feed: drafts, removed and sold listings
are excluded, and expiry is honoured when that setting is on. A count that included
rows the feed hides would be exposed by the very next tap.

A different condition is deliberately not offered. Used instead of new is a different
product, not a nearby one.

## Governorate neighbours

Which provinces border which was written by hand; nothing in the codebase or database
described it. The list is mirrored between server and app the same way the Arabic
names already are, and a test asserts every edge is symmetric — a one-way border would
show a suggestion in one direction only.

## Saying why a search was narrow

Browse applies the user's own governorate on first open. Many dead ends are therefore
location-scoped by a filter nobody chose, so the empty state names the governorate and
says when the app picked it.

Validation: 48 server tests and 12 mobile tests pass, and mobile TypeScript is clean.
Verified on the simulator: with the server stopped Browse shows a retry rather than an
empty marketplace, and a search in Duhok offers Nineveh, Erbil and all governorates
with counts matching the API, applying only on tap.
