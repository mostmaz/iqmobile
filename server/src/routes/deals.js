import { Router } from 'express';
import { db, now, getSetting } from '../db.js';
import { requireAuth } from '../auth.js';
import { notify } from '../notify.js';

const r = Router();

function loadChatForUser(chatId, userId) {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
  if (!chat) return { error: 'not_found' };
  if (chat.buyer_id !== userId && chat.seller_id !== userId) return { error: 'forbidden' };
  return { chat };
}

function loadDealForParty(dealId, userId) {
  const deal = db.prepare('SELECT * FROM deals WHERE id=?').get(dealId);
  if (!deal) return { error: 'not_found' };
  if (deal.buyer_id !== userId && deal.seller_id !== userId) return { error: 'forbidden' };
  return { deal };
}

function listingActive(listingId) {
  const l = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listingId);
  return l && l.status === 'active' ? l : null;
}

// Cancel any in-flight (non-terminal) deals on a chat — used when a fresh
// proposal supersedes the old one.
function cancelOpenDeals(chatId) {
  db.prepare(
    `UPDATE deals SET status='cancelled', updated_at=?
     WHERE chat_id=? AND status IN ('proposed','buyer_accepted')`,
  ).run(now(), chatId);
}

// ─── seller proposes a final price ───────────────────────────────────
r.post('/chats/:id(\\d+)/propose-price', requireAuth(), (req, res) => {
  const { chat, error } = loadChatForUser(req.params.id, req.user.id);
  if (error) return res.status(error === 'not_found' ? 404 : 403).json({ error });
  if (chat.seller_id !== req.user.id) return res.status(403).json({ error: 'seller_only' });

  const price = Number(req.body?.final_price);
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'bad_price' });
  const listing = listingActive(chat.listing_id);
  if (!listing) return res.status(409).json({ error: 'listing_not_active' });

  cancelOpenDeals(chat.id);
  const t = now();
  const ins = db.prepare(
    `INSERT INTO deals(chat_id, listing_id, buyer_id, seller_id, final_price, status, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(chat.id, chat.listing_id, chat.buyer_id, chat.seller_id, Math.round(price), 'proposed', t, t);
  const deal = db.prepare('SELECT * FROM deals WHERE id=?').get(ins.lastInsertRowid);
  db.prepare('UPDATE chats SET last_message_at=? WHERE id=?').run(t, chat.id);

  notify(chat.buyer_id, 'deal.proposed', { deal }, {
    title: 'سعر نهائي من البائع',
    body: `${price.toLocaleString()} د.ع`,
  });
  res.json(deal);
});

// ─── buyer accepts price ─────────────────────────────────────────────
r.post('/deals/:id(\\d+)/buyer-accept', requireAuth(), (req, res) => {
  const { deal, error } = loadDealForParty(req.params.id, req.user.id);
  if (error) return res.status(error === 'not_found' ? 404 : 403).json({ error });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'buyer_only' });
  if (deal.status !== 'proposed') return res.status(409).json({ error: 'bad_state' });

  const t = now();
  db.prepare("UPDATE deals SET status='buyer_accepted', updated_at=? WHERE id=?").run(t, deal.id);
  const updated = db.prepare('SELECT * FROM deals WHERE id=?').get(deal.id);
  db.prepare('UPDATE chats SET last_message_at=? WHERE id=?').run(t, deal.chat_id);

  notify(deal.seller_id, 'deal.buyer_accepted', { deal: updated }, {
    title: 'وافق المشتري على السعر',
    body: `${deal.final_price.toLocaleString()} د.ع — أكد الصفقة`,
  });
  res.json(updated);
});

// ─── buyer rejects / cancels deal ────────────────────────────────────
r.post('/deals/:id(\\d+)/buyer-reject', requireAuth(), (req, res) => {
  const { deal, error } = loadDealForParty(req.params.id, req.user.id);
  if (error) return res.status(error === 'not_found' ? 404 : 403).json({ error });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'buyer_only' });
  if (!['proposed','buyer_accepted'].includes(deal.status))
    return res.status(409).json({ error: 'bad_state' });

  const t = now();
  db.prepare("UPDATE deals SET status='rejected', updated_at=? WHERE id=?").run(t, deal.id);
  const updated = db.prepare('SELECT * FROM deals WHERE id=?').get(deal.id);
  notify(deal.seller_id, 'deal.rejected', { deal: updated });
  res.json(updated);
});

// ─── buyer counter-offer (creates a brand-new deal in 'proposed' from the
// buyer side — the seller can then accept by re-proposing, etc.) ──────
r.post('/deals/:id(\\d+)/counter-offer', requireAuth(), (req, res) => {
  const { deal, error } = loadDealForParty(req.params.id, req.user.id);
  if (error) return res.status(error === 'not_found' ? 404 : 403).json({ error });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'buyer_only' });
  if (deal.status !== 'proposed') return res.status(409).json({ error: 'bad_state' });

  const price = Number(req.body?.final_price);
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'bad_price' });

  const t = now();
  db.prepare("UPDATE deals SET status='cancelled', updated_at=? WHERE id=?").run(t, deal.id);

  // The new "deal" is still tagged 'proposed' so the seller can propose
  // back at the same final_price (effectively accepting) — same UX path.
  const ins = db.prepare(
    `INSERT INTO deals(chat_id, listing_id, buyer_id, seller_id, final_price, status, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run(deal.chat_id, deal.listing_id, deal.buyer_id, deal.seller_id, Math.round(price), 'proposed', t, t);
  const counter = db.prepare('SELECT * FROM deals WHERE id=?').get(ins.lastInsertRowid);

  notify(deal.seller_id, 'deal.counter_offer', { deal: counter }, {
    title: 'عرض مضاد من المشتري',
    body: `${price.toLocaleString()} د.ع`,
  });
  res.json(counter);
});

// ─── seller confirms deal — phone number unlocks here ────────────────
r.post('/deals/:id(\\d+)/seller-confirm', requireAuth(), (req, res) => {
  const { deal, error } = loadDealForParty(req.params.id, req.user.id);
  if (error) return res.status(error === 'not_found' ? 404 : 403).json({ error });
  if (deal.seller_id !== req.user.id) return res.status(403).json({ error: 'seller_only' });
  if (deal.status !== 'buyer_accepted') return res.status(409).json({ error: 'bad_state' });

  const reserveOnly = getSetting('reserve_on_confirm') === '1';
  const t = now();

  // Atomic: flip the deal, set the listing, and stamp chat last activity in
  // one transaction so SSE consumers never see an inconsistent half-state.
  db.transaction(() => {
    db.prepare("UPDATE deals SET status='seller_confirmed', updated_at=? WHERE id=?").run(t, deal.id);
    db.prepare(
      `UPDATE phone_listings SET status=?, updated_at=? WHERE id=?`,
    ).run(reserveOnly ? 'reserved' : 'sold', t, deal.listing_id);
    db.prepare('UPDATE chats SET last_message_at=? WHERE id=?').run(t, deal.chat_id);
  })();

  const updated = db.prepare('SELECT * FROM deals WHERE id=?').get(deal.id);
  const sellerPhone = db.prepare('SELECT phone FROM users WHERE id=?').get(deal.seller_id)?.phone || null;

  notify(deal.buyer_id, 'phone.unlocked', {
    deal: updated, seller_phone: sellerPhone,
  }, {
    title: 'تم تأكيد الصفقة',
    body: 'تم فتح رقم البائع',
  });
  notify(deal.seller_id, 'deal.seller_confirmed', { deal: updated });

  res.json({ ...updated, seller_phone: sellerPhone });
});

// ─── either party cancels (only before seller-confirm) ──────────────
r.post('/deals/:id(\\d+)/cancel', requireAuth(), (req, res) => {
  const { deal, error } = loadDealForParty(req.params.id, req.user.id);
  if (error) return res.status(error === 'not_found' ? 404 : 403).json({ error });
  if (!['proposed','buyer_accepted'].includes(deal.status))
    return res.status(409).json({ error: 'bad_state' });
  const t = now();
  db.prepare("UPDATE deals SET status='cancelled', updated_at=? WHERE id=?").run(t, deal.id);
  const updated = db.prepare('SELECT * FROM deals WHERE id=?').get(deal.id);
  const otherId = req.user.id === deal.buyer_id ? deal.seller_id : deal.buyer_id;
  notify(otherId, 'deal.cancelled', { deal: updated });
  res.json(updated);
});

// ─── buyer's confirmed deals ────────────────────────────────────────
r.get('/deals/mine', requireAuth(), (req, res) => {
  const role = req.query.role; // 'buyer' | 'seller'
  const status = req.query.status || 'all';
  let sql = 'SELECT * FROM deals WHERE 1=1';
  const params = [];
  if (role === 'buyer') { sql += ' AND buyer_id=?'; params.push(req.user.id); }
  else if (role === 'seller') { sql += ' AND seller_id=?'; params.push(req.user.id); }
  else { sql += ' AND (buyer_id=? OR seller_id=?)'; params.push(req.user.id, req.user.id); }
  if (status !== 'all') { sql += ' AND status=?'; params.push(status); }
  sql += ' ORDER BY updated_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params);

  // attach listing summary + counterparty + seller phone (only when confirmed)
  const out = rows.map((d) => {
    const l = db.prepare('SELECT id, brand, model, asking_price FROM phone_listings WHERE id=?').get(d.listing_id);
    const seller = db.prepare('SELECT id, display_name, phone, profile_image_path FROM users WHERE id=?').get(d.seller_id);
    const buyer = db.prepare('SELECT id, display_name, profile_image_path FROM users WHERE id=?').get(d.buyer_id);
    const sellerPhone =
      d.status === 'seller_confirmed' && req.user.id === d.buyer_id ? seller?.phone : null;
    return {
      ...d,
      listing: l, buyer,
      seller: seller ? { id: seller.id, display_name: seller.display_name, profile_image_path: seller.profile_image_path, phone: sellerPhone } : null,
    };
  });
  res.json(out);
});

export default r;
