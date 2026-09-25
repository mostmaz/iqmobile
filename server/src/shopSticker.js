// Printed QR stickers for a shop's window or counter.
//
// The shop asks from the app, an operator prints and posts it, and the shop
// is told at each step. The rules live here rather than in the route because
// there are already two callers (the app and the merchant panel's future
// door) and three writers of the status column (shop, admin approve path,
// admin reject path) — the same reason shopTier.js exists.
//
// What this deliberately does NOT do:
//   - charge for anything. The sticker and its delivery are free, so there
//     is no price column and no wallet touch. If that ever changes it is a
//     new column here, not a second flow.
//   - generate the artwork. That is stickerPage.js, served from the public
//     web page, so the operator and the shop print the very same file.
import { db } from './db.js';
import { audit } from './auditLog.js';
import { pushToAdmins } from './adminPush.js';
import { notify } from './notify.js';
import { SITE_URL } from './seo.js';

/** Window decal or counter stand. Anything else is rejected at the door. */
export const STICKER_KINDS = ['window', 'stand'];
export const KIND_LABEL_AR = { window: 'ملصق واجهة', stand: 'ستاند طاولة' };

/** A shop asking for 40 stickers is a mistake or an experiment, not an order. */
export const MAX_QTY = 5;

/**
 * Statuses that mean "we still owe this shop a sticker". A second request is
 * refused while one of these is open — the shop would otherwise send three
 * asks in a week and the operator would print three stickers for one window.
 */
export const OPEN_STATUSES = ['pending', 'printing'];

export const STICKER_STATUSES = ['pending', 'printing', 'shipped', 'rejected'];

/** Where the printable artwork for a shop lives, for operator and shop alike. */
export function stickerPageUrl(shopId) {
  return `${SITE_URL}/shop/${shopId}/sticker`;
}

/**
 * What the sticker's QR encodes.
 *
 * `?src=sticker` is not decoration: it is the only way to tell a scan of the
 * printed sticker apart from a tap on a shared link, and those scans are the
 * evidence that the sticker is actually on a wall. Every scan is logged as a
 * `shop.sticker_scan` event, which is what the dashboard counts next to the
 * photo — and, one day, what replaces the photo.
 */
export function shopUrl(shopId, src) {
  return `${SITE_URL}/shop/${shopId}${src ? `?src=${src}` : ''}`;
}

/** Devices a shop must have live before the free week is earned. */
export const REWARD_MIN_LISTINGS = 5;

/** How long the free shop featuring runs. */
export const REWARD_DAYS = 7;

/**
 * The number a shop can WhatsApp the photo to when it would rather not use
 * the in-app upload. Kept here so the app, the dashboard and any message we
 * send all quote the same number.
 */
export const PROOF_WHATSAPP = '07502062804';

/** Active listings the reward gate counts. Drafts and sold stock don't. */
export function activeListingCount(shopId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM phone_listings
     WHERE seller_id=? AND status IN ('active','reserved') AND COALESCE(is_draft,0)=0
  `).get(shopId).n;
}

/** How many times the printed sticker has been scanned. Evidence, not a gate. */
export function stickerScans(shopId) {
  try {
    return db.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE type='shop.sticker_scan' AND shop_id=?",
    ).get(shopId).n;
  } catch {
    return 0;
  }
}

function rowOut(r) {
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    sticker_kind: r.sticker_kind,
    qty: r.qty,
    address: r.address,
    created_at: r.created_at,
    printing_at: r.printing_at,
    shipped_at: r.shipped_at,
    admin_note: r.admin_note,
    proof_status: r.proof_status || null,
    proof_at: r.proof_at ?? null,
    proof_image_path: r.proof_image_path || null,
    proof_note: r.proof_note || null,
    reward_until: r.reward_until ?? null,
  };
}

/**
 * What the shop may do right now, and the state of its latest request.
 * Returns null for a non-shop account, which the route turns into a 404.
 */
export function stickerStatus(shopId) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(shopId);
  if (!u || u.seller_type !== 'shop') return null;

  const open = db.prepare(
    `SELECT * FROM shop_sticker_requests
      WHERE shop_id=? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
      ORDER BY created_at DESC LIMIT 1`,
  ).get(shopId, ...OPEN_STATUSES);

  const last = db.prepare(
    'SELECT * FROM shop_sticker_requests WHERE shop_id=? ORDER BY created_at DESC LIMIT 1',
  ).get(shopId);

  const listings = activeListingCount(u.id);
  const featuredUntil = u.shop_featured_until && u.shop_featured_until > Date.now()
    ? u.shop_featured_until : null;

  return {
    can_request: !open,
    reason: open ? 'request_open' : null,
    open: rowOut(open),
    last: rowOut(last),
    shop: {
      name: u.shop_name || u.display_name || '',
      governorate: u.governorate || '',
      address: u.shop_address || '',
      phone: u.shop_phone || u.phone || '',
    },
    shop_url: shopUrl(u.id),
    sticker_url: stickerPageUrl(u.id),
    // The free-week offer, described entirely from the server so the app
    // never has to know the rule — only render it.
    reward: {
      days: REWARD_DAYS,
      min_listings: REWARD_MIN_LISTINGS,
      listings,
      listings_ok: listings >= REWARD_MIN_LISTINGS,
      whatsapp: PROOF_WHATSAPP,
      status: last?.proof_status || null,
      can_submit: !!last && last.status !== 'rejected' && !['pending', 'granted'].includes(last.proof_status),
      featured_until: featuredUntil,
      scans: stickerScans(u.id),
    },
  };
}

/**
 * Create the request. Returns {ok:true, id} or {error, status} so the route
 * can pass the shape straight through, exactly like createTierRequest.
 */
export function createStickerRequest(shopId, body = {}, actorKind = 'shop') {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(shopId);
  if (!u || u.seller_type !== 'shop') return { error: 'not_a_shop', status: 404 };

  const open = db.prepare(
    `SELECT id FROM shop_sticker_requests
      WHERE shop_id=? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`,
  ).get(shopId, ...OPEN_STATUSES);
  if (open) return { error: 'request_pending', status: 409 };

  const kind = STICKER_KINDS.includes(body.sticker_kind) ? body.sticker_kind : 'window';
  const qty = Math.min(MAX_QTY, Math.max(1, Math.round(Number(body.qty) || 1)));

  // The address is the one thing we cannot derive: a shop's profile address
  // is often "بغداد" and nothing more, which no courier can deliver to.
  const address = String(body.address || u.shop_address || '').trim().slice(0, 200);
  if (address.length < 8) return { error: 'address_required', status: 400 };

  const id = db.prepare(`
    INSERT INTO shop_sticker_requests(shop_id, sticker_kind, qty, store_name, governorate,
                                      address, phone, status, created_at)
    VALUES(?,?,?,?,?,?,?, 'pending', ?)
  `).run(
    u.id,
    kind,
    qty,
    String(u.shop_name || u.display_name || '').slice(0, 120),
    String(body.governorate || u.governorate || '').slice(0, 40),
    address,
    String(body.phone || u.shop_phone || u.phone || '').slice(0, 20),
    Date.now(),
  ).lastInsertRowid;

  audit(actorKind, u.id, 'sticker.request', { kind: 'shop', id: u.id },
    { request_id: id, sticker_kind: kind, qty, via: actorKind });

  // The operator app is the only place anyone watches in real time; the
  // dashboard page is where the job actually gets done. Fire-and-forget by
  // contract — a failed push must never fail the request.
  pushToAdmins('sticker.request', 'طلب ملصق QR 🏷️',
    `${u.shop_name || u.display_name} · ${u.governorate || '—'} · ${KIND_LABEL_AR[kind]} ×${qty}`,
    { screen: 'qr_stickers', shop_id: u.id, sticker_request_id: id }).catch(() => {});

  return { ok: true, id };
}

const NEXT = {
  printing: { from: ['pending'], stamp: 'printing_at' },
  shipped: { from: ['pending', 'printing'], stamp: 'shipped_at' },
  reject: { from: ['pending', 'printing'], stamp: null },
};

const TELL_SHOP = {
  printing: {
    kind: 'sticker.printing',
    title: 'ملصق متجرك قيد الطباعة',
    body: 'نجهّزه ونوصله لعنوان متجرك.',
  },
  shipped: {
    kind: 'sticker.shipped',
    title: 'ملصق متجرك بالطريق 🏷️',
    body: 'انطلق إلك — ألصقه على الواجهة وخلي الزبون يمسحه.',
  },
  reject: {
    kind: 'sticker.rejected',
    title: 'ما كدرنا ننفّذ طلب الملصق',
    body: 'تواصل معنا للتفاصيل.',
  },
};

/**
 * Operator-side transition. One function for all three actions so the
 * legal-transition table cannot drift between handlers.
 *
 * Returns {ok:true} or {error, status}.
 */
export function advanceSticker(requestId, action, adminId, note = '') {
  const step = NEXT[action];
  if (!step) return { error: 'bad_action', status: 400 };

  const row = db.prepare('SELECT * FROM shop_sticker_requests WHERE id=?').get(requestId);
  if (!row) return { error: 'not_found', status: 404 };
  if (!step.from.includes(row.status)) return { error: 'bad_state', status: 400, state: row.status };

  const status = action === 'reject' ? 'rejected' : action;
  const now = Date.now();
  const clean = String(note || '').slice(0, 500);

  db.prepare(`
    UPDATE shop_sticker_requests
       SET status=?, admin_note=COALESCE(NULLIF(?, ''), admin_note),
           reviewed_at=?, reviewed_by=?
           ${step.stamp ? `, ${step.stamp}=?` : ''}
     WHERE id=? AND status=?
  `).run(...[status, clean, now, adminId ?? null, ...(step.stamp ? [now] : []), requestId, row.status]);

  audit('admin', adminId ?? null, `sticker.${action}`, { kind: 'shop', id: row.shop_id },
    { request_id: requestId, note: clean || undefined });

  const tell = TELL_SHOP[action];
  notify(row.shop_id, tell.kind,
    { sticker_request_id: requestId, sticker_kind: row.sticker_kind, qty: row.qty },
    { title: tell.title, body: clean && action === 'reject' ? clean : tell.body });

  return { ok: true };
}

/**
 * The shop says "it's up" and sends a photo of the sticker in place.
 *
 * Two conditions, and only one of them needs a human: the device count is
 * read here, from the same rows the marketplace shows, so nobody has to
 * count listings off a screenshot. The photo is the only judgement call.
 *
 * `imagePath` is a '/uploads/…' path the route has already stored.
 */
export function submitStickerProof(shopId, imagePath, note = '') {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(shopId);
  if (!u || u.seller_type !== 'shop') return { error: 'not_a_shop', status: 404 };

  const row = db.prepare(
    "SELECT * FROM shop_sticker_requests WHERE shop_id=? AND status != 'rejected' ORDER BY created_at DESC LIMIT 1",
  ).get(shopId);
  if (!row) return { error: 'no_sticker_request', status: 409 };
  if (row.proof_status === 'pending') return { error: 'proof_pending', status: 409 };
  if (row.proof_status === 'granted') return { error: 'already_rewarded', status: 409 };

  const listings = activeListingCount(shopId);
  if (listings < REWARD_MIN_LISTINGS) {
    return { error: 'not_enough_listings', status: 409, listings, need: REWARD_MIN_LISTINGS };
  }

  const at = Date.now();
  db.prepare(`
    UPDATE shop_sticker_requests
       SET proof_image_path=?, proof_at=?, proof_status='pending', proof_listings=?, proof_note=?
     WHERE id=?
  `).run(imagePath || null, at, listings, String(note || '').slice(0, 300), row.id);

  audit('shop', shopId, 'sticker.proof', { kind: 'shop', id: shopId },
    { request_id: row.id, listings });

  pushToAdmins('sticker.request', 'إثبات ملصق 📸',
    `${u.shop_name || u.display_name} · ${listings} جهاز معروض · بانتظار مراجعتك`,
    { screen: 'qr_stickers', shop_id: shopId, sticker_request_id: row.id }).catch(() => {});

  return { ok: true, id: row.id, listings };
}

/**
 * The operator looks at the photo and decides. Granting extends the shop's
 * existing featured window rather than overwriting it — a shop that paid for
 * featuring and then earned a free week must not LOSE days by winning.
 */
export function decideStickerProof(requestId, action, adminId, note = '') {
  if (!['grant', 'reject'].includes(action)) return { error: 'bad_action', status: 400 };

  const row = db.prepare('SELECT * FROM shop_sticker_requests WHERE id=?').get(requestId);
  if (!row) return { error: 'not_found', status: 404 };
  if (row.proof_status !== 'pending') return { error: 'bad_state', status: 400, state: row.proof_status };

  const now = Date.now();
  const clean = String(note || '').slice(0, 500);

  if (action === 'reject') {
    db.prepare("UPDATE shop_sticker_requests SET proof_status='rejected', proof_note=COALESCE(NULLIF(?,''), proof_note) WHERE id=?")
      .run(clean, requestId);
    audit('admin', adminId ?? null, 'sticker.proof_reject', { kind: 'shop', id: row.shop_id },
      { request_id: requestId, note: clean || undefined });
    notify(row.shop_id, 'sticker.reward_rejected', { sticker_request_id: requestId }, {
      title: 'ما كدرنا نعتمد صورة الملصق',
      body: clean || 'ابعث صورة تبيّن الملصق مثبّت بالمحل.',
    });
    return { ok: true };
  }

  const u = db.prepare('SELECT shop_featured_until, shop_name, display_name FROM users WHERE id=?').get(row.shop_id);
  const base = Math.max(now, u?.shop_featured_until || 0);
  const until = base + REWARD_DAYS * 86400000;

  db.transaction(() => {
    db.prepare('UPDATE users SET shop_featured_until=? WHERE id=?').run(until, row.shop_id);
    db.prepare(`
      UPDATE shop_sticker_requests
         SET proof_status='granted', reward_granted_at=?, reward_until=?,
             proof_note=COALESCE(NULLIF(?,''), proof_note)
       WHERE id=? AND proof_status='pending'
    `).run(now, until, clean, requestId);
  })();

  audit('admin', adminId ?? null, 'sticker.proof_grant', { kind: 'shop', id: row.shop_id },
    { request_id: requestId, until, days: REWARD_DAYS });

  notify(row.shop_id, 'sticker.reward_granted', { sticker_request_id: requestId, until }, {
    title: `متجرك مميّز ${REWARD_DAYS} أيام 🎉`,
    body: 'شكراً على الملصق — متجرك يظهر بالمقدمة لأسبوع كامل.',
  });

  return { ok: true, until };
}
