# Growth measurement

## Definitions

- Registered accounts: current non-guest account inventory, including historical and admin-imported accounts.
- Registrations: actual registration timestamps recorded by password signup, new phone signup, or guest promotion. Existing-account login is not registration. Admin-created/imported sellers do not count as organic registration.
- Guest creation: a guest-account creation event, preserved when that account registers. It is not a session or a unique person.
- Returning today: an account active today with at least one earlier observed active day. This includes guests and depends on historical activity coverage.
- Active registered/guest split: current account status, not status at the time of historical activity.
- Contact buyers: distinct account IDs with a tracked call/WhatsApp event or a message sent as the buyer in a listing chat during the selected Baghdad calendar window. Empty chats and seller replies are excluded. Anonymous events cannot be deduplicated and are excluded. External contact tracking depends on app version.
- DAU/MAU: activity frequency, not cohort retention.
- D1/D7/D30: percentage of registrations in the selected cohort window active on exactly registration day + N in Baghdad. Only cohorts whose target day has finished enter the denominator. Zero eligible users is unavailable, not 0%. Select 90 days to see mature D30 cohorts.

## Historical coverage and rollout

The additive database migration records its first-run timestamp and adds nullable registered_at and guest_created_at columns with indexes. Existing rows remain unknown: creation time cannot reconstruct prior guest conversions. No historical dates are fabricated or backfilled. Registration and guest counts are partial until their full windows have elapsed after rollout; the UI explains this and hides pre-tracking acquisition bars.

Deploy the server before the matching rebuilt admin dashboard, so the new response fields exist before the frontend uses them. Restarting the server runs the additive migration automatically. A database backup should accompany the normal deployment process. This change has only been implemented and tested locally; no production deployment was performed.

Validation: server tests include exact-day retention, immature cohorts, Baghdad date boundaries, channel deduplication, buyer-message semantics, and HTTP signup/guest-promotion/login timestamp behavior. Admin TypeScript check and production build pass.

## Proposed follow-up work (not implemented)

1. Seller contact: add a first-contact-within-7-days metric using listing cohorts with seven completed days, split by city, model, price band, seller type, and source. Audit listings with no contact for price, photo quality, stale inventory, and relevance before changing ranking. Measure an experiment against a control group; do not treat all registered buyers as failed sellers.
2. Search: record submitted searches separately from debounced suggestions/typing. Normalize Arabic and English model aliases and common misspellings; group by canonical model. Measure completed-search zero-result rate and subsequent listing/contact conversion. Distinguish query parsing failure from genuine missing supply before recruiting inventory.
3. Inspection: inspect stored error categories before attributing all 373 failures to credentials. Pause retries on authentication/billing failures and alert the operator. Retry transient rate-limit/network failures with capped exponential backoff, jitter, attempt counts, and concurrency limits. Resume a small batch after the cause is fixed; retain manual review and do not auto-reject devices because the inspection service is unavailable.
4. Retention: test opt-in saved-search, price-drop and matching-inventory notifications for buyers; relevant contact and listing-performance notifications for sellers. Evaluate D7/D30 by acquisition source and buyer/seller behavior, plus notification opt-outs.
5. Sales reporting: collect an explicit sold outcome with an on-platform/off-platform distinction and optional reason for removal. Treat contact attempts and marked-sold outcomes as separate funnel stages; neither proves paid transactions.

## Seven-day listing contact panel

The demand dashboard now includes a creation-cohort panel. For a selected duration N, the cohort is [now − 7 days − N days, now − 7 days). Each listing is observed for [creation, creation + 7 days). Recent immature listings are excluded, and removed/sold/expired listings remain included to avoid survivorship bias. This is based on record creation because a distinct publication timestamp is unavailable; imported inventory and delayed approvals can distort historical comparisons.

Success is at least one recorded call/WhatsApp tap or buyer-sent chat message in that window. Empty chats, seller replies, known seller taps/views, events before creation, and events at/after the seven-day endpoint are excluded. Anonymous taps are included as listing-level evidence, not deduplicated people. No completed sale is inferred.

For listings with no first-week contact, the panel separates views below versus at/above an adjustable 10/25/50 threshold (default 25). Views are event counts, not unique viewers. These are investigation categories, not proven causes or industry benchmarks. City/model/price/seller-type breakdowns show denominators and use current attributes; governorate and brand filters apply throughout the panel. The investigation list is capped at 100 with its total shown and includes current status, since listings may have received contact later.

No ranking, price, customer messaging, or inspection behavior is changed. Deploy the server response change before the matching admin bundle. Verification includes mature-window boundaries, empty cohorts, buyer-versus-seller message semantics, views within the window, threshold changes, and filter/breakdown consistency.
