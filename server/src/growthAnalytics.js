// Exact-day retention uses registration cohorts and completed Baghdad days.
// Historical registrations have no reliable timestamp and stay unknown.
const DAY = 86400000;
export const growthDay = ts => new Date(ts + 10800000).toISOString().slice(0, 10);
const startOfDay = day => Date.parse(`${day}T00:00:00+03:00`);
export function growthAnalytics(db, timestamp, days = 30) {
  const today = growthDay(timestamp);
  const start = growthDay(timestamp - (days - 1) * DAY);
  const since = startOfDay(start);
  const trackingStart = db.prepare("SELECT value FROM analytics_metadata WHERE key='registration_tracking_start'").get().value;
  const acquisition = db.prepare(`SELECT
    SUM(registered_at >= ?) AS registrations,
    SUM(guest_created_at >= ?) AS guests
    FROM users`).get(since, since);
  const series = db.prepare(`SELECT
    date(registered_at / 1000, 'unixepoch', '+3 hours') AS day,
    COUNT(*) AS registrations FROM users WHERE registered_at >= ? GROUP BY 1`).all(since);
  const guests = db.prepare(`SELECT
    date(guest_created_at / 1000, 'unixepoch', '+3 hours') AS day,
    COUNT(*) AS guests FROM users WHERE guest_created_at >= ? GROUP BY 1`).all(since);
  const active = db.prepare(`SELECT
    COUNT(*) AS total,
    COALESCE(SUM(u.is_guest=1),0) AS guests,
    COALESCE(SUM(u.is_guest=0),0) AS registered,
    COALESCE(SUM(EXISTS(SELECT 1 FROM user_active_days prior
      WHERE prior.user_id=a.user_id AND prior.day<a.day)),0) AS "returning"
    FROM user_active_days a JOIN users u ON u.id=a.user_id WHERE a.day=?`).get(today);
  // A buyer message counts, an empty chat or a seller reply does not.
  // UNION deduplicates buyers across calls, WhatsApp and chat messages.
  const contacts = db.prepare(`SELECT COUNT(*) AS buyers FROM (
    SELECT user_id AS id FROM events WHERE type IN ('contact_call','contact_whatsapp')
      AND user_id IS NOT NULL AND listing_id IS NOT NULL AND created_at >= ?
    UNION
    SELECT m.sender_id AS id FROM chat_messages m JOIN chats c ON c.id=m.chat_id
      WHERE m.sender_id=c.buyer_id AND c.buyer_id<>c.seller_id AND m.created_at >= ?
    )`).get(since, since).buyers;
  const retention = [1, 7, 30].map(day => {
    const counts = db.prepare(`SELECT COUNT(*) AS eligible,
      COALESCE(SUM(EXISTS(SELECT 1 FROM user_active_days a WHERE a.user_id=u.id
        AND a.day=date(u.registered_at / 1000, 'unixepoch', '+3 hours', ?))),0) AS returned
      FROM users u WHERE u.registered_at >= ? AND u.registered_at >= ?
        AND date(u.registered_at / 1000, 'unixepoch', '+3 hours', ?) < ?`)
      .get(`+${day} days`, since, trackingStart, `+${day} days`, today);
    return { day, ...counts, pct: counts.eligible ? Math.round(counts.returned / counts.eligible * 1000) / 10 : null };
  });
  return { tracking_start: trackingStart, acquisition: { registrations: acquisition.registrations || 0, guests: acquisition.guests || 0 },
    registrations_by_day: series, guests_by_day: guests, active_today: active,
    contact_buyers: contacts, retention, cohort_start: start, cohort_end: today };
}
