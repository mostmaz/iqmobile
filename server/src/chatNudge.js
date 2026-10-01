// "Someone messaged you a day ago and you still haven't opened it."
//
// Why this exists, in numbers measured on production on 30 Sep 2026:
// 1,542 of the 1,873 chats with activity in the previous 30 days never got a
// reply from the seller; 1,317 sellers were sitting on a buyer message more
// than three days old; and 363 of those have no push token at all, so no push
// could ever have reached them. The push is sent once, at the instant the
// message arrives, and never again — a phone that is off at that moment never
// hears about the sale.
//
// WhatsApp is the fallback because it is the one address we hold for
// everybody: every one of those 363 unreachable sellers has a phone number.
//
// ── The rules, and why each one is here ─────────────────────────────────
//
// ONE per person per LISTING, ever, enforced by a unique index rather than
// by this query remembering to check. A chat is UNIQUE(listing_id, buyer_id),
// so three buyers asking about one phone are three chats — keyed on the chat,
// that seller would get three WhatsApps about the same device.
//
// ONE per person per sweep. A shop with twenty stale chats gets one message
// naming the count, not twenty messages. Without this the first run would
// have sent well over a thousand.
//
// Only 24h–7d old. The floor is the owner's rule: a day is long enough that
// the push has plainly failed. The ceiling is where a fact turns into
// nagging — past a week the buyer has bought elsewhere, and it also stops
// the first run after deploy from chasing a backlog of 2,458 chats older
// than that (measured 30 Sep 2026), which at one message per 15 minutes
// would take a month and read as a mail-out.
//
// Daytime only. Same 09:00–21:00 Baghdad window the retention pushes use. A
// WhatsApp at 3am about a phone is worse than silence.
import { db, now as dbNow, getSetting } from './db.js';
import { sendWhatsApp, utilityConfigured } from './whatsapp.js';

export const NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;
export const NUDGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const QUIET_FROM_HOUR = 9;
export const QUIET_TO_HOUR = 21;

// Pacing, and why it is this shape.
//
// Meta's throughput is not the constraint — the Cloud API takes 80 messages
// a SECOND. Two other numbers are:
//
//   • a new WhatsApp Business Account may start business-initiated
//     conversations with 250 unique people per rolling 24 hours. Go over and
//     the sends are refused, not queued.
//   • the number's quality rating, which recipients set by blocking or
//     reporting. Red rating cuts the limit and can suspend the number —
//     that, not rate, is what actually takes a business number down.
//
// So: a trickle, not a burst. One message per sweep, a sweep every 15
// minutes, inside the 09:00–21:00 window = 48 a day at most, well under the
// opening tier, and slow enough that a bad batch is visible in the outcome
// log long before it becomes 200 strangers.
export const PER_RUN_LIMIT = 1;
export const DAILY_CAP = 200;

/** Baghdad is UTC+3 all year — no DST — so a fixed offset is correct here. */
export function withinSendingHours(timestamp) {
  const hour = new Date(timestamp + 3 * 3600000).getUTCHours();
  return hour >= QUIET_FROM_HOUR && hour < QUIET_TO_HOUR;
}

/**
 * Chats owed a nudge right now.
 *
 * "Owed" means: the last word was the other party's, the recipient has never
 * opened it since, it has been sitting for a day, and we have not already
 * written to them about this chat.
 *
 * Exported for the test and for a dry-run count from the dashboard.
 */
export function pendingNudges(db_, at, { limit = PER_RUN_LIMIT, onlyNoPush = true } = {}) {
  const rows = db_.prepare(`
    SELECT c.id AS chat_id, c.listing_id,
           CASE WHEN m.sender_id = c.buyer_id THEN c.seller_id ELSE c.buyer_id END AS user_id,
           -- Who is being chased decides the wording: the seller is told a
           -- buyer is waiting, the buyer that the seller answered.
           CASE WHEN m.sender_id = c.buyer_id THEN 'seller' ELSE 'buyer' END AS role,
           m.created_at AS waiting_since,
           l.brand, l.model
      FROM chats c
      JOIN chat_messages m ON m.id = (
            SELECT id FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1)
      JOIN phone_listings l ON l.id = c.listing_id
     WHERE c.closed_at IS NULL
       AND m.created_at <= ? AND m.created_at >= ?
       -- the recipient has not opened the thread since that message landed
       AND COALESCE(CASE WHEN m.sender_id = c.buyer_id THEN c.seller_last_read_at
                         ELSE c.buyer_last_read_at END, 0) < m.created_at
       AND NOT EXISTS (
             SELECT 1 FROM chat_nudges n
              WHERE n.listing_id = c.listing_id
                AND n.user_id = CASE WHEN m.sender_id = c.buyer_id THEN c.seller_id ELSE c.buyer_id END)
       -- Only people a push could never have reached. Someone WITH a token
       -- was already told the moment the message arrived; writing to them
       -- again on WhatsApp is a second nag, and the ban risk is spent on the
       -- one group that does not need it. Off by setting for the day the
       -- owner wants everyone.
       AND (? = 0 OR (SELECT expo_push_token FROM users
                       WHERE id = CASE WHEN m.sender_id = c.buyer_id THEN c.seller_id ELSE c.buyer_id END) IS NULL)
       -- Someone who never opened the app has no inbox to open. Accounts
       -- created from imported listings — 231 of the 1,346 sellers with an
       -- active listing on 1 Oct 2026 — would be told «افتح التطبيق» about
       -- an app they never installed. A push token also proves an install,
       -- for the few who predate the activity log.
       AND (EXISTS (SELECT 1 FROM user_active_days d
                     WHERE d.user_id = CASE WHEN m.sender_id = c.buyer_id THEN c.seller_id ELSE c.buyer_id END)
            OR (SELECT expo_push_token FROM users
                 WHERE id = CASE WHEN m.sender_id = c.buyer_id THEN c.seller_id ELSE c.buyer_id END) IS NOT NULL)
       -- A thread with no message at all never reaches here: the JOIN above
       -- needs a last message. A quick-reply chip IS a message — however
       -- fast it was tapped, the seller was asked and never saw it (owner's
       -- call, 1 Oct 2026; the app now stops the accidental taps itself).
     -- Freshest first. The buyer who wrote yesterday is still shopping; the
     -- one who wrote six days ago has very likely bought elsewhere, and with
     -- one message per quarter hour the queue never reaches everyone anyway.
     -- Oldest-first spent the day's budget on the coldest leads and, because
     -- the seven-day ceiling slides, the "next" name changed every few
     -- minutes as messages aged out of the window.
     ORDER BY m.created_at DESC
     LIMIT ?
  `).all(at - NUDGE_AFTER_MS, at - NUDGE_MAX_AGE_MS, onlyNoPush ? 1 : 0, limit * 4);

  // One per person, freshest first, plus the count of everything else of
  // theirs that is waiting — so the message can say "٣ محادثات" instead of
  // arriving three times. Two buyers on the SAME listing collapse here as
  // well as in the ledger, so the count is conversations, not listings.
  const byUser = new Map();
  for (const r of rows) {
    const seen = byUser.get(r.user_id);
    if (seen) { seen.waiting += 1; continue; }
    byUser.set(r.user_id, { ...r, waiting: 1 });
  }

  const out = [];
  for (const pick of byUser.values()) {
    const u = db_.prepare(
      'SELECT id, display_name, shop_name, phone, expo_push_token, is_guest FROM users WHERE id=?',
    ).get(pick.user_id);
    // A guest has no phone, only a "guest:…" placeholder — nothing to write
    // to, and the attempt would still burn a ledger row.
    if (!u || !u.phone || u.is_guest || u.phone.startsWith('guest:')) continue;
    out.push({
      role: pick.role,
      chat_id: pick.chat_id,
      listing_id: pick.listing_id,
      user_id: pick.user_id,
      phone: u.phone,
      name: u.shop_name || u.display_name || '',
      device: [pick.brand, pick.model].filter(Boolean).join(' '),
      waiting: pick.waiting,
      waiting_since: pick.waiting_since,
      has_push_token: !!u.expo_push_token,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** How many went out in the last 24h — the WABA tier is a rolling window. */
export function sentInLast24h(db_, at) {
  return db_.prepare(
    "SELECT COUNT(*) AS n FROM chat_nudges WHERE created_at > ? AND outcome IN ('sent','dry_run')",
  ).get(at - 24 * 60 * 60 * 1000).n;
}

/**
 * Record the attempt. The unique index on (user_id, listing_id) is what makes
 * "once, ever" true; DO NOTHING covers the race where two sweeps overlap.
 */
function record(n, outcome, at) {
  db.prepare(`
    INSERT INTO chat_nudges(chat_id, listing_id, user_id, phone, outcome, created_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT DO NOTHING
  `).run(n.chat_id, n.listing_id, n.user_id, n.phone, outcome, at);
}

/**
 * One sweep. Returns { considered, sent, skipped } for the log.
 *
 * Off by default (chat_nudge_enabled='0') and, once on, still a dry run
 * (chat_nudge_dry_run='1') until an operator has read a run's log and agrees
 * with who it picked.
 */
export async function runChatNudges({ at = dbNow() } = {}) {
  if (getSetting('chat_nudge_enabled') !== '1') return { considered: 0, sent: 0, skipped: 'disabled' };
  if (!withinSendingHours(at)) return { considered: 0, sent: 0, skipped: 'quiet_hours' };

  const dailyCap = Number(getSetting('chat_nudge_daily_cap')) || DAILY_CAP;
  const already = sentInLast24h(db, at);
  if (already >= dailyCap) {
    console.warn(`[chat-nudge] 24h cap reached (${already}/${dailyCap})`);
    return { considered: 0, sent: 0, skipped: 'daily_cap' };
  }

  const perRun = Math.max(1, Number(getSetting('chat_nudge_per_run')) || PER_RUN_LIMIT);
  const dryRun = getSetting('chat_nudge_dry_run') !== '0';
  const onlyNoPush = getSetting('chat_nudge_only_no_push') !== '0';
  const due = pendingNudges(db, at, { limit: Math.min(perRun, dailyCap - already), onlyNoPush });
  if (due.length === 0) return { considered: 0, sent: 0 };

  if (!utilityConfigured()) {
    // Deliberately NOT recorded: an unconfigured run must not burn the
    // one-per-chat budget, or the day the template is approved every chat it
    // looked at is already marked done.
    console.warn(`[chat-nudge] ${due.length} chats due, but no utility template configured`);
    return { considered: due.length, sent: 0, skipped: 'unconfigured' };
  }

  let sent = 0;
  for (const n of due) {
    const r = await sendWhatsApp(n.phone, {
      name: n.name, device: n.device, waiting: n.waiting, userId: n.user_id, role: n.role,
    }, { dryRun });
    record(n, r.outcome, at);
    if (r.ok) sent += 1;
  }
  console.log(`[chat-nudge] ${due.length} due, ${sent} ${dryRun ? 'dry-run' : 'sent'}`);
  return { considered: due.length, sent, dry_run: dryRun };
}
