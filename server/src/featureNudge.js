// "Are you still interested in featuring your phone?"
//
// Only explicitly unpaid requests get the one-time reminder. Seller-reported
// transfers and legacy unknown payments must not be chased for a second
// payment. Opening the notification returns to the saved checkout.
import { db, now } from './db.js';
import { notify, versionAtLeast } from './notify.js';
import { pushTo } from './push.js';

const PENDING_MS = 24 * 3600 * 1000;

// Builds below this render `KIND_LABEL[kind] || kind`, so an inbox row would
// read as the literal string "feature.reminder". Same gate as
// listing.quiet / shop.review.* — the push always goes, because its title
// and body are server text and render on any build.
const REMINDER_UI_MIN_VERSION = '0.3.8';

const TITLE = 'تمييز الإعلان';
const BODY = 'هل ما زلت تريد أن تميّز إعلانك؟';

// Per-tick cap, matching expirer.js. After downtime the SELECT can match a
// backlog; sending them in one tight loop would hold the event loop on
// network calls while requests queue behind it.
const TICK_LIMIT = 50;

/**
 * One sweep. Returns how many reminders went out.
 *
 * Safe to call as often as you like: nudged_at is stamped for every row we
 * consider, including ones we could not reach, so an unreachable seller is
 * not re-selected on every tick for the life of the request.
 */
export async function nudgeStalePromotions() {
  const cutoff = now() - PENDING_MS;
  const rows = db.prepare(
    `SELECT f.id, f.listing_id, f.user_id, f.tier, f.amount, f.created_at,
            u.expo_push_token,
            (SELECT d.app_version FROM user_active_days d
              WHERE d.user_id = u.id ORDER BY d.day DESC LIMIT 1) AS app_version
       FROM feature_requests f
       JOIN users u ON u.id = f.user_id
       JOIN phone_listings l ON l.id = f.listing_id
      WHERE f.status = 'pending'
        AND f.payment_state = 'awaiting_payment'
        AND f.nudged_at IS NULL
        AND f.created_at <= ?
        -- Only a listing that could still BE featured. A phone that sold or
        -- expired while the request sat pending has nothing to promote, and
        -- asking its owner for money would be the worst message the app
        -- sends all week.
        AND l.status IN ('active', 'reserved')
      ORDER BY f.created_at ASC
      LIMIT ?`,
  ).all(cutoff, TICK_LIMIT);

  if (!rows.length) return 0;

  const stampOne = db.prepare('UPDATE feature_requests SET nudged_at=? WHERE id=?');
  let sent = 0;
  for (const r of rows) {
    // Stamped BEFORE the send. A push that throws must not leave the row
    // eligible forever — one missed reminder is better than a loop that
    // retries a dead token every fifteen minutes.
    stampOne.run(now(), r.id);
    try {
      if (versionAtLeast(r.app_version, REMINDER_UI_MIN_VERSION)) {
        notify(r.user_id, 'feature.reminder',
          { listing_id: r.listing_id, request_id: r.id },
          { title: TITLE, body: BODY });
        sent++;
      } else if (r.expo_push_token) {
        await pushTo([r.user_id], TITLE, BODY,
          { kind: 'feature.reminder', listing_id: r.listing_id, request_id: r.id });
        sent++;
      }
      // No token and an old build: nothing to do. The row is stamped either
      // way so it is not reconsidered.
    } catch (err) {
      console.error('[featureNudge] send failed for request', r.id, err?.message);
    }
  }
  if (sent) console.log(`[featureNudge] reminded ${sent} seller(s) about a pending promotion`);
  return sent;
}
