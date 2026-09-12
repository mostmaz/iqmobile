// What the operator needs to know about «أدور على…» requests: how much
// demand there is, whether the site can already fill it, and whether sellers
// answered.
//
// Three numbers per request, and they are deliberately not interchangeable:
//
//   offers          — sellers who actually answered
//   matched devices — listings live right now that satisfy the request
//   in budget       — of those, the ones at or under the buyer's own ceiling
//
// A request with matched devices and no offers is a broadcast that did not
// land: the phones are here and the sellers ignored the buyer. A request with
// neither is unmet demand — stock worth importing. Those two failures need
// opposite responses from the operator, and one combined "unanswered" count
// hides which one is happening, so both are measured.
//
// The matching rule itself is NOT redefined here. `listingsAnsweringRequest`
// in requestMatch.js is the rule the seller broadcast already runs on; this
// module either calls it, or buckets its inputs so a whole page of requests
// can be counted without one query each.

import { CEILING_SLACK, listingsAnsweringRequest } from './requestMatch.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Never scan the whole table for the summary — see `capped` in the output. */
export const MAX_SCAN = 600;

/**
 * Supply counts for MANY requests, at one query per distinct brand.
 *
 * The per-request function is fine for a detail screen and wrong for a list:
 * 50 rows meant 50 scans of the brand index, and the summary walks hundreds.
 * The normalizer has to run in JS either way (SQLite has no `norm()`), so the
 * cheap shape is one pull per brand, bucketed by folded model, then arithmetic
 * per request.
 */
export function supplyIndex(db, requests, norm) {
  const brands = [...new Set(requests.map((r) => r.brand).filter(Boolean))];
  const byBrand = new Map();

  if (brands.length) {
    const rows = db.prepare(
      `SELECT id, seller_id, brand, model, asking_price
         FROM phone_listings
        WHERE status IN ('active','reserved') AND COALESCE(is_draft,0)=0
          AND brand IN (${brands.map(() => '?').join(',')})`,
    ).all(...brands);
    for (const row of rows) {
      let models = byBrand.get(row.brand);
      if (!models) { models = new Map(); byBrand.set(row.brand, models); }
      const key = norm(row.model);
      const bucket = models.get(key);
      if (bucket) bucket.push(row); else models.set(key, [row]);
    }
  }

  return {
    /**
     * @returns `{ matched, in_budget, call_for_price, cheapest }` — `matched`
     *          obeys the broadcast's slack, `in_budget` the buyer's stated
     *          ceiling, and `cheapest` skips the call-for-price sentinel so a
     *          "from 1 د.ع" can never reach a dashboard figure.
     */
    for(request) {
      const rows = byBrand.get(request.brand)?.get(norm(request.model)) || [];
      const ceiling = Math.round(Number(request.max_price) * CEILING_SLACK);
      let matched = 0, inBudget = 0, callForPrice = 0, cheapest = null;
      for (const row of rows) {
        if (row.seller_id === request.buyer_id) continue;
        if (!(row.asking_price <= ceiling)) continue;
        matched++;
        if (Number(row.asking_price) <= 1) { callForPrice++; continue; }
        if (row.asking_price <= Number(request.max_price)) inBudget++;
        if (cheapest === null || row.asking_price < cheapest) cheapest = row.asking_price;
      }
      return { matched, in_budget: inBudget, call_for_price: callForPrice, cheapest };
    },
  };
}

/**
 * Live offer figures per request id, for the ids given.
 *
 * `phone_requests.offer_count` is denormalised and maintained by the offer
 * create/withdraw paths only, so it is what the app renders — but a console
 * that repeats it cannot show that it drifted. These are counted from the
 * rows, and the detail endpoint reports both.
 */
export function offerStats(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT request_id,
            SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status='withdrawn' THEN 1 ELSE 0 END) AS withdrawn,
            MIN(CASE WHEN status='sent' THEN price END) AS best_price,
            MIN(CASE WHEN status='sent' THEN created_at END) AS first_at,
            MAX(CASE WHEN status='sent' THEN created_at END) AS last_at
       FROM request_offers WHERE request_id IN (${marks})
      GROUP BY request_id`,
  ).all(...ids);
  for (const row of rows) {
    out.set(row.request_id, {
      sent: row.sent || 0,
      withdrawn: row.withdrawn || 0,
      best_price: row.best_price ?? null,
      first_at: row.first_at ?? null,
      last_at: row.last_at ?? null,
    });
  }
  return out;
}

const EMPTY_OFFERS = { sent: 0, withdrawn: 0, best_price: null, first_at: null, last_at: null };

/**
 * Rows as the dashboard's list renders them: the request, who asked, what the
 * site holds for it, and who answered.
 *
 * `status` is the stored one, but `is_live` is what the board obeys — the
 * expirer is a lazy sweep (see requestPulse.js), so a row can sit at 'open'
 * past its window. A console that showed that as open would be reporting
 * demand no seller can see.
 */
export function decorateRequests(db, rows, norm, { now = Date.now() } = {}) {
  if (!rows.length) return [];
  const supply = supplyIndex(db, rows, norm);
  const offers = offerStats(db, rows.map((r) => r.id));

  return rows.map((row) => {
    const s = supply.for(row);
    const o = offers.get(row.id) || EMPTY_OFFERS;
    return {
      id: row.id,
      brand: row.brand,
      model: row.model,
      condition: row.condition || null,
      max_price: row.max_price,
      governorate: row.governorate,
      note: row.note || null,
      status: row.status,
      is_live: row.status === 'open' && row.expires_at > now,
      created_at: row.created_at,
      expires_at: row.expires_at,
      closed_at: row.closed_at ?? null,
      buyer: {
        id: row.buyer_id,
        name: row.buyer_name ?? null,
        phone: row.buyer_phone ?? null,
        seller_type: row.buyer_seller_type ?? null,
        governorate: row.buyer_governorate ?? null,
      },
      matched_devices: s.matched,
      matched_in_budget: s.in_budget,
      matched_call_for_price: s.call_for_price,
      cheapest_match: s.cheapest,
      offers: o.sent,
      offers_withdrawn: o.withdrawn,
      offer_count_stored: row.offer_count,
      best_offer: o.best_price,
      first_offer_at: o.first_at,
      last_offer_at: o.last_at,
      // The one derived figure worth storing on the row: how long the buyer
      // waited. Nulls stay null — a request nobody answered has no wait, and
      // a zero there would drag the median toward "instant".
      first_response_ms: o.first_at ? o.first_at - row.created_at : null,
    };
  });
}

/** Columns every list/detail query selects, so the shapes cannot drift. */
export const REQUEST_COLS = `r.id, r.buyer_id, r.brand, r.model, r.condition, r.max_price,
  r.governorate, r.note, r.status, r.offer_count, r.created_at, r.expires_at, r.closed_at,
  u.display_name AS buyer_name, u.phone AS buyer_phone, u.seller_type AS buyer_seller_type,
  u.governorate AS buyer_governorate`;

function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * Most-used spelling wins the label, same rule the request funnel's chips use.
 * Ties go to the first seen, and the scan is newest-first, so "iPhone 13" and
 * «ايفون ١٣» at one request each resolve to whichever a buyer typed most
 * recently — arbitrary between the two, but stable between refreshes, which
 * is the property that matters when an operator is reading a ranking.
 */
function commonestLabel(counts) {
  let best = null, bestN = -1;
  for (const [label, n] of counts) if (n > bestN) { best = label; bestN = n; }
  return best;
}

/**
 * The dashboard's headline block.
 *
 * @param opts.days     window for the "recent demand" half of the numbers
 * @param opts.maxScan  how many requests get a supply count — the totals are
 *                      SQL over the whole table and always exact; only the
 *                      supply/model breakdowns are scan-bound, and `capped`
 *                      says when that bound was hit rather than quietly
 *                      reporting a smaller site than there is.
 */
export function requestSummary(db, norm, { now = Date.now(), days = 30, maxScan = MAX_SCAN } = {}) {
  const from = now - days * DAY_MS;

  const totals = db.prepare(`
    SELECT COUNT(*) AS all_time,
           SUM(CASE WHEN status='open' AND expires_at > ? THEN 1 ELSE 0 END) AS open_live,
           SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_stored,
           SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END) AS fulfilled,
           SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) AS expired,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_24h,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d,
           SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_window,
           SUM(CASE WHEN status='open' AND expires_at > ? AND expires_at <= ? THEN 1 ELSE 0 END) AS expiring_48h,
           COUNT(DISTINCT buyer_id) AS buyers
      FROM phone_requests
  `).get(now, now - DAY_MS, now - 7 * DAY_MS, from, now, now + 2 * DAY_MS);

  const offerTotals = db.prepare(`
    SELECT SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
           SUM(CASE WHEN status='withdrawn' THEN 1 ELSE 0 END) AS withdrawn,
           SUM(CASE WHEN status='sent' AND created_at >= ? THEN 1 ELSE 0 END) AS sent_7d,
           SUM(CASE WHEN status='sent' AND created_at >= ? THEN 1 ELSE 0 END) AS sent_window,
           COUNT(DISTINCT CASE WHEN status='sent' THEN seller_id END) AS sellers,
           COUNT(DISTINCT CASE WHEN status='sent' THEN request_id END) AS answered,
           COUNT(DISTINCT CASE WHEN status='sent' AND listing_id IS NOT NULL THEN id END) AS with_listing
      FROM request_offers
  `).get(now - 7 * DAY_MS, from);

  // How long a buyer waits for the first answer, over every request that ever
  // got one. The median, not the mean: one request answered three weeks late
  // moves a mean by hours and says nothing about the usual experience.
  const firstResponses = db.prepare(`
    SELECT MIN(o.created_at) - r.created_at AS wait
      FROM phone_requests r JOIN request_offers o ON o.request_id = r.id AND o.status='sent'
     GROUP BY r.id
  `).all().map((x) => x.wait).filter((x) => Number.isFinite(x) && x >= 0);

  const unansweredOpen = db.prepare(`
    SELECT COUNT(*) AS n FROM phone_requests r
     WHERE r.status='open' AND r.expires_at > ?
       AND NOT EXISTS(SELECT 1 FROM request_offers o WHERE o.request_id=r.id AND o.status='sent')
  `).get(now).n;

  // The scan: live requests first (coverage is about demand a seller can still
  // answer), then the rest of the window (the model/governorate breakdowns
  // want recent history too). One ORDER BY does both — live rows sort first.
  const scanRows = db.prepare(`
    SELECT id, buyer_id, brand, model, max_price, governorate, status, created_at, expires_at, offer_count
      FROM phone_requests
     WHERE (status='open' AND expires_at > ?) OR created_at >= ?
     ORDER BY (status='open' AND expires_at > ?) DESC, created_at DESC
     LIMIT ?
  `).all(now, from, now, maxScan + 1);
  const capped = scanRows.length > maxScan;
  const scan = capped ? scanRows.slice(0, maxScan) : scanRows;

  const supply = supplyIndex(db, scan, norm);
  const offers = offerStats(db, scan.map((x) => x.id));

  let openScanned = 0, openWithMatch = 0, openMatchedDevices = 0, openMatchedUnanswered = 0;
  const models = new Map();       // folded model → aggregate
  const govs = new Map();         // governorate → aggregate

  for (const row of scan) {
    const s = supply.for(row);
    const o = offers.get(row.id) || EMPTY_OFFERS;
    const live = row.status === 'open' && row.expires_at > now;

    if (live) {
      openScanned++;
      openMatchedDevices += s.matched;
      if (s.matched > 0) {
        openWithMatch++;
        // The expensive fact and the point of the whole block: the phone is
        // on the site, the buyer asked for it, and no seller replied.
        if (!o.sent) openMatchedUnanswered++;
      }
    }

    if (row.created_at >= from) {
      const key = `${row.brand} ${norm(row.model)}`;
      let m = models.get(key);
      if (!m) {
        m = { brand: row.brand, labels: new Map(), requests: 0, offers: 0, matched: 0, unanswered: 0, max_prices: [] };
        models.set(key, m);
      }
      m.labels.set(row.model, (m.labels.get(row.model) || 0) + 1);
      m.requests++;
      m.offers += o.sent;
      m.matched += s.matched;
      if (!o.sent) m.unanswered++;
      m.max_prices.push(row.max_price);

      const g = govs.get(row.governorate) || { name: row.governorate, requests: 0, offers: 0, unanswered: 0 };
      g.requests++;
      g.offers += o.sent;
      if (!o.sent) g.unanswered++;
      govs.set(row.governorate, g);
    }
  }

  const top_models = [...models.values()]
    .map((m) => ({
      brand: m.brand,
      model: commonestLabel(m.labels),
      requests: m.requests,
      offers: m.offers,
      matched: m.matched,
      unanswered: m.unanswered,
      median_budget: median(m.max_prices),
    }))
    .sort((a, b) => b.requests - a.requests || b.unanswered - a.unanswered)
    .slice(0, 12);

  const by_governorate = [...govs.values()].sort((a, b) => b.requests - a.requests);

  const by_brand = db.prepare(`
    SELECT brand AS name, COUNT(*) AS count FROM phone_requests
     WHERE created_at >= ? GROUP BY brand ORDER BY count DESC
  `).all(from);

  const sent = offerTotals.sent || 0;
  const answered = offerTotals.answered || 0;

  return {
    generated_at: now,
    window_days: days,
    totals: {
      all_time: totals.all_time || 0,
      open: totals.open_live || 0,
      // Stored-minus-live is the expirer's backlog: rows the board already
      // hides. Worth seeing, never worth counting as demand.
      open_awaiting_expiry: Math.max(0, (totals.open_stored || 0) - (totals.open_live || 0)),
      fulfilled: totals.fulfilled || 0,
      closed: totals.closed || 0,
      expired: totals.expired || 0,
      new_24h: totals.new_24h || 0,
      new_7d: totals.new_7d || 0,
      new_window: totals.new_window || 0,
      expiring_48h: totals.expiring_48h || 0,
      buyers: totals.buyers || 0,
    },
    offers: {
      sent,
      withdrawn: offerTotals.withdrawn || 0,
      sent_7d: offerTotals.sent_7d || 0,
      sent_window: offerTotals.sent_window || 0,
      with_listing: offerTotals.with_listing || 0,
      sellers: offerTotals.sellers || 0,
      answered_requests: answered,
      answer_rate: totals.all_time ? Math.round((answered / totals.all_time) * 1000) / 10 : null,
      per_answered_request: answered ? Math.round((sent / answered) * 10) / 10 : null,
      unanswered_open: unansweredOpen,
      median_first_response_ms: median(firstResponses),
    },
    supply: {
      open_scanned: openScanned,
      with_match: openWithMatch,
      without_match: openScanned - openWithMatch,
      with_match_pct: openScanned ? Math.round((openWithMatch / openScanned) * 1000) / 10 : null,
      matched_devices: openMatchedDevices,
      matched_but_unanswered: openMatchedUnanswered,
      scan_capped: capped,
      scanned: scan.length,
    },
    top_models,
    by_governorate,
    by_brand,
  };
}

/**
 * The compact block the landing overview carries. Same numbers as the full
 * summary, chosen so /admin/overview stays one cheap round trip: nothing here
 * scans more than the live board.
 */
export function requestOverview(db, norm, { now = Date.now(), maxScan = 300 } = {}) {
  // 30 days for the model ranking: which phones people ask for is a slow
  // fact, and a week-long window lets one quiet fortnight empty the list.
  // The 7-day figures below are their own SQL columns, not this window.
  const s = requestSummary(db, norm, { now, days: 30, maxScan });
  return {
    open: s.totals.open,
    new_7d: s.totals.new_7d,
    fulfilled: s.totals.fulfilled,
    expiring_48h: s.totals.expiring_48h,
    offers: s.offers.sent,
    offers_7d: s.offers.sent_7d,
    answer_rate: s.offers.answer_rate,
    unanswered_open: s.offers.unanswered_open,
    median_first_response_ms: s.offers.median_first_response_ms,
    matched_devices: s.supply.matched_devices,
    open_with_match: s.supply.with_match,
    open_without_match: s.supply.without_match,
    matched_but_unanswered: s.supply.matched_but_unanswered,
    scan_capped: s.supply.scan_capped,
    top_models: s.top_models.slice(0, 6),
  };
}

export { listingsAnsweringRequest };
