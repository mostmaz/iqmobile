// How much of the marketplace one visitor can carry away.
//
// Measured on 3 Oct 2026: GET /listings handed out every seller's phone and
// WhatsApp in every row, 50 a page, with no limit on reads and no cap on the
// offset. 2,973 numbers in about sixty requests, no sign-in. The list routes
// no longer carry numbers at all (see stripListContact in routes/listings.js);
// this file holds the two defences that need memory across requests and
// restarts, so they live in the database rather than in a limiter's RAM:
//
//   • A daily budget of phone numbers per viewer. A person opens a few dozen
//     listings a day; a scraper opens thousands. Past the budget the detail
//     page still loads, only without the number, which every installed build
//     already renders as "no call / WhatsApp button" (the shape stripContact
//     has always used). Chat stays.
//   • View counting once per viewer per listing per day, so «الأكثر مشاهدة»
//     and the sticker-scan signal cannot be pumped by refreshing.
//
// Who counts as one viewer. Every app install carries a token (a guest one
// from first launch), so a request with NO token is not our app. 78% of
// daily users are guests and Iraqi carriers put many people behind one
// address (CGNAT), so the per-network budget is loose and only counts guests
// and tokenless calls. A registered, phone-verified account is limited on
// its own and never by the network it shares.
//
// Every entry point fails OPEN: a bug in a guard must not hide every number
// on the marketplace.

import crypto from 'node:crypto';
import { ipKeyGenerator } from 'express-rate-limit';
import { db, getSetting } from './db.js';
import { logEvent } from './eventLog.js';

const DAY = 24 * 60 * 60 * 1000;

db.exec(`
CREATE TABLE IF NOT EXISTS viewer_marks (
  kind TEXT NOT NULL,
  viewer TEXT NOT NULL,
  target TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (kind, viewer, target)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_viewer_marks_recent ON viewer_marks(kind, viewer, at);
`);

/**
 * Numbers per 24 hours. Tunable from app_settings without a deploy
 * (contact_budget_user, _guest, _network, _tokenless); contact_budget_enabled
 * = '0' switches the whole budget off.
 */
export const BUDGET_DEFAULTS = Object.freeze({ user: 150, guest: 100, network: 400, tokenless: 30 });

function num(key, fallback) {
  const v = Number(getSetting(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
export function budgets() {
  return {
    enabled: getSetting('contact_budget_enabled') !== '0',
    user: num('contact_budget_user', BUDGET_DEFAULTS.user),
    guest: num('contact_budget_guest', BUDGET_DEFAULTS.guest),
    network: num('contact_budget_network', BUDGET_DEFAULTS.network),
    tokenless: num('contact_budget_tokenless', BUDGET_DEFAULTS.tokenless),
  };
}

/**
 * The caller's network: IPv4 as is, IPv6 widened to its /64. One phone or
 * household is handed a whole /64, so hopping addresses inside it must not
 * buy a fresh budget.
 */
export function networkOf(ip) {
  try { return ipKeyGenerator(String(ip || ''), 64) || 'unknown'; } catch { return String(ip || 'unknown'); }
}

const isGuestStmt = db.prepare('SELECT is_guest FROM users WHERE id=?');

/** The keys this request is counted under, each with its own limit. */
export function viewerKeys(req, b = budgets()) {
  const net = `n:${networkOf(req.ip)}`;
  const userId = req.user?.id;
  if (userId) {
    if (!isGuestStmt.get(userId)?.is_guest) return [{ key: `u:${userId}`, limit: b.user }];
    return [{ key: `u:${userId}`, limit: b.guest }, { key: net, limit: b.network }];
  }
  return [{ key: `t:${networkOf(req.ip)}`, limit: b.tokenless }, { key: net, limit: b.network }];
}

// Insert, or refresh a mark older than the window. `changes` is 1 exactly
// when this is the first time inside the window.
const upsert = db.prepare(`
  INSERT INTO viewer_marks(kind, viewer, target, at) VALUES(?,?,?,?)
  ON CONFLICT(kind, viewer, target) DO UPDATE SET at=excluded.at
   WHERE viewer_marks.at <= excluded.at - ?
`);
const seenSince = db.prepare('SELECT 1 FROM viewer_marks WHERE kind=? AND viewer=? AND target=? AND at > ?');
const countSince = db.prepare('SELECT COUNT(*) AS n FROM viewer_marks WHERE kind=? AND viewer=? AND at > ?');

let lastPrune = 0;
function prune(at) {
  if (at - lastPrune < 60 * 60 * 1000) return;
  lastPrune = at;
  db.prepare('DELETE FROM viewer_marks WHERE at < ?').run(at - 2 * DAY);
}

function noteBudgetHit(key, req, target, at) {
  const day = new Date(at + 3 * 3600000).toISOString().slice(0, 10); // Baghdad day
  if (upsert.run('deny', key, day, at, DAY).changes === 0) return;   // once per key per day
  console.warn(`[scrape-guard] phone budget reached: ${key} (user ${req.user?.id ?? '-'}, net ${networkOf(req.ip)}) at ${target}`);
  logEvent({ type: 'contact_budget_hit', user_id: req.user?.id ?? null });
}

/**
 * May this viewer be shown the phone numbers on `target` ('l:<listing id>'
 * or 's:<shop id>')? Yes when they were already shown it today, or are under
 * every budget they count against. A yes is recorded against all of them.
 * The owner always sees their own number.
 */
export function contactAllowed(req, target, { ownerId = null, at = Date.now() } = {}) {
  try {
    const b = budgets();
    if (!b.enabled) return true;
    if (ownerId != null && req.user?.id === ownerId) return true;
    const keys = viewerKeys(req, b);
    const since = at - DAY;
    for (const k of keys) {
      if (seenSince.get('reveal', k.key, target, since)) continue;
      if (countSince.get('reveal', k.key, since).n >= k.limit) {
        noteBudgetHit(k.key, req, target, at);
        return false;
      }
    }
    db.transaction(() => { for (const k of keys) upsert.run('reveal', k.key, target, at, DAY); })();
    prune(at);
    return true;
  } catch (e) {
    console.error('[scrape-guard] contactAllowed failed open:', e?.message);
    return true;
  }
}

/**
 * Is this the viewer's first view of `target` today? Used to log one view
 * per viewer per day. A tokenless caller is told apart by network AND
 * browser, so two customers on one carrier address who scan the same shop
 * sticker are still two scans.
 */
export function firstViewToday(req, target, at = Date.now()) {
  try {
    let viewer;
    if (req.user?.id) viewer = `u:${req.user.id}`;
    else {
      const ua = crypto.createHash('sha1').update(String(req.get?.('user-agent') || '')).digest('hex').slice(0, 10);
      viewer = `n:${networkOf(req.ip)}:${ua}`;
    }
    const first = upsert.run('view', viewer, target, at, DAY).changes > 0;
    prune(at);
    return first;
  } catch {
    return true;
  }
}

// What a LIST row never carries, whoever asks (3 Oct 2026): the contact
// numbers, the seller's private sale price («بيش بعته؟») and the creating
// client's idempotency key. Numbers in every feed row let a script copy
// all 2,973 of them in about sixty requests; no app build has ever read a
// number off a card — the call and WhatsApp buttons live on the detail
// page, which hands numbers out inside a daily budget (scrapeGuard.js).
const LIST_PRIVATE = ['contact_phone', 'contact_whatsapp', 'seller_phone', 'phone_visible', 'storefront_phone', 'sale_price', 'client_key'];
export function listRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of LIST_PRIVATE) delete out[k];
  return out;
}

// Paging past this many rows returns an empty page. Every list in the app
// stops on a short page, and a person does not scroll a thousand phones
// deep; a script walking the whole table does.
export const MAX_LIST_OFFSET = 1000;
