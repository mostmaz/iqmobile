import { db } from './db.js';
import { emitTo } from './sse.js';

// Listings auto-expire after their TTL elapses; sellers can renew via PATCH.
// Deals time out after 24h in any non-terminal state (so phone numbers aren't
// permanently exposed because of a stale "seller_confirmed" record on a
// listing the seller forgot about).
const DEAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export function startExpirer() {
  setInterval(() => {
    const now = Date.now();
    const expL = db
      .prepare("SELECT id, seller_id FROM phone_listings WHERE status='active' AND expires_at <= ?")
      .all(now);
    for (const l of expL) {
      db.prepare("UPDATE phone_listings SET status='expired', updated_at=? WHERE id=?").run(now, l.id);
      emitTo(l.seller_id, 'listing.expired', { id: l.id });
    }

    const stale = db
      .prepare(
        `SELECT id, buyer_id, seller_id FROM deals
         WHERE status IN ('proposed','buyer_accepted') AND updated_at <= ?`,
      )
      .all(now - DEAL_TIMEOUT_MS);
    for (const d of stale) {
      db.prepare("UPDATE deals SET status='expired', updated_at=? WHERE id=?").run(now, d.id);
      emitTo(d.buyer_id, 'deal.expired', { id: d.id });
      emitTo(d.seller_id, 'deal.expired', { id: d.id });
    }
  }, 30 * 1000);
}
