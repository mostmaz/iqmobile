// Qualification signals for the advanced dashboard (spec §1).
//
// A shop qualifies if ANY ONE of:
//   active_listings   >= 10
//   listings_30d      >= 8
//   contacts_30d      >= 30   (whatsapp + chat + call)
//   sells_new_devices
//
// Qualification only SURFACES the upgrade offer — it never grants access;
// that is a manual admin decision. Falling below every signal for 60 days
// flags the shop for review and never auto-revokes.
//
// Computed into shop_signals by the daily job, never on a dashboard load:
// the contact counts scan the events table (168k rows and growing), which
// is fine once a day and wrong on every page view.
import { db, now } from './db.js';

const DAY_MS = 86400000;
export const BELOW_REVIEW_MS = 60 * DAY_MS;

const upsert = db.prepare(`
  INSERT INTO shop_signals(shop_id, active_listings, listings_30d, contacts_30d,
                           whatsapp_30d, chat_30d, call_30d, qualifies, below_since, computed_at)
  VALUES(@shop_id, @active_listings, @listings_30d, @contacts_30d,
         @whatsapp_30d, @chat_30d, @call_30d, @qualifies, @below_since, @computed_at)
  ON CONFLICT(shop_id) DO UPDATE SET
    active_listings=excluded.active_listings, listings_30d=excluded.listings_30d,
    contacts_30d=excluded.contacts_30d, whatsapp_30d=excluded.whatsapp_30d,
    chat_30d=excluded.chat_30d, call_30d=excluded.call_30d,
    qualifies=excluded.qualifies, below_since=excluded.below_since,
    computed_at=excluded.computed_at
`);

/** Compute (and persist) one shop's signals. Returns the row. */
export function computeShopSignals(shopId) {
  const t = now();
  const since = t - 30 * DAY_MS;
  const u = db.prepare('SELECT id, shop_sells_new FROM users WHERE id=?').get(shopId);
  if (!u) return null;

  const active = db.prepare(
    "SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND status='active' AND COALESCE(is_draft,0)=0",
  ).get(shopId).n;
  const created30 = db.prepare(
    'SELECT COUNT(*) AS n FROM phone_listings WHERE seller_id=? AND created_at > ? AND COALESCE(is_draft,0)=0',
  ).get(shopId, since).n;

  // Contact events are recorded against the LISTING, so the shop's share is
  // the join. Chat conversations count as contacts too (spec §1), counted
  // as threads opened, not messages — one buyer asking five questions is
  // one contact.
  const evt = db.prepare(`
    SELECT
      SUM(CASE WHEN e.type='contact_whatsapp' THEN 1 ELSE 0 END) AS wa,
      SUM(CASE WHEN e.type='contact_call' THEN 1 ELSE 0 END) AS calls
    FROM events e JOIN phone_listings l ON l.id = e.listing_id
    WHERE l.seller_id=? AND e.created_at > ? AND e.type IN ('contact_whatsapp','contact_call')
  `).get(shopId, since);
  const storeCalls = db.prepare(
    "SELECT COUNT(*) AS n FROM events WHERE shop_id=? AND type IN ('store_call','store_whatsapp') AND created_at > ?",
  ).get(shopId, since).n;
  const chats = db.prepare(
    'SELECT COUNT(*) AS n FROM chats WHERE seller_id=? AND created_at > ?',
  ).get(shopId, since).n;

  const wa = (evt?.wa || 0);
  const call = (evt?.calls || 0) + storeCalls;
  const contacts = wa + call + chats;
  const qualifies = (active >= 10 || created30 >= 8 || contacts >= 30 || !!u.shop_sells_new) ? 1 : 0;

  const prev = db.prepare('SELECT below_since FROM shop_signals WHERE shop_id=?').get(shopId);
  const belowSince = qualifies ? null : (prev?.below_since || t);

  upsert.run({
    shop_id: shopId,
    active_listings: active,
    listings_30d: created30,
    contacts_30d: contacts,
    whatsapp_30d: wa,
    chat_30d: chats,
    call_30d: call,
    qualifies,
    below_since: belowSince,
    computed_at: t,
  });

  // 60 days below every signal → flag for a human to look at. Never a
  // revocation: a shop that went quiet for two months is a conversation,
  // not an automatic downgrade.
  if (!qualifies && belowSince && t - belowSince >= BELOW_REVIEW_MS) {
    db.prepare(
      "UPDATE users SET shop_tier_flagged_at=? WHERE id=? AND shop_tier='advanced' AND shop_tier_flagged_at IS NULL",
    ).run(t, shopId);
  } else if (qualifies) {
    db.prepare('UPDATE users SET shop_tier_flagged_at=NULL WHERE id=? AND shop_tier_flagged_at IS NOT NULL').run(shopId);
  }

  return db.prepare('SELECT * FROM shop_signals WHERE shop_id=?').get(shopId);
}

/** Read the materialised row, computing it on the spot if it's missing. */
export function getShopSignals(shopId) {
  return db.prepare('SELECT * FROM shop_signals WHERE shop_id=?').get(shopId)
    || computeShopSignals(shopId);
}

export function refreshAllShopSignals() {
  const shops = db.prepare("SELECT id FROM users WHERE seller_type='shop'").all();
  let n = 0;
  for (const s of shops) { computeShopSignals(s.id); n++; }
  return n;
}
