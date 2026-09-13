// How often a saved search may interrupt someone.
//
// Measured in production over 14 days: 547 active searches produced 14,055
// alerts to 335 people — a median of 25 each, and four users got over 400.
// 495 listings were posted in that window, so those four were being told
// about 83% of everything on the marketplace. They opened NONE of it. The
// read rate across the whole kind was 1.8%.
//
// Three things were wrong and this module fixes all three:
//
//   1. 124 of the 547 searches carry no narrowing at all — no brand, no
//      model, no text. That is not a search, it is a subscription to the
//      entire marketplace, and it cannot be served one listing at a time.
//   2. The push cooldown was per SEARCH, so saving eight searches bought
//      eight times the interruptions. It belongs to the person.
//   3. Nothing ever noticed that a recipient had stopped opening them. 409
//      alerts and zero opens is the app failing to take a hint.
//
// Pure and dependency-free so `node --test` can load it: callers pass the
// counts in, this returns a decision.

/** Per-person, not per-search — see note 2 above. */
export const PUSH_COOLDOWN_MS = 60 * 60 * 1000;
/** Pushes per person per day, across all of their searches. */
export const MAX_PUSH_PER_DAY = 5;
/** Consecutive unopened alerts after which we stop pushing this person. */
export const UNOPENED_LIMIT = 10;

/**
 * Is this search narrow enough to justify alerting per listing?
 *
 * A brand alone counts: "tell me about new Samsungs" is a real request, and
 * at ~500 listings a fortnight it is a survivable volume. Nothing at all
 * does not count.
 */
export function isAlertable(criteria) {
  if (!criteria || typeof criteria !== 'object') return false;
  const has = (k) => criteria[k] !== undefined && criteria[k] !== null && String(criteria[k]).trim() !== '';
  return has('brand') || has('model') || has('q');
}

/**
 * @param opts.criteria        the saved search's parsed criteria
 * @param opts.pushesToday     pushes already sent to THIS USER today
 * @param opts.lastPushAt      when this user was last pushed, any search
 * @param opts.unopenedStreak  consecutive unopened saved-search alerts
 * @param opts.now
 * @returns {{record: boolean, push: boolean, reason: string}}
 *   `record` writes the in-app row — the buyer still finds it in their
 *   notifications list, which is where a match they did not want to be
 *   interrupted about belongs. `push` is the interruption.
 */
export function decideAlert({
  criteria, pushesToday = 0, lastPushAt = 0, unopenedStreak = 0, now = Date.now(),
} = {}) {
  // An un-narrowed search is dropped entirely rather than recorded: an
  // in-app list of "every listing on the site" is the browse feed with extra
  // steps, and writing 400 rows a fortnight per user to never be read is
  // just storage.
  if (!isAlertable(criteria)) return { record: false, push: false, reason: 'search_too_broad' };

  if (unopenedStreak >= UNOPENED_LIMIT) return { record: true, push: false, reason: 'not_reading' };
  if (pushesToday >= MAX_PUSH_PER_DAY) return { record: true, push: false, reason: 'daily_cap' };
  if (lastPushAt && (now - lastPushAt) < PUSH_COOLDOWN_MS) return { record: true, push: false, reason: 'cooldown' };

  return { record: true, push: true, reason: 'ok' };
}
