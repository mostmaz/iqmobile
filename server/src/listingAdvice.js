// Why a listing is doing badly, and the one thing to do about it.
//
// The numbers already existed — views and contacts have been counted since
// launch, and shopDiagnostics has been turning them into reason codes for the
// merchant panel for months. What was missing is that the SELLER never saw any
// of it. MyListingsScreen renders «👁 12 مشاهدة · 📞 0 تواصل» and stops there,
// which is precisely what shopDiagnostics.js:3-6 forbids on the operator side:
//
//     "a weak metric never travels alone. Every row this produces carries a
//      reason_code, and the panel renders metrics only through the component
//      that demands one."
//
// admin-web enforces that in code — DeviceDiagnostic takes `reason` as a
// required prop. This module is the app's half of the same bargain: it never
// returns a number without a reason and an action attached.
//
// One advice per listing, first match wins. Not a list of everything wrong:
// a seller given four things to fix does none of them.

const DAY = 86400000;

// A listing needs time before silence means anything. Below this we say
// nothing at all rather than telling someone their two-hour-old ad is failing.
const MIN_AGE_DAYS = 3;

// The window every count below is measured over.
const WINDOW_DAYS = 30;

// Fewer views than this in the window reads as "nobody is finding it".
// Same number as listingContactAnalytics's `threshold`, deliberately: one
// value to tune rather than two that drift. Looser here because that one
// counts a listing's first week and this one rolls.
const LOW_VIEWS = 25;

// Above the median for the same brand+model+storage. Matches
// shopDiagnostics.PRICE_HIGH_PCT — the same fact should not have two answers.
const PRICE_HIGH_PCT = 15;

// The listing form asks for three. Below it, photos are the cheapest fix
// available and almost certainly the binding one.
const MIN_PHOTOS = 3;

/**
 * Inquiries and unanswered inquiries for one listing.
 *
 * "Inquiry" follows sellerSummaries.js: a contact tap OR a buyer's chat
 * message. listing_diagnostics.contacts_30d counts taps only, which misses
 * every buyer who used the in-app chat — the channel the app pushes hardest.
 *
 * Reply detection is the per-listing form of the shop-card measurement in
 * routes/shops.js: t0 is the buyer's first message, and a reply only counts
 * if it came AFTER it, so a seller's opening greeting is not mistaken for an
 * answer. Unlike the shop card there is no minimum sample — that floor exists
 * because a median over four chats is a bad statistic, while "one buyer is
 * waiting" is not a statistic at all, it is a fact worth acting on.
 */
function inquiryState(db, listing, since) {
  const chats = db.prepare(
    'SELECT id, buyer_id FROM chats WHERE listing_id=? AND buyer_id<>?',
  ).all(listing.id, listing.seller_id);

  const firstBuyerMsg = db.prepare(
    'SELECT MIN(created_at) AS t FROM chat_messages WHERE chat_id=? AND sender_id=?',
  );
  const firstReplyAfter = db.prepare(
    'SELECT MIN(created_at) AS t FROM chat_messages WHERE chat_id=? AND sender_id=? AND created_at > ?',
  );

  let asked = 0;
  let unanswered = 0;
  let oldestWaiting = null;
  for (const c of chats) {
    const t0 = firstBuyerMsg.get(c.id, c.buyer_id)?.t;
    // No buyer message: either the thread was opened and abandoned, or its
    // messages aged past the 90-day purge in shopJobs. Neither is an inquiry
    // anyone can still answer.
    if (!t0) continue;
    asked++;
    const t1 = firstReplyAfter.get(c.id, listing.seller_id, t0)?.t;
    if (!t1) {
      unanswered++;
      if (oldestWaiting == null || t0 < oldestWaiting) oldestWaiting = t0;
    }
  }

  const taps = db.prepare(
    `SELECT COUNT(*) AS n FROM events
      WHERE listing_id=? AND type IN ('contact_call','contact_whatsapp')
        AND created_at > ? AND (user_id IS NULL OR user_id <> ?)`,
  ).get(listing.id, since, listing.seller_id).n;

  return { chats_asked: asked, unanswered, oldest_waiting_at: oldestWaiting, taps };
}

/**
 * One piece of advice for one listing, or null when there is nothing honest
 * to say. `listing` needs id, seller_id, created_at, asking_price,
 * price_on_request, brand, model, storage.
 *
 * Returns `{ id, severity, metric, reason, action }` — `metric` is the number
 * that prompted it and is never returned without `reason` and `action`.
 */
export function listingAdvice(db, listing, opts = {}) {
  const t = opts.now ?? Date.now();
  const since = t - WINDOW_DAYS * DAY;

  // A missing id or timestamp is not an old listing. `t - null` is `t`, which
  // would read as an ad posted in 1970 and sail past the age gate into advice
  // about a row we know nothing about — so check rather than let arithmetic
  // invent an answer.
  if (!Number.isFinite(listing?.id) || !Number.isFinite(listing?.created_at)) return null;

  const ageDays = Math.floor((t - listing.created_at) / DAY);

  // Too young to judge. Silence is the honest answer, not a green tick.
  if (ageDays < MIN_AGE_DAYS) return null;

  const views = db.prepare(
    `SELECT COUNT(*) AS n FROM events
      WHERE listing_id=? AND type='view' AND created_at > ?
        AND (user_id IS NULL OR user_id <> ?)`,
  ).get(listing.id, since, listing.seller_id).n;

  const photos = db.prepare('SELECT COUNT(*) AS n FROM listing_images WHERE listing_id=?')
    .get(listing.id).n;

  const inq = inquiryState(db, listing, since);
  const inquiries = inq.chats_asked + inq.taps;

  // ── 1. someone is waiting ───────────────────────────────────────────
  // Ahead of everything else because it is the only one where a real person
  // is on the other side right now, and the only one the seller can fix in
  // under a minute.
  if (inq.unanswered > 0) {
    const waitingDays = inq.oldest_waiting_at != null
      ? Math.floor((t - inq.oldest_waiting_at) / DAY) : null;
    return {
      id: 'unanswered_inquiries',
      severity: 'urgent',
      metric: { unanswered: inq.unanswered, waiting_days: waitingDays },
      reason: 'buyers_waiting',
      action: 'reply',
    };
  }

  // ── 2. nobody is finding it ─────────────────────────────────────────
  if (views < LOW_VIEWS) {
    // Name the cause we can actually see. Photos are both a discovery signal
    // and the first thing a buyer judges, so when they are short that is the
    // lever — otherwise it is reach, and the honest advice is promotion or a
    // fuller description rather than a guess.
    return {
      id: 'low_views',
      severity: 'warn',
      metric: { views, window_days: WINDOW_DAYS, photos },
      reason: photos < MIN_PHOTOS ? 'few_photos' : 'low_reach',
      action: photos < MIN_PHOTOS ? 'add_photos' : 'improve_discovery',
    };
  }

  // ── 3. people look and nobody asks ──────────────────────────────────
  if (inquiries === 0) {
    // Price is the usual suspect, but only say so with a real comparison
    // behind it. listing_diagnostics.price_delta_pct is computed by the daily
    // job against at least three same-model peers; without a row we do not
    // speculate about price and fall back to what we can see.
    const diag = db.prepare(
      'SELECT price_delta_pct FROM listing_diagnostics WHERE listing_id=?',
    ).get(listing.id);
    const deltaPct = diag?.price_delta_pct ?? null;

    if (deltaPct != null && deltaPct > PRICE_HIGH_PCT) {
      return {
        id: 'views_no_inquiry',
        severity: 'warn',
        metric: { views, window_days: WINDOW_DAYS, price_delta_pct: deltaPct },
        reason: 'price_high',
        action: 'review_price',
      };
    }
    return {
      id: 'views_no_inquiry',
      severity: 'warn',
      metric: { views, window_days: WINDOW_DAYS, photos },
      reason: photos < MIN_PHOTOS ? 'few_photos' : 'unclear_value',
      action: photos < MIN_PHOTOS ? 'add_photos' : 'review_price_photos',
    };
  }

  // ── healthy ─────────────────────────────────────────────────────────
  // Worth saying out loud: a seller who only ever hears from us when
  // something is wrong learns to dread the screen.
  return {
    id: 'ok',
    severity: 'ok',
    metric: { views, window_days: WINDOW_DAYS, inquiries },
    reason: 'working',
    action: null,
  };
}

/** Advice for many listings, keyed by listing id. Skips nulls. */
export function listingAdviceFor(db, listings, opts = {}) {
  const out = {};
  for (const l of listings) {
    try {
      const a = listingAdvice(db, l, opts);
      if (a) out[l.id] = a;
    } catch {
      // One bad row must not cost the seller the whole screen.
    }
  }
  return out;
}

export const THRESHOLDS = { MIN_AGE_DAYS, WINDOW_DAYS, LOW_VIEWS, PRICE_HIGH_PCT, MIN_PHOTOS };
