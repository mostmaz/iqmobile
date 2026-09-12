// Phone requests — «أدور على…»: the buyer publishes what he wants and
// SELLERS come to him.
//
// This is the active member of a family of three that were all passive:
//   saved_searches  — stored browse filters      → alert me
//   price_watches   — one listing                → alert me if it drops
//   wishlist_items  — one device + ceiling       → alert me when it appears
// All three leave the buyer waiting for supply to show up. A request instead
// pushes the demand out: it reaches sellers who already hold a matching
// device, then shops that plausibly stock it, and it sits on a public board
// any seller can browse. Sellers answer with offers; the buyer picks.
//
// Offers are their own table rather than chats because `chats.listing_id` is
// NOT NULL — a conversation cannot exist without a listing, and the whole
// point of a request is that nobody has listed the thing yet. An offer that
// DOES point at a listing gives the buyer a tap through to the normal
// listing → chat/call flow; one that doesn't carries the seller's own
// public contact, exactly as a listing card does.
//
// Matching reuses the saved-search/wishlist normalizer, so "iPhone 13" and
// "ايفون ١٣" resolve the same way here as everywhere else.

import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { isBrand } from '../brands.js';
import { isGovernorate, normalizeGovernorate } from '../governorates.js';
import { notify, hasNotified } from '../notify.js';
import { channelsFor, CHANNEL_COLS } from '../contactChannels.js';
import { norm } from './savedSearches.js';
import { requestsAnsweredBy, listingsAnsweringRequest } from '../requestMatch.js';
import { requestPulse } from '../requestPulse.js';

const r = Router();

import { CONDITIONS } from '../conditions.js';
const TTL_MS = 21 * 24 * 60 * 60 * 1000;

// A request reaches real people's phones, so the caps are about protecting
// SELLERS from a blast, not about protecting our storage.
const MAX_OPEN_PER_USER = 5;
const MAX_CREATES_PER_DAY = 5;
const MAX_OFFERS_PER_DAY = 30;
// Ceiling on a single request's broadcast. Beyond this we are no longer
// matching demand to supply, we are sending everyone in the country a push.
const MAX_BROADCAST = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── shaping ─────────────────────────────────────────────────────────

// Compact seller block for an offer. Deliberately NOT the full shopCard:
// this renders inside a list row, and shopCard runs reply-time aggregates
// per shop — fine for one shop page, quadratic across a list of offers.
function sellerCard(u) {
  if (!u) return null;
  const ch = channelsFor(u);
  const isShop = u.seller_type === 'shop';
  return {
    id: u.id,
    name: isShop ? (u.shop_name || u.display_name) : u.display_name,
    is_shop: isShop,
    governorate: u.governorate,
    city: u.city || null,
    profile_image_path: u.profile_image_path || null,
    shop_image_path: u.shop_image_path || null,
    rating_avg: u.rating_avg,
    rating_count: u.rating_count,
    verified: !!u.verified,
    // Same channel rules the listing card obeys — a contact-suppressed shop
    // must not leak the phone it registered with just because it answered
    // a request.
    phone: ch.call ? (isShop ? (u.shop_phone || u.phone) : u.phone) || null : null,
    whatsapp: ch.whatsapp ? (u.shop_whatsapp || null) : null,
    channels: ch,
  };
}

const SELLER_COLS = `id, display_name, shop_name, seller_type, governorate, city,
  profile_image_path, shop_image_path, rating_avg, rating_count, verified, phone,
  shop_phone, shop_whatsapp, ${CHANNEL_COLS}`;

function loadSeller(id) {
  return db.prepare(`SELECT ${SELLER_COLS} FROM users WHERE id=?`).get(id);
}

// One offer, with its seller and (when attached) a thumbnail of the listing
// it points at, so the buyer's list renders without an extra round trip.
function offerRow(o) {
  const listing = o.listing_id
    ? db.prepare(
      `SELECT id, brand, model, storage, color, condition, asking_price, status, governorate
         FROM phone_listings WHERE id=?`,
    ).get(o.listing_id)
    : null;
  const image = listing
    ? db.prepare('SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC LIMIT 1')
      .get(listing.id)?.image_path || null
    : null;
  return {
    id: o.id,
    request_id: o.request_id,
    price: o.price,
    note: o.note || null,
    created_at: o.created_at,
    seller: sellerCard(loadSeller(o.seller_id)),
    listing: listing ? { ...listing, image_path: image } : null,
  };
}

// `viewer` decides how much comes back:
//   the buyer  → every offer
//   a seller   → only his own (`my_offer`), never a rival's price
//   anyone     → the request itself + offer_count
function publicRequest(row, viewerId) {
  const buyer = db.prepare('SELECT id, display_name, profile_image_path FROM users WHERE id=?').get(row.buyer_id);
  const isOwner = viewerId != null && viewerId === row.buyer_id;
  const base = {
    id: row.id,
    brand: row.brand,
    model: row.model,
    condition: row.condition || null,
    max_price: row.max_price,
    governorate: row.governorate,
    note: row.note || null,
    status: row.status,
    offer_count: row.offer_count,
    created_at: row.created_at,
    expires_at: row.expires_at,
    is_mine: isOwner,
    // Buyer identity is a name and a face, never a number. A public board
    // carrying phone numbers is a scraper's shopping list.
    buyer: buyer ? { id: buyer.id, display_name: buyer.display_name, profile_image_path: buyer.profile_image_path || null } : null,
  };

  if (isOwner) {
    const offers = db.prepare(
      "SELECT * FROM request_offers WHERE request_id=? AND status='sent' ORDER BY price ASC, created_at ASC",
    ).all(row.id);
    return { ...base, offers: offers.map(offerRow) };
  }
  if (viewerId != null) {
    const mine = db.prepare("SELECT * FROM request_offers WHERE request_id=? AND seller_id=? AND status='sent'")
      .get(row.id, viewerId);
    return { ...base, my_offer: mine ? offerRow(mine) : null };
  }
  return base;
}

// ─── fan-out ─────────────────────────────────────────────────────────

function priceLine(request) {
  return `حتى ${Number(request.max_price).toLocaleString('en-US')} د.ع · ${request.governorate}`;
}

// Sellers holding a listing that already satisfies the request. These are
// the highest-value recipients by a distance: they can answer in one tap,
// and their offer arrives with a real device attached.
//
// The rule itself lives in requestMatch.js, because the dashboard counts the
// same listings to tell an unanswered request apart from an unfillable one.
// Two copies of "does this listing satisfy that request" is how the console
// ends up reporting supply the broadcast never used.
function sellersWithMatchingListing(request) {
  const seen = new Map();
  for (const row of listingsAnsweringRequest(db, request, norm, { limit: Infinity })) {
    // Cheapest match per seller — that is the one he'd quote anyway, and
    // because the rows come back ordered by price it is also the one most
    // likely to be inside the budget rather than over it.
    if (!seen.has(row.seller_id)) {
      seen.set(row.seller_id, {
        listing_id: row.id,
        price: row.asking_price,
        above_budget: row.above_budget,
      });
    }
  }
  return seen;
}

// Sellers who plausibly have it but have nothing listed that matches.
//
// Shops AND individuals. Most phones in Iraq change hands between people,
// not through shops, and an individual who has sold three Samsungs is a
// better lead for a Samsung request than a shop across the country — but
// the two need different thresholds, because there are far more individuals
// than shops:
//
//   shop        — same governorate OR a history of selling the brand.
//                 A shop is a business that wants leads; being nearby is
//                 reason enough to tell it.
//   individual  — a history of selling the brand, full stop. "Lives in
//                 Baghdad" describes a third of the country and pushing to
//                 all of them is the blast MAX_BROADCAST exists to prevent.
//                 Having listed that brand is a real signal.
//
// Ordered so the most likely responders survive the MAX_BROADCAST cut, and
// shops still sort above individuals at equal signal: a shop answers a
// request as part of its day, a person answers it as a favour.
function sellersToBroadcast(request, exclude) {
  const rows = db.prepare(
    `SELECT u.id,
            (u.seller_type='shop') AS is_shop,
            (u.governorate=?) AS same_gov,
            EXISTS(SELECT 1 FROM phone_listings l
                    WHERE l.seller_id=u.id AND l.brand=?
                      AND l.status IN ('active','reserved','sold')) AS sells_brand
       FROM users u
      WHERE COALESCE(u.is_guest,0)=0
        -- A shop that is hidden, unapproved, contactless or admin-created
        -- answers nobody: the price book has no operator behind it and an
        -- admin-made shop's owner never installed the app. These columns are
        -- NULL for an individual, so COALESCE lets them through.
        AND COALESCE(u.shop_hidden,0)=0
        AND COALESCE(u.shop_status,'approved')='approved'
        AND COALESCE(u.shop_no_contact,0)=0
        AND COALESCE(u.shop_origin,'') <> 'admin'
      ORDER BY same_gov DESC, sells_brand DESC, is_shop DESC,
               u.rating_avg DESC, u.rating_count DESC`,
  ).all(request.governorate, request.brand);

  const out = [];
  for (const row of rows) {
    if (exclude.has(row.id) || row.id === request.buyer_id) continue;
    // The thresholds above, as the one line that enforces them.
    const lead = row.is_shop ? (row.same_gov || row.sells_brand) : row.sells_brand;
    if (!lead) continue;
    out.push({ id: row.id, is_shop: !!row.is_shop });
    if (out.length >= MAX_BROADCAST) break;
  }
  return out;
}

// Announce a new request. Never throws — a failed push must not fail the
// create, so callers run it inside setImmediate and this swallows.
export function broadcastRequest(request) {
  try {
    const title = `مطلوب: ${request.brand} ${request.model}`;
    const body = priceLine(request);

    const matches = sellersWithMatchingListing(request);
    for (const [sellerId, m] of matches) {
      notify(
        sellerId,
        'request.match',
        {
          request_id: request.id, listing_id: m.listing_id, brand: request.brand, model: request.model,
          max_price: request.max_price, governorate: request.governorate,
          listing_price: m.price, above_budget: m.above_budget,
        },
        {
          title: m.above_budget ? 'جهاز قريب من طلب مشترٍ' : 'لديك جهاز مطلوب 🎯',
          // Say the gap out loud. A seller who opens this expecting a clean
          // match and finds his price is over the budget learns we wasted
          // his time; one who is told up front can decide to negotiate.
          body: m.above_budget
            ? `${title} — ميزانيته ${Number(request.max_price).toLocaleString('en-US')} د.ع وسعرك ${Number(m.price).toLocaleString('en-US')} · ${request.governorate}`
            : `${title} — ${body}`,
        },
      );
    }

    for (const s of sellersToBroadcast(request, matches)) {
      notify(
        s.id,
        'request.new',
        { request_id: request.id, brand: request.brand, model: request.model, max_price: request.max_price, governorate: request.governorate },
        {
          // «متجرك» to a person who has no shop is the app talking to
          // somebody else. An individual is reached because they have sold
          // this brand before, so say that instead.
          title: s.is_shop ? 'طلب جديد يناسب متجرك' : 'مشترٍ يدور على جهاز مثل الذي بعته',
          body: `${title} — ${body}`,
        },
      );
    }
  } catch (e) {
    console.error('[requests] broadcast failed:', e?.message);
  }
}

// The other direction in time: a seller posts a listing that answers a
// request already on the board. Without this a request only ever reaches
// stock that existed the moment it was written, which makes the board dead
// for anything nobody happens to be holding today.
//
// Called from the listing-create path alongside alertWishlistOnListing.
export function alertRequestsOnListing(listing) {
  try {
    if (!listing || listing.status !== 'active' || listing.is_draft) return;
    // One rule, shared with GET /listings/:id/matching-requests — the push
    // and the screen it links to must never disagree about what counts.
    // No governorate filter here: a notification costs the buyer nothing,
    // and whether a phone is worth travelling for is the seller's call.
    const open = requestsAnsweredBy(db, listing, norm, { now: now() });

    let sent = 0;
    for (const request of open) {
      // Once per (seller, request): re-posting or editing the listing must
      // not re-nag the seller about the same open request.
      if (hasNotified(listing.seller_id, 'request.match', listing.id)) break;
      const aboveBudget = request.above_budget;
      notify(
        listing.seller_id,
        'request.match',
        {
          request_id: request.id, listing_id: listing.id, brand: request.brand, model: request.model,
          max_price: request.max_price, governorate: request.governorate,
          listing_price: listing.asking_price, above_budget: aboveBudget,
        },
        {
          title: aboveBudget ? 'مشترٍ يبحث عن هذا الجهاز' : 'مشترٍ يبحث عن هذا الجهاز 🎯',
          body: aboveBudget
            ? `${request.brand} ${request.model} — ميزانيته ${Number(request.max_price).toLocaleString('en-US')} د.ع وسعرك ${Number(listing.asking_price).toLocaleString('en-US')} · ${request.governorate}`
            : `${request.brand} ${request.model} — ${priceLine(request)}`,
        },
      );
      // One push per new listing, however many requests it answers; the
      // seller opens the board and sees the rest.
      if (++sent >= 1) break;
    }
  } catch (e) {
    console.error('[requests] listing alert failed:', e?.message);
  }
}

// Lazily retire requests that ran out the clock. Cheap, and it keeps the
// board honest without a cron: any read of the board sweeps first.
function expireStale() {
  try {
    db.prepare("UPDATE phone_requests SET status='expired' WHERE status='open' AND expires_at <= ?").run(now());
  } catch (e) {
    console.error('[requests] expire failed:', e?.message);
  }
}

// ─── the board ───────────────────────────────────────────────────────

r.get('/phone-requests', optionalAuth(), (req, res) => {
  expireStale();
  const params = [];
  let sql = "SELECT * FROM phone_requests WHERE status='open' AND expires_at > ?";
  params.push(now());

  if (req.query.governorate) {
    const g = normalizeGovernorate(String(req.query.governorate));
    if (g && isGovernorate(g)) { sql += ' AND governorate=?'; params.push(g); }
  }
  if (req.query.brand) { sql += ' AND brand=?'; params.push(String(req.query.brand)); }
  // "Only the ones I can actually fill": requests matching a brand this
  // seller has ever listed. The shops tab's default view.
  if (req.query.mine_to_answer === '1' && req.user?.id) {
    sql += ` AND brand IN (SELECT DISTINCT brand FROM phone_listings WHERE seller_id=?)`;
    params.push(req.user.id);
  }

  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
  const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
  // The feed's quick sorts. `budget` puts the money first because that is
  // what a shop deciding whether to reply is weighing; `no_offers` is the
  // opposite view — the requests nobody has answered yet, which are the ones
  // where a reply actually wins something. Both keep recency as the
  // tiebreak, so neither can strand an old request at the top forever.
  const ORDER = {
    new: 'created_at DESC',
    budget: 'max_price DESC, created_at DESC',
    no_offers: 'COALESCE(offer_count,0) ASC, created_at DESC',
  };
  sql += ` ORDER BY ${ORDER[String(req.query.sort || '')] || ORDER.new} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((row) => publicRequest(row, req.user?.id ?? null)));
});

// Open requests that a listing of MINE answers, in my governorate.
//
// The other direction from the board: a seller has just posted a phone and
// somebody nearby has already written down that they want it. Without this
// the only way to find that out is a push notification, which is a single
// alert for however many requests match and is gone once dismissed.
//
// Same-governorate only, unlike the push. The screen's promise is "these
// people are near you and want this today"; a buyer four hours away is a
// notification, not a to-do list.
r.get('/listings/:id(\\d+)/matching-requests', requireAuth(), (req, res) => {
  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(Number(req.params.id));
  // 404 then 403, the same order the rest of the app uses: a stranger must
  // not be able to tell an id that exists from one that does not.
  if (!listing) return res.status(404).json({ error: 'not_found' });
  if (listing.seller_id !== req.user.id) return res.status(403).json({ error: 'not_yours' });

  expireStale();
  const rows = requestsAnsweredBy(db, listing, norm, {
    now: now(), sameGovernorateOnly: true, limit: 10,
  });
  res.json(rows.map((row) => ({
    ...publicRequest(row, req.user.id),
    // Computed against THIS listing, so it belongs on the response rather
    // than on the request itself.
    above_budget: row.above_budget,
  })));
});

// How busy the request feature is, near you.
//
// One endpoint for three call sites that must agree: the الطلبات tab badge,
// the line under the feed's title, and the invite card's «خل N تاجر يشوفون
// طلبك». They used to be three different claims because nothing computed
// them; see requestPulse.js for why the numbers are shaped the way they are.
//
// optionalAuth: a signed-out browser still sees the feed, so it still gets a
// headline number. The governorate then has to come from the query string.
r.get('/phone-requests/pulse', optionalAuth(), (req, res) => {
  expireStale();
  const raw = req.query.governorate ?? req.user?.governorate ?? '';
  const g = normalizeGovernorate(String(raw));
  const since = Math.max(0, parseInt(String(req.query.since || '0'), 10) || 0);
  res.json(requestPulse(db, {
    governorate: g && isGovernorate(g) ? g : null,
    since,
    now: now(),
    maxReach: MAX_BROADCAST,
  }));
});

// Must precede /:id — otherwise "mine" is parsed as an id.
r.get('/phone-requests/mine', requireAuth(), (req, res) => {
  expireStale();
  const rows = db.prepare('SELECT * FROM phone_requests WHERE buyer_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map((row) => publicRequest(row, req.user.id)));
});

// A seller's own sent offers, so a shop can see what it has already quoted
// without walking the board.
r.get('/phone-requests/offers/mine', requireAuth(), (req, res) => {
  const rows = db.prepare(
    `SELECT o.*, q.brand, q.model, q.max_price, q.governorate, q.status AS request_status
       FROM request_offers o JOIN phone_requests q ON q.id=o.request_id
      WHERE o.seller_id=? AND o.status='sent'
      ORDER BY o.created_at DESC LIMIT 100`,
  ).all(req.user.id);
  res.json(rows.map((o) => ({
    ...offerRow(o),
    request: {
      id: o.request_id, brand: o.brand, model: o.model,
      max_price: o.max_price, governorate: o.governorate, status: o.request_status,
    },
  })));
});

r.get('/phone-requests/:id(\\d+)', optionalAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM phone_requests WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(publicRequest(row, req.user?.id ?? null));
});

r.post('/phone-requests', requireAuth(), (req, res) => {
  // A request rings other people's phones and the answers come back by
  // phone call, so it needs an account with a real number behind it. A
  // guest row's phone is synthetic — nobody could complete the trade.
  const me = db.prepare('SELECT is_guest FROM users WHERE id=?').get(req.user.id);
  if (me?.is_guest) return res.status(403).json({ error: 'guest_not_allowed' });

  const brand = String(req.body?.brand || '').trim();
  const model = String(req.body?.model || '').trim().slice(0, 80);
  const maxPrice = Math.floor(Number(req.body?.max_price));
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 300) : null;
  const condition = req.body?.condition ? String(req.body.condition) : null;

  if (!brand || !isBrand(brand)) return res.status(400).json({ error: 'bad_brand' });
  if (!model) return res.status(400).json({ error: 'model_required' });
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) return res.status(400).json({ error: 'bad_price' });
  if (condition && !CONDITIONS.includes(condition)) return res.status(400).json({ error: 'bad_condition' });

  const gov = normalizeGovernorate(String(req.body?.governorate || ''))
    || db.prepare('SELECT governorate FROM users WHERE id=?').get(req.user.id)?.governorate;
  if (!gov || !isGovernorate(gov)) return res.status(400).json({ error: 'bad_governorate' });

  expireStale();
  const t = now();

  // Re-requesting something already on the board is almost always a double
  // tap or a forgotten request — return the existing one rather than
  // broadcasting the same demand to the same shops twice.
  const dup = db.prepare(
    "SELECT * FROM phone_requests WHERE buyer_id=? AND brand=? AND model=? AND status='open' AND expires_at > ?",
  ).get(req.user.id, brand, model, t);
  if (dup) return res.status(409).json({ error: 'already_open', request: publicRequest(dup, req.user.id) });

  const openCount = db.prepare("SELECT COUNT(*) AS n FROM phone_requests WHERE buyer_id=? AND status='open' AND expires_at > ?")
    .get(req.user.id, t).n;
  if (openCount >= MAX_OPEN_PER_USER) return res.status(400).json({ error: 'too_many_open' });

  // Separately from the open cap: closing and re-opening must not be a way
  // to re-broadcast on a loop.
  const todayCount = db.prepare('SELECT COUNT(*) AS n FROM phone_requests WHERE buyer_id=? AND created_at > ?')
    .get(req.user.id, t - DAY_MS).n;
  if (todayCount >= MAX_CREATES_PER_DAY) return res.status(429).json({ error: 'too_many_today' });

  const id = db.prepare(
    `INSERT INTO phone_requests(buyer_id, brand, model, condition, max_price, governorate, note, status, created_at, expires_at)
     VALUES(?,?,?,?,?,?,?,'open',?,?)`,
  ).run(req.user.id, brand, model, condition, maxPrice, gov, note, t, t + TTL_MS).lastInsertRowid;

  const row = db.prepare('SELECT * FROM phone_requests WHERE id=?').get(id);
  // After the response, never before it: the fan-out walks every shop.
  setImmediate(() => broadcastRequest(row));
  res.json(publicRequest(row, req.user.id));
});

r.patch('/phone-requests/:id(\\d+)', requireAuth(), (req, res) => {
  const row = db.prepare('SELECT * FROM phone_requests WHERE id=? AND buyer_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const status = String(req.body?.status || '');
  if (!['fulfilled', 'closed', 'open'].includes(status)) return res.status(400).json({ error: 'bad_status' });
  // Reopening an expired request would hand it a fresh broadcast for free.
  if (status === 'open' && row.status === 'expired') return res.status(400).json({ error: 'expired' });

  db.prepare('UPDATE phone_requests SET status=?, closed_at=? WHERE id=?')
    .run(status, status === 'open' ? null : now(), row.id);
  res.json(publicRequest(db.prepare('SELECT * FROM phone_requests WHERE id=?').get(row.id), req.user.id));
});

r.delete('/phone-requests/:id(\\d+)', requireAuth(), (req, res) => {
  const info = db.prepare('DELETE FROM phone_requests WHERE id=? AND buyer_id=?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ─── offers ──────────────────────────────────────────────────────────

r.post('/phone-requests/:id(\\d+)/offers', requireAuth(), (req, res) => {
  const request = db.prepare('SELECT * FROM phone_requests WHERE id=?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'not_found' });
  if (request.buyer_id === req.user.id) return res.status(400).json({ error: 'own_request' });
  if (request.status !== 'open' || request.expires_at <= now()) return res.status(400).json({ error: 'request_closed' });

  const me = db.prepare('SELECT is_guest FROM users WHERE id=?').get(req.user.id);
  if (me?.is_guest) return res.status(403).json({ error: 'guest_not_allowed' });

  const price = Math.floor(Number(req.body?.price));
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 300) : null;
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'bad_price' });

  let listingId = null;
  if (req.body?.listing_id != null) {
    const l = db.prepare('SELECT id, seller_id, status FROM phone_listings WHERE id=?').get(req.body.listing_id);
    // Attaching someone else's listing would let a seller advertise stock
    // he does not have, with another shop's photos.
    if (!l || l.seller_id !== req.user.id) return res.status(400).json({ error: 'bad_listing' });
    if (!['active', 'reserved'].includes(l.status)) return res.status(400).json({ error: 'listing_not_active' });
    listingId = l.id;
  }

  const t = now();
  const existing = db.prepare('SELECT * FROM request_offers WHERE request_id=? AND seller_id=?')
    .get(request.id, req.user.id);

  if (!existing) {
    const todayCount = db.prepare("SELECT COUNT(*) AS n FROM request_offers WHERE seller_id=? AND created_at > ?")
      .get(req.user.id, t - DAY_MS).n;
    if (todayCount >= MAX_OFFERS_PER_DAY) return res.status(429).json({ error: 'too_many_offers_today' });
  }

  // Re-offering edits in place (the UNIQUE), so a shop can correct a price
  // without the buyer collecting three rows from the same seller.
  db.prepare(
    `INSERT INTO request_offers(request_id, seller_id, listing_id, price, note, status, created_at)
     VALUES(?,?,?,?,?,'sent',?)
     ON CONFLICT(request_id, seller_id)
     DO UPDATE SET listing_id=excluded.listing_id, price=excluded.price,
                   note=excluded.note, status='sent', created_at=excluded.created_at`,
  ).run(request.id, req.user.id, listingId, price, note, t);

  const offer = db.prepare('SELECT * FROM request_offers WHERE request_id=? AND seller_id=?')
    .get(request.id, req.user.id);

  // offer_count counts LIVE offers, so it has to be recomputed rather than
  // incremented — an edit must not bump it, a withdraw must drop it.
  db.prepare(
    "UPDATE phone_requests SET offer_count=(SELECT COUNT(*) FROM request_offers WHERE request_id=? AND status='sent') WHERE id=?",
  ).run(request.id, request.id);

  // A revised price is worth a push (it is usually a discount); the first
  // offer obviously is.
  const seller = loadSeller(req.user.id);
  const sellerName = seller?.seller_type === 'shop' ? (seller.shop_name || seller.display_name) : seller?.display_name;
  notify(
    request.buyer_id,
    'request.offer',
    { request_id: request.id, offer_id: offer.id, seller_id: req.user.id, price, listing_id: listingId, brand: request.brand, model: request.model },
    {
      title: existing ? 'تحديث عرض على طلبك' : 'وصلك عرض على طلبك 💬',
      body: `${sellerName || 'بائع'} — ${Number(price).toLocaleString('en-US')} د.ع · ${request.brand} ${request.model}`,
    },
  );

  res.json(offerRow(offer));
});

r.delete('/phone-requests/:id(\\d+)/offers/mine', requireAuth(), (req, res) => {
  const info = db.prepare("UPDATE request_offers SET status='withdrawn' WHERE request_id=? AND seller_id=? AND status='sent'")
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  db.prepare(
    "UPDATE phone_requests SET offer_count=(SELECT COUNT(*) FROM request_offers WHERE request_id=? AND status='sent') WHERE id=?",
  ).run(req.params.id, req.params.id);
  res.json({ ok: true });
});

export default r;

// Exported for tests only. `sellersToBroadcast` is a SQL query with four
// COALESCE guards whose whole job is to let an individual's NULL shop
// columns through — exactly the kind of thing that breaks silently, so it
// gets tested directly rather than through a push nobody can observe.
export const __testables = { sellersToBroadcast };
