// Advanced-dashboard upgrade requests, shared by the two doors into them.
//
// A shop can ask from the merchant dashboard (where it sees the offer card
// after signing in) or from the app's home feed (where the offer finds
// shops that never open the dashboard at all — most of them). Both must
// apply the same rules, so the rules live here rather than in whichever
// route was written first.
import { db } from './db.js';
import { computeShopSignals, getShopSignals } from './shopSignals.js';
import { audit } from './auditLog.js';
import { pushToAdmins } from './adminPush.js';

const REAPPLY_AFTER_MS = 30 * 86400000;

/**
 * What the shop is allowed to do right now, and why.
 * Shape is what both the panel and the app render from.
 */
export function tierStatus(shopId) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(shopId);
  if (!u || u.seller_type !== 'shop') return null;
  const tier = u.shop_tier || 'simple';
  const pending = db.prepare(
    "SELECT id, created_at FROM shop_tier_requests WHERE shop_id=? AND status='pending'",
  ).get(shopId);
  const s = getShopSignals(shopId) || {};
  const rejectedRecently = u.shop_tier_rejected_at
    && Date.now() - u.shop_tier_rejected_at < REAPPLY_AFTER_MS;

  return {
    tier,
    state: pending ? 'pending_review' : (u.shop_tier_state || null),
    // Qualifying is about what the shop already does — the signals job
    // decides it daily, this only reports it.
    eligible: !!s.qualifies,
    can_request: tier !== 'advanced' && !pending && !rejectedRecently,
    retry_at: rejectedRecently ? u.shop_tier_rejected_at + REAPPLY_AFTER_MS : null,
    requested_at: pending?.created_at ?? null,
    signals: {
      active_listings: s.active_listings ?? 0,
      listings_30d: s.listings_30d ?? 0,
      contacts_30d: s.contacts_30d ?? 0,
    },
  };
}

/**
 * Create the request. Returns {ok:true, id} or {error, status, ...extra}
 * so each caller can shape its own HTTP response.
 */
export function createTierRequest(shopId, body = {}, actorKind = 'shop') {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(shopId);
  if (!u || u.seller_type !== 'shop') return { error: 'not_a_shop', status: 404 };
  if ((u.shop_tier || 'simple') === 'advanced') return { error: 'already_advanced', status: 409 };

  const open = db.prepare(
    "SELECT id FROM shop_tier_requests WHERE shop_id=? AND status='pending'",
  ).get(u.id);
  if (open) return { error: 'request_pending', status: 409 };

  // A rejected shop may re-apply after 30 days (spec §1).
  if (u.shop_tier_rejected_at && Date.now() - u.shop_tier_rejected_at < REAPPLY_AFTER_MS) {
    return {
      error: 'too_soon',
      status: 409,
      retry_at: u.shop_tier_rejected_at + REAPPLY_AFTER_MS,
    };
  }

  const sellsNew = body.sells_new ? 1 : 0;
  const id = db.prepare(`
    INSERT INTO shop_tier_requests(shop_id, store_name, governorate, device_count_approx,
                                   sells_new, phone, whatsapp, status, created_at)
    VALUES(?,?,?,?,?,?,?, 'pending', ?)
  `).run(
    u.id,
    String(body.store_name || u.shop_name || u.display_name || '').slice(0, 120),
    String(body.governorate || u.governorate || '').slice(0, 40),
    Number.isFinite(Number(body.device_count_approx)) ? Number(body.device_count_approx) : null,
    sellsNew,
    String(body.phone || u.shop_phone || u.phone || '').slice(0, 20),
    String(body.whatsapp || u.shop_whatsapp || '').slice(0, 20),
    Date.now(),
  ).lastInsertRowid;

  db.prepare("UPDATE users SET shop_tier_state='pending_review', shop_sells_new=? WHERE id=?")
    .run(sellsNew, u.id);
  computeShopSignals(u.id);
  audit(actorKind, u.id, 'tier.request', { kind: 'shop', id: u.id }, { request_id: id, via: actorKind });
  pushToAdmins('shop.new', 'طلب ترقية لوحة متجر',
    `${u.shop_name || u.display_name}`, { screen: 'tier_requests' }).catch(() => {});
  return { ok: true, id };
}
