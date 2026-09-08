// How often one phone number may be sent a code.
//
// This is the only thing that actually STOPS a spend attack. There is no
// global daily ceiling by design — a budget breaker that misfires during real
// growth locks every new user out, which is a worse outage than the one it
// prevents. So enforcement lives here, per number, and the global picture is
// handled by logging and alerting instead.
//
// Why per-phone and not per-IP: `authLimiter` is already per-IP, and per-IP is
// the weaker half of the pair. It is defeated by rotating addresses, it is
// stored in memory so every process restart clears it (pm2 has restarted this
// app 155 times), and it is one shared instance across six auth routes so a
// login attempt spends the same budget as an OTP send. A phone number is the
// thing that actually costs money, so it is the thing to count.
//
// Pure except for the injected db and clock, so the tests can run an hour of
// traffic without waiting an hour or touching a network.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  // A user who did not get the message waits a minute. A script cannot spin.
  COOLDOWN_MS: 60 * 1000,
  // The owner's figure: one send plus one retry.
  PER_HOUR: 2,
  // Second bound, so 2/hour cannot quietly become 48/day. Worst case ~$1.44 a
  // day for a single number even if every send falls back to Zain SMS.
  PER_DAY: 8,
};

export function createSendLogTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS otp_send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      ip TEXT,
      channel TEXT,
      outcome TEXT NOT NULL DEFAULT 'sent',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_otp_send_log_phone ON otp_send_log(phone, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_otp_send_log_time ON otp_send_log(created_at DESC);
  `);
}

/**
 * May we send to this number right now?
 *
 * Returns `{ allowed: true }` or `{ allowed: false, error, retryAfterMs, rule }`.
 *
 * `retryAfterMs` exists because two-per-hour is tight enough that real people
 * will hit it. "Wait a bit" with no number is what makes someone uninstall;
 * the route turns this into a concrete minutes-remaining message.
 *
 * Only successful sends count against the limit. A refusal by the provider
 * cost nothing and must not consume the user's budget — otherwise an ARQAM
 * outage would lock everyone out for an hour on top of the outage itself.
 */
export function checkSendAllowed(db, phone, opts = {}) {
  const t = opts.now ?? Date.now();
  const rows = db.prepare(
    `SELECT created_at FROM otp_send_log
      WHERE phone=? AND outcome='sent' AND created_at > ?
      ORDER BY created_at DESC`,
  ).all(phone, t - DAY);

  if (rows.length === 0) return { allowed: true };

  const newest = rows[0].created_at;
  if (t - newest < LIMITS.COOLDOWN_MS) {
    return {
      allowed: false, error: 'otp_rate_limited', rule: 'cooldown',
      retryAfterMs: LIMITS.COOLDOWN_MS - (t - newest),
    };
  }

  const inHour = rows.filter((r) => r.created_at > t - HOUR);
  if (inHour.length >= LIMITS.PER_HOUR) {
    // Freed when the OLDEST send in the window ages out, not the newest.
    const oldest = inHour[inHour.length - 1].created_at;
    return {
      allowed: false, error: 'otp_rate_limited', rule: 'hour',
      retryAfterMs: HOUR - (t - oldest),
    };
  }

  if (rows.length >= LIMITS.PER_DAY) {
    const oldest = rows[rows.length - 1].created_at;
    return {
      allowed: false, error: 'otp_rate_limited', rule: 'day',
      retryAfterMs: DAY - (t - oldest),
    };
  }

  return { allowed: true };
}

export function recordSend(db, { phone, ip = null, channel = null, outcome = 'sent', now: t }) {
  db.prepare(
    'INSERT INTO otp_send_log(phone, ip, channel, outcome, created_at) VALUES(?,?,?,?,?)',
  ).run(phone, ip, channel, outcome, t ?? Date.now());
}

/**
 * Sends in the last hour, across all numbers.
 *
 * Not a limit — nothing refuses on this. It is the number the alert watches,
 * because a distributed flood across many numbers is exactly the shape the
 * per-phone rules above cannot see.
 */
export function sendsInLastHour(db, opts = {}) {
  const t = opts.now ?? Date.now();
  return db.prepare(
    "SELECT COUNT(*) AS n FROM otp_send_log WHERE outcome='sent' AND created_at > ?",
  ).get(t - HOUR).n;
}

/** Above this, something is wrong. ~4x the busiest real hour seen so far. */
export const ALERT_PER_HOUR = 60;

export function purgeSendLog(db, opts = {}) {
  const t = opts.now ?? Date.now();
  return db.prepare('DELETE FROM otp_send_log WHERE created_at < ?')
    .run(t - 30 * DAY).changes;
}
