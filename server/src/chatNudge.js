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
// have sent well over a thousand. Every chat the message named is written
// to the ledger with it ('batched'); recording only the first let the next
// sweep chase the second, and one seller got three WhatsApps in fifty
// minutes about one buyer's three questions (2 Oct 2026).
//
// ONE per person per DAY, whatever arrives after. A buyer who writes about
// a fourth phone an hour later is news the seller will see when they open
// the app the first message sent them to.
//
// A number WhatsApp says it does not know is left alone for a month, not
// tried again with the seller's next chat.
//
// Only 2h–7d old. Two hours is the owner's rule (1 Oct 2026, down from a
// day): buyer interest fades fast, and a seller who has not looked in two
// hours is not about to. The ceiling is where a fact turns into nagging —
// past a week the buyer has bought elsewhere, and it also stops the first
// run after deploy from chasing a backlog of 2,458 chats older than that
// (measured 30 Sep 2026), which at one message per 15 minutes would take a
// month and read as a mail-out.
//
// Cancelled by opening the APP, not just the thread. Someone who has been
// in the app since the message arrived has seen the badge; a WhatsApp on
// top of that is a nag, and the ban risk is spent on the people who have
// not been in at all.
//
// 08:00–23:00 Baghdad only. A WhatsApp at 3am about a phone is worse than
// silence; what falls due overnight is simply still due at eight, and goes
// out then (freshest first).
import { db, now as dbNow, getSetting, setSettingValue } from './db.js';
import { sendWhatsApp, utilityConfigured, utilityProvider } from './whatsapp.js';

export const NUDGE_AFTER_MS = 2 * 60 * 60 * 1000;
export const NUDGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const QUIET_FROM_HOUR = 8;
export const QUIET_TO_HOUR = 23;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const PER_PERSON_COOLDOWN_MS = DAY;
export const NOT_ON_WHATSAPP_RETRY_MS = 30 * DAY;

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
// minutes, inside the 08:00–23:00 window = 60 a day at most, well under the
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
       -- Never twice to one person about one listing (the unique index),
       -- nor twice about one chat — belt and braces, since the ledger once
       -- failed to hold the second party's row at all.
       AND NOT EXISTS (
             SELECT 1 FROM chat_nudges n
              WHERE (n.listing_id = c.listing_id OR n.chat_id = c.id)
                AND n.user_id = CASE WHEN m.sender_id = c.buyer_id THEN c.seller_id ELSE c.buyer_id END)
       -- One message per person per day, and a number WhatsApp has said it
       -- does not know is not tried again for a month.
       AND NOT EXISTS (
             SELECT 1 FROM chat_nudges n2
              WHERE n2.user_id = CASE WHEN m.sender_id = c.buyer_id THEN c.seller_id ELSE c.buyer_id END
                AND (n2.created_at > ?
                     OR (n2.outcome IN ('not_on_whatsapp', 'bad_phone') AND n2.created_at > ?)))
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
       -- Opened the APP since the message arrived (any request from them,
       -- logged per day with its last moment) → the badge did the job; the
       -- reminder is cancelled, not merely postponed.
       AND COALESCE((SELECT MAX(d.last_seen) FROM user_active_days d
                      WHERE d.user_id = CASE WHEN m.sender_id = c.buyer_id THEN c.seller_id ELSE c.buyer_id END), 0)
           < m.created_at
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
     LIMIT 2000
  `).all(at - NUDGE_AFTER_MS, at - NUDGE_MAX_AGE_MS, at - PER_PERSON_COOLDOWN_MS, at - NOT_ON_WHATSAPP_RETRY_MS, onlyNoPush ? 1 : 0);

  // One per person, freshest first, plus the count of everything else of
  // theirs that is waiting — so the message can say "٣ محادثات" instead of
  // arriving three times. Two buyers on the SAME listing collapse here as
  // well as in the ledger, so the count is conversations, not listings.
  // The whole due set is read (it is bounded by the week), so the count is
  // exact and not whatever happened to fit in the first page.
  const byUser = new Map();
  for (const r of rows) {
    const seen = byUser.get(r.user_id);
    if (seen) {
      seen.waiting += 1;
      seen.others.push({ chat_id: r.chat_id, listing_id: r.listing_id });
      continue;
    }
    byUser.set(r.user_id, { ...r, waiting: 1, others: [] });
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
      // The other chats this one message is about — recorded with it.
      others: pick.others,
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
 *
 * A send that cannot be recorded is the one failure this file must never
 * hide: the sweep would find the same person due again fifteen minutes
 * later, and did (2 Oct 2026, when chat_id was the table's primary key and
 * a buyer's row collided with the seller's on the same chat). So the
 * result is checked, and `false` here stops the sweep.
 */
export function record(n, outcome, at) {
  const r = db.prepare(`
    INSERT INTO chat_nudges(chat_id, listing_id, user_id, phone, outcome, created_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT DO NOTHING
  `).run(n.chat_id, n.listing_id, n.user_id, n.phone, outcome, at);
  if (r.changes === 0) {
    console.error(`[chat-nudge] NOT RECORDED: chat=${n.chat_id} user=${n.user_id} listing=${n.listing_id} outcome=${outcome} — stopping the sweep`);
    return false;
  }
  return true;
}

/**
 * Mark the other chats a message named, so no later sweep chases them.
 * Non-fatal on conflict: two buyers on one listing are two chats but one
 * ledger key, and the first already holds it.
 */
export function recordBatch(n, at) {
  if (!n.others?.length) return 0;
  const main = db.prepare('SELECT id FROM chat_nudges WHERE user_id=? AND listing_id=?').get(n.user_id, n.listing_id);
  const ins = db.prepare(`
    INSERT INTO chat_nudges(chat_id, listing_id, user_id, phone, outcome, created_at, batch_id)
    VALUES(?,?,?,?,'batched',?,?)
    ON CONFLICT DO NOTHING
  `);
  let added = 0;
  for (const o of n.others) added += ins.run(o.chat_id, o.listing_id, n.user_id, n.phone, at, main?.id ?? null).changes;
  return added;
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
    const bot = utilityProvider?.()?.bot;
    console.warn(bot?.connection === 'logged_out'
      ? `[chat-nudge] ${due.length} chats due, but the WhatsApp number is logged out — re-link it from the dashboard`
      : `[chat-nudge] ${due.length} chats due, but no utility template configured`);
    return { considered: due.length, sent: 0, skipped: bot?.connection === 'logged_out' ? 'not_linked' : 'unconfigured' };
  }

  let sent = 0;
  for (const n of due) {
    const r = await sendWhatsApp(n.phone, {
      name: n.name, device: n.device, waiting: n.waiting, userId: n.user_id, role: n.role,
    }, { dryRun });
    // The bot dropped between the check above and this send. Nobody was
    // written to, so nobody is marked reminded — 94 people were, on 3–4 Oct
    // 2026, and lost their reminder for good. Stop and wait for a re-link.
    if (r.outcome === 'not_linked' || r.outcome === 'unconfigured') {
      console.warn(`[chat-nudge] stopped: ${r.outcome}, nothing recorded`);
      return { considered: due.length, sent, skipped: r.outcome };
    }
    if (r.ok) sent += 1;
    if (!record(n, r.outcome, at)) {
      // Something is wrong with the ledger. Better one unrecorded message
      // than a stream of them: switch the feature off until a person looks.
      setSettingValue('chat_nudge_enabled', '0');
      console.error('[chat-nudge] disabled itself: a send could not be recorded');
      return { considered: due.length, sent, skipped: 'ledger_failure' };
    }
    // Delivered (or would have been): the chats it named are now told too.
    if (r.ok) recordBatch(n, at);
  }
  console.log(`[chat-nudge] ${due.length} due, ${sent} ${dryRun ? 'dry-run' : 'sent'}`);
  return { considered: due.length, sent, dry_run: dryRun };
}

// ─── did it work? ──────────────────────────────────────────────────────
//
// Per reminder sent: did they open the thread within a day, did they answer,
// and how long the answer took — against the same kind of question before
// any reminder existed. Opened/replied are stamped by the chat routes the
// moment they happen (chat_nudges.opened_at / replied_at); older rows that
// predate the stamps are read off the chat instead.

function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
const hours = (ms) => Math.round((ms / HOUR) * 10) / 10;

/**
 * The comparison group: buyer questions in [from, to) that the seller had
 * NOT answered within NUDGE_AFTER_MS — exactly the population a reminder
 * is sent to — and how many of those were ever answered, and how fast.
 */
export function slowReplyBaseline(db_, from, to) {
  const rows = db_.prepare(`
    SELECT q.chat_id, q.asked,
           (SELECT MIN(r.created_at) FROM chat_messages r
             WHERE r.chat_id = q.chat_id AND r.sender_id = q.seller_id AND r.created_at > q.asked) AS replied
      FROM (SELECT c.id AS chat_id, c.seller_id, MIN(m.created_at) AS asked
              FROM chats c JOIN chat_messages m ON m.chat_id = c.id AND m.sender_id = c.buyer_id
             WHERE m.created_at >= ? AND m.created_at < ?
             GROUP BY c.id) q
  `).all(from, to);
  const slow = rows.filter((r) => !r.replied || r.replied - r.asked > NUDGE_AFTER_MS);
  const answered = slow.filter((r) => r.replied);
  return {
    from, to,
    questions: slow.length,
    replied: answered.length,
    replied_24h: answered.filter((r) => r.replied - r.asked <= NUDGE_AFTER_MS + DAY).length,
    median_reply_hours: median(answered.map((r) => hours(r.replied - r.asked))),
  };
}

/** Every reminder actually sent in the last `days`, with what came of it. */
export function nudgeOutcomes(db_, at, { days = 30 } = {}) {
  const since = at - days * DAY;
  const rows = db_.prepare(`
    SELECT n.chat_id, n.listing_id, n.user_id, n.created_at AS sent_at,
           n.opened_at AS stamped_opened_at, n.replied_at AS stamped_replied_at,
           CASE WHEN n.user_id = c.seller_id THEN 'seller' ELSE 'buyer' END AS role,
           CASE WHEN n.user_id = c.seller_id THEN c.seller_last_read_at ELSE c.buyer_last_read_at END AS read_at,
           (SELECT MAX(m.created_at) FROM chat_messages m
             WHERE m.chat_id = n.chat_id AND m.sender_id <> n.user_id AND m.created_at <= n.created_at) AS asked_at,
           (SELECT MIN(m.created_at) FROM chat_messages m
             WHERE m.chat_id = n.chat_id AND m.sender_id = n.user_id AND m.created_at > n.created_at) AS first_reply_at,
           COALESCE(NULLIF(u.shop_name, ''), u.display_name, '') AS name, l.brand, l.model
      FROM chat_nudges n
      JOIN chats c ON c.id = n.chat_id
      JOIN users u ON u.id = n.user_id
      JOIN phone_listings l ON l.id = n.listing_id
     WHERE n.outcome = 'sent' AND n.created_at >= ?
     ORDER BY n.created_at DESC
  `).all(since);

  const items = rows.map((r) => {
    const opened_at = r.stamped_opened_at
      || (r.read_at && r.read_at > r.sent_at ? r.read_at : null);
    const replied_at = r.stamped_replied_at || r.first_reply_at || null;
    return {
      chat_id: r.chat_id, listing_id: r.listing_id, user_id: r.user_id, role: r.role,
      name: r.name, device: [r.brand, r.model].filter(Boolean).join(' '),
      sent_at: r.sent_at, asked_at: r.asked_at,
      opened_at,
      opened_24h: !!opened_at && opened_at - r.sent_at <= DAY,
      replied_at,
      replied_24h: !!replied_at && replied_at - r.sent_at <= DAY,
      // From the question to the answer — the number the baseline measures.
      reply_hours: replied_at && r.asked_at ? hours(replied_at - r.asked_at) : null,
      // From the reminder to the answer — what the reminder can take credit for.
      reply_after_hours: replied_at ? hours(replied_at - r.sent_at) : null,
    };
  });

  // Before the first reminder ever went out: the thirty days up to it. With
  // none sent yet, the last thirty days — so the page already shows the
  // number the reminders will be measured against.
  const first = db_.prepare("SELECT MIN(created_at) AS t FROM chat_nudges WHERE outcome='sent'").get().t;
  const baselineTo = first || at;
  const baseline = slowReplyBaseline(db_, baselineTo - 30 * DAY, baselineTo);

  return {
    since,
    sent: items.length,
    opened_24h: items.filter((i) => i.opened_24h).length,
    opened_any: items.filter((i) => i.opened_at).length,
    replied: items.filter((i) => i.replied_at).length,
    replied_24h: items.filter((i) => i.replied_24h).length,
    median_reply_hours: median(items.map((i) => i.reply_hours)),
    median_reply_after_hours: median(items.map((i) => i.reply_after_hours)),
    baseline,
    items,
  };
}

/**
 * Stamps, from the chat routes. Opening the thread the reminder named, or
 * writing in it, is recorded on the reminder the first time it happens.
 * Never throws: a stamp must not cost anyone a message.
 */
export function noteNudgeOpened(chatId, userId, at = dbNow()) {
  try {
    // The chat itself, or the message that named it in a batch.
    db.prepare(`UPDATE chat_nudges SET opened_at=?
                 WHERE outcome='sent' AND opened_at IS NULL AND user_id=?
                   AND (chat_id=? OR id IN (SELECT batch_id FROM chat_nudges
                                             WHERE chat_id=? AND user_id=? AND outcome='batched'))`)
      .run(at, userId, chatId, chatId, userId);
  } catch { /* best-effort */ }
}
export function noteNudgeReplied(chatId, userId, at = dbNow()) {
  try {
    db.prepare(`UPDATE chat_nudges SET replied_at=?
                 WHERE outcome='sent' AND replied_at IS NULL AND user_id=?
                   AND (chat_id=? OR id IN (SELECT batch_id FROM chat_nudges
                                             WHERE chat_id=? AND user_id=? AND outcome='batched'))`)
      .run(at, userId, chatId, chatId, userId);
  } catch { /* best-effort */ }
}
