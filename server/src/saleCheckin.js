// «انباع الجهاز؟» — asking the seller, three days after the first buyer
// got in touch, whether the phone is still for sale.
//
// Why: a listing whose phone was sold on WhatsApp stays «نشط» until the
// seller remembers to mark it, which most never do. Buyers keep writing to
// it, the seller stops answering, and the feed fills with ghosts. The
// moment to ask is after the first contact — before that there is nothing
// to have sold it through — and 72 hours is long enough for a sale to have
// happened and short enough that the seller still remembers which phone.
//
// The owner's rules (1 Oct 2026):
//   • 72 hours after the listing's FIRST contact (a buyer's first chat
//     message, or a call / WhatsApp tap), one in-app notification with two
//     buttons and the device's name: «انباع» / «بعده موجود».
//   • «انباع» → one optional question, the price it went for («بيش بعته؟
//     اختياري»), and the listing is closed as sold.
//   • «بعده موجود» → asked again in 7 days, at most twice more.
//   • No answer → not asked again. A question ignored once is a nag twice.
//
// Only sellers on an app that can show the buttons (1.0.0) are asked; an
// older build would get a push it cannot answer, so it gets nothing, and is
// asked once it updates.
import { db, now as dbNow } from './db.js';
import { notify, versionAtLeast } from './notify.js';

export const FIRST_ASK_AFTER_MS = 72 * 60 * 60 * 1000;
export const REASK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** First ask + two re-asks. */
export const MAX_ROUNDS = 3;
export const SOLD_CHECK_UI_MIN_VERSION = '1.0.0';
/** The push category the app registers its two buttons under. */
export const PUSH_CATEGORY = 'sold_check';
export const KIND = 'listing.sold_check';
const PER_RUN_LIMIT = 200;

/** When a buyer first got in touch about this listing, or null. */
export function firstContactAt(db_, listingId) {
  return db_.prepare(`
    SELECT MIN(t) AS t FROM (
      SELECT created_at AS t FROM events
       WHERE listing_id = ? AND type IN ('contact_call','contact_whatsapp')
      UNION ALL
      SELECT m.created_at FROM chat_messages m JOIN chats c ON c.id = m.chat_id
       WHERE c.listing_id = ? AND m.sender_id = c.buyer_id
    )`).get(listingId, listingId).t ?? null;
}

/**
 * Listings owed a question right now: live, contacted ≥ 72h ago, and
 * either never asked, or answered «بعده موجود» ≥ 7 days ago with rounds
 * to spare. Exported for the test and the dashboard.
 */
export function dueCheckins(db_, at, { limit = PER_RUN_LIMIT } = {}) {
  const rows = db_.prepare(`
    SELECT l.id AS listing_id, l.seller_id, l.brand, l.model, fc.first_contact,
           (SELECT COUNT(*) FROM sale_checkins s WHERE s.listing_id = l.id) AS rounds,
           (SELECT s.answer FROM sale_checkins s WHERE s.listing_id = l.id ORDER BY s.round DESC LIMIT 1) AS last_answer,
           (SELECT s.answered_at FROM sale_checkins s WHERE s.listing_id = l.id ORDER BY s.round DESC LIMIT 1) AS last_answered_at,
           (SELECT d.app_version FROM user_active_days d WHERE d.user_id = l.seller_id ORDER BY d.day DESC LIMIT 1) AS app_version,
           u.is_guest
      FROM phone_listings l
      JOIN users u ON u.id = l.seller_id
      JOIN (SELECT listing_id, MIN(t) AS first_contact FROM (
              SELECT listing_id, created_at AS t FROM events
               WHERE listing_id IS NOT NULL AND type IN ('contact_call','contact_whatsapp')
              UNION ALL
              SELECT c.listing_id, m.created_at FROM chat_messages m JOIN chats c ON c.id = m.chat_id
               WHERE m.sender_id = c.buyer_id
            ) GROUP BY listing_id) fc ON fc.listing_id = l.id
     WHERE l.status = 'active' AND COALESCE(l.is_draft, 0) = 0 AND COALESCE(l.review_hold, 0) = 0
       AND fc.first_contact <= ?
     ORDER BY fc.first_contact ASC
     LIMIT 5000
  `).all(at - FIRST_ASK_AFTER_MS);

  const out = [];
  for (const r of rows) {
    if (r.is_guest) continue;
    if (!versionAtLeast(r.app_version, SOLD_CHECK_UI_MIN_VERSION)) continue;
    let round;
    if (r.rounds === 0) round = 1;
    else if (r.last_answer === 'still' && r.rounds < MAX_ROUNDS && r.last_answered_at <= at - REASK_AFTER_MS) round = r.rounds + 1;
    else continue;
    out.push({
      listing_id: r.listing_id, seller_id: r.seller_id, round,
      device: [r.brand, r.model].filter(Boolean).join(' '),
      first_contact: r.first_contact,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function ask(c, at) {
  const r = db.prepare(
    'INSERT OR IGNORE INTO sale_checkins(listing_id, seller_id, round, asked_at) VALUES(?,?,?,?)',
  ).run(c.listing_id, c.seller_id, c.round, at);
  if (!r.changes) return false;
  notify(c.seller_id, KIND,
    { listing_id: c.listing_id, checkin_id: Number(r.lastInsertRowid), round: c.round, device: c.device },
    { title: 'انباع الجهاز؟', body: `${c.device} — انباع، لو بعده موجود؟`, categoryId: PUSH_CATEGORY });
  return true;
}

/** One sweep. Returns how many were asked. */
export function runSaleCheckins({ at = dbNow() } = {}) {
  const due = dueCheckins(db, at);
  let asked = 0;
  for (const c of due) if (ask(c, at)) asked += 1;
  if (asked) console.log(`[sold-check] asked ${asked}`);
  return { due: due.length, asked };
}

/** What the seller's screen shows for one listing. */
export function checkinStateFor(db_, listingId) {
  const l = db_.prepare('SELECT id, brand, model, asking_price, status FROM phone_listings WHERE id=?').get(listingId);
  if (!l) return null;
  const rows = db_.prepare('SELECT * FROM sale_checkins WHERE listing_id=? ORDER BY round ASC').all(listingId);
  const last = rows[rows.length - 1] || null;
  return {
    listing: { id: l.id, brand: l.brand, model: l.model, asking_price: l.asking_price, status: l.status, device: [l.brand, l.model].filter(Boolean).join(' ') },
    rounds: rows.length,
    pending: last && !last.answer ? { id: last.id, round: last.round, asked_at: last.asked_at } : null,
    last_answer: last?.answer ?? null,
  };
}

/**
 * The seller's answer. 'sold' closes the listing (with the price if they
 * gave one); 'still' keeps it and schedules the next question. Works with
 * or without an open question — a seller answering from the listing
 * itself is as good as one answering the notification.
 */
export function answerSaleCheckin(listingId, sellerId, answer, { salePrice = null, at = dbNow() } = {}) {
  const l = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listingId);
  if (!l) return { error: 'not_found' };
  if (l.seller_id !== sellerId) return { error: 'forbidden' };
  if (answer !== 'sold' && answer !== 'still') return { error: 'bad_answer' };
  const price = Number.isFinite(Number(salePrice)) && Number(salePrice) > 0 ? Math.round(Number(salePrice)) : null;

  const tx = db.transaction(() => {
    let row = db.prepare('SELECT * FROM sale_checkins WHERE listing_id=? AND answer IS NULL ORDER BY round DESC LIMIT 1').get(listingId);
    if (!row) {
      const rounds = db.prepare('SELECT COUNT(*) AS n FROM sale_checkins WHERE listing_id=?').get(listingId).n;
      const id = db.prepare('INSERT INTO sale_checkins(listing_id, seller_id, round, asked_at) VALUES(?,?,?,?)')
        .run(listingId, sellerId, rounds + 1, at).lastInsertRowid;
      row = db.prepare('SELECT * FROM sale_checkins WHERE id=?').get(id);
    }
    db.prepare('UPDATE sale_checkins SET answer=?, answered_at=?, sale_price=? WHERE id=?')
      .run(answer, at, answer === 'sold' ? price : null, row.id);
    if (answer === 'sold' && l.status !== 'sold') {
      db.prepare(
        `UPDATE phone_listings SET status='sold', sold_at=?, sale_price=COALESCE(?, sale_price), updated_at=?
          WHERE id=? AND status IN ('active','reserved')`,
      ).run(at, price, at, listingId);
    }
    // The question is answered: its inbox row has done its job.
    db.prepare(`UPDATE notifications SET read=1 WHERE user_id=? AND kind=? AND read=0 AND payload_json LIKE ?`)
      .run(sellerId, KIND, `%"listing_id":${listingId},%`);
  });
  tx();
  return { ok: true, ...checkinStateFor(db, listingId) };
}
