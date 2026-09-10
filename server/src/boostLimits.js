// How many rewarded boosts a seller may have, and when the next one is due.
//
// Pure: every function takes `db` and `now`, so the rolling window can be
// tested at its exact boundary instead of by sleeping. The marketplace has
// been burned by a client-side limiter before — `authLimiter` was IP-keyed,
// in-memory, and reset on every one of 155 pm2 restarts — so this one lives
// in SQL, keys on the user, and is re-checked inside the granting
// transaction rather than trusted from the request that started the ad.
//
// A ROLLING window, not a midnight reset. Resetting at midnight means the
// two boosts are worth more at 23:59 than at 00:01, which teaches sellers to
// wait rather than to post, and gives the ad network a spike it did not ask
// for. Rolling is also the only rule a seller cannot game by changing the
// device clock: every timestamp here is the server's.

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** What the settings mean when an operator has not said otherwise. */
export const BOOST_DEFAULTS = {
  maxPer24h: 2,
  minIntervalHours: 4,
  highlightHours: 4,
  topThreshold: 20,
};

/** Statuses that count as a boost the seller actually received. */
const SPENT = ['boosted', 'scheduled', 'completed'];

function intSetting(getSetting, key, fallback) {
  const n = Number(getSetting(key));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Read the operator's numbers, falling back to the defaults.
 *
 * Takes `getSetting` rather than importing it so the tests can pass a plain
 * object's lookup and never touch the real settings table.
 */
export function boostConfig(getSetting) {
  return {
    enabled: getSetting('rewarded_boost_enabled') === '1',
    maxPer24h: intSetting(getSetting, 'rewarded_boost_max_per_24h', BOOST_DEFAULTS.maxPer24h),
    minIntervalHours: intSetting(getSetting, 'rewarded_boost_min_interval_hours', BOOST_DEFAULTS.minIntervalHours),
    highlightHours: intSetting(getSetting, 'rewarded_boost_highlight_hours', BOOST_DEFAULTS.highlightHours),
    topThreshold: intSetting(getSetting, 'rewarded_boost_top_threshold', BOOST_DEFAULTS.topThreshold),
    adUnitAndroid: getSetting('admob_rewarded_unit_android') || '',
    adUnitIos: getSetting('admob_rewarded_unit_ios') || '',
  };
}

/**
 * What this seller is allowed to do right now.
 *
 * `nextAvailableAt` is the LATER of two clocks, and both matter:
 *   - the cooldown: last grant + minIntervalHours.
 *   - the window: the oldest grant inside 24h, plus 24h — the moment it
 *     falls out and frees its slot.
 * Reporting only the cooldown would tell a seller who has used both boosts
 * that they can go again in four hours, which is false and is exactly the
 * kind of countdown that makes people distrust the whole feature.
 */
export function boostAllowance(db, userId, cfg, now) {
  const windowStart = now - DAY;
  const rows = db
    .prepare(
      `SELECT granted_at FROM listing_boosts
        WHERE user_id=? AND granted_at IS NOT NULL AND granted_at > ?
          AND status IN (${SPENT.map(() => '?').join(',')})
        ORDER BY granted_at ASC`,
    )
    .all(userId, windowStart, ...SPENT)
    .map((r) => Number(r.granted_at));

  const used = rows.length;
  const remaining = Math.max(0, cfg.maxPer24h - used);
  const last = rows.length ? rows[rows.length - 1] : null;
  const oldest = rows.length ? rows[0] : null;

  const cooldownUntil = last != null ? last + cfg.minIntervalHours * HOUR : 0;
  const windowFreesAt = remaining > 0 ? 0 : (oldest != null ? oldest + DAY : 0);
  const nextAvailableAt = Math.max(cooldownUntil, windowFreesAt) || null;

  let reason = null;
  if (!cfg.enabled) reason = 'disabled';
  else if (remaining <= 0) reason = 'daily_limit';
  else if (now < cooldownUntil) reason = 'cooldown';

  return {
    used,
    remaining,
    max: cfg.maxPer24h,
    // Null once the seller may go again, so the client has nothing to count
    // down to rather than a stale timestamp in the past.
    nextAvailableAt: nextAvailableAt && nextAvailableAt > now ? nextAvailableAt : null,
    allowed: reason === null,
    reason,
  };
}

// ─── streaks ─────────────────────────────────────────────────────────
//
// "Consecutive days on which this seller used at least one boost."
//
// Days are BAGHDAD days, not UTC ones and not rolling 24-hour blocks. The
// allowance above is rolling because a rolling limit cannot be gamed; a
// streak is the opposite kind of number — it is a habit the seller is
// counting themselves, and a habit is measured in the calendar days they
// live in. Iraq is UTC+3 all year with no daylight saving, so the offset is
// a constant and no timezone library is needed.
const BAGHDAD_OFFSET_MS = 3 * HOUR;

/** Which Baghdad day a timestamp falls in, as a whole number of days. */
export function baghdadDay(ts) {
  return Math.floor((Number(ts) + BAGHDAD_OFFSET_MS) / DAY);
}

/** Baghdad midnight that ends the day `ts` falls in. */
export function nextBaghdadMidnight(ts) {
  return (baghdadDay(ts) + 1) * DAY - BAGHDAD_OFFSET_MS;
}

/**
 * The seller's current streak, and whether today already counts.
 *
 * Counts back from today. If nothing was boosted today the streak is still
 * alive as long as YESTERDAY has a boost — the day is not over, and telling
 * someone at 09:00 that their streak is zero when they still have fourteen
 * hours to save it is both wrong and the fastest way to make them stop
 * caring. It only breaks once a whole day passes with nothing.
 */
export function boostStreak(db, userId, now) {
  const rows = db
    .prepare(
      `SELECT DISTINCT granted_at FROM listing_boosts
        WHERE user_id=? AND granted_at IS NOT NULL
          AND status IN (${SPENT.map(() => '?').join(',')})
        ORDER BY granted_at DESC LIMIT 400`,
    )
    .all(userId, ...SPENT)
    .map((r) => baghdadDay(r.granted_at));

  const days = [...new Set(rows)];        // already descending
  const today = baghdadDay(now);
  const usedToday = days[0] === today;

  // Start from today if it counts, otherwise from yesterday — see above.
  let cursor = usedToday ? today : today - 1;
  let streak = 0;
  for (const d of days) {
    if (d > cursor) continue;             // shouldn't happen; ignore future
    if (d === cursor) { streak++; cursor--; continue; }
    break;                                // a gap: the streak ends here
  }
  return { streak, usedToday, dayEndsAt: nextBaghdadMidnight(now) };
}
