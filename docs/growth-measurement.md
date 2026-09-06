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

## Search quality

Shops device search retains debounced previews but records them as search_preview. Pressing the search key/button or choosing a suggested model creates a search_submit request ID. A database uniqueness constraint deduplicates retries/refetches, and pagination does not log searches. Unclassified older-client requests retain the legacy search type. Dashboard rankings and zero-result rates now use search_submit only; legacy/previews are displayed separately. A failed match-count query records unknown instead of zero.

Matching adds a small explicit brand-typo map and phrase aliases (for example Realme/reaalme and Arabic GT). Zero-result suggestions are opt-in alternatives from visible active/reserved shop inventory in the selected governorate. Fuzzy suggestions allow one edit in alphabetic tokens of at least four characters, never fuzzy numeric tokens; requested numeric components must occur exactly in the candidate. Users choose the suggestion rather than having a different model silently substituted.

Search outcomes count subsequent listing views and contact taps/buyer messages for a known account until its next submitted search or 30 minutes, whichever comes first. Searches younger than 30 minutes and anonymous searches are excluded from this denominator. This is temporal association, not attribution to the search results or proof of sale. Search statistics are global for the selected period; governorate/brand filters remain listing-panel filters. Exact result-click attribution requires a future search-ID link on downstream events.

Rollout: server first (additive events search_request_id migration), then the admin bundle and mobile update. Existing mobile versions cannot provide explicit submission intent, so their requests stay outside the new rate. No production deployment or mobile release was performed by this change.

## Retention alerts and preferences

Existing saved-search, wish-list, and price-watch subscriptions now share retention delivery controls. Their per-subscription opt-ins remain required; account preferences can disable match or price alerts globally. Existing subscribed alerts default enabled for compatibility. Message pushes have a separate switch and are not subject to promotional limits; messages remain in the inbox even with pushes disabled. Orders and other service notifications are unchanged.

Retention pushes run only 09:00–21:00 Baghdad, at most once an hour and 1/3/5 times per Baghdad day (default 3). Quiet-hour and capped notifications remain inbox-only, not queued for a later burst. Persistent keys deduplicate saved-search/wish-list matches across both kinds for the same listing, and price alerts for the same listing/price. The ledger records permitted push attempts, not delivery receipts; provider failures or missing device tokens may mean no notification reaches a device.

The Notifications screen provides preferences and optional weekly seller summaries. Summaries default off, start after seven days of opt-in, and summarize views and contacted listings among currently active inventory over the preceding week. An hourly worker checks up to 100 due sellers, uses durable deduplication, and never labels missing contact as proof of an unsellable item. It does not send if there is no active inventory. Push/inbox taps open the relevant listing, message inbox, or My Listings.

Evaluation participation is a separate voluntary opt-in while summaries are enabled. A stable hash assigns participating accounts equally to summary/control groups. Control withholds only the NEW weekly summary; existing buyer and chat alerts remain unchanged. Opting out restores ordinary preference behavior. Original enrollment and group persist for descriptive intention-to-treat reporting, including withdrawals; reenrollment does not reset the cohort. Daily activity reporting compares exact-day D7/D30 returns, first-week seller contact incidence, and current withdrawal counts. Immature days are excluded. D7/first-week contacts are early baseline signals because summaries begin after a week; D30 is the more relevant post-exposure measure. These counts do not establish statistical significance, notification delivery, or completed sales. Participation can initially be limited operationally to a small invited group; no users are automatically enrolled.

Deployment order: server/migrations, admin dashboard, then mobile release. New summary opt-ins require the new mobile controls; this code change does not enroll existing users or send a production campaign. Tests cover ownership/validation, immediate opt-out, shared deduplication, quiet hours, hourly/daily limits, unaffected service notifications, stable assignment, and mature-cohort accounting.
