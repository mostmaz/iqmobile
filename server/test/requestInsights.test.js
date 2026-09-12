// What the dashboard says about a request, and why the two counts differ.
//
// The pin here is that "matched devices" and "offers" are measured
// separately and by DIFFERENT rules: offers are rows, matched devices are the
// broadcast's own matcher run backwards. A console that derived one from the
// other would report a request as unfillable the moment nobody answered it,
// which is the exact opposite of what it means.
//
// An HTTP test against the real admin router, because the list endpoint's
// risk is in its filters — the status default, the fold-bound `unmatched`
// pass, and the buyer join — none of which a unit test of the aggregator
// would touch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-reqinsights-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: adminRoutes } = await import('../src/routes/admin/index.js');
const { issueToken } = await import('../src/auth.js');
const { requestSummary } = await import('../src/requestInsights.js');
const { norm } = await import('../src/routes/savedSearches.js');

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;
const TOKEN = issueToken({ kind: 'admin', id: 1, username: 'test' });

const NOW = Date.now();
const DAY = 86400000;
const HOUR = 3600000;

let uid = 0;
function user({ type = 'individual', gov = 'Baghdad' } = {}) {
  const id = ++uid;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
              VALUES(?, ?, 'x', ?, ?, ?, ?)`)
    .run(id, `0770000${String(id).padStart(4, '0')}`, `u${id}`, gov, type, NOW);
  return id;
}

let lid = 0;
function listing({ seller, brand = 'Apple', model = 'iPhone 13', price = 500000,
  status = 'active' } = {}) {
  const id = ++lid;
  db.prepare(`INSERT INTO phone_listings
    (id, seller_id, brand, model, condition, asking_price, governorate, status,
     created_at, updated_at, expires_at)
    VALUES(?, ?, ?, ?, 'used', ?, 'Baghdad', ?, ?, ?, ?)`)
    .run(id, seller, brand, model, price, status, NOW, NOW, NOW + 30 * DAY);
  return id;
}

let rid = 0;
function request({ buyer, brand = 'Apple', model = 'iPhone 13', max = 600000,
  gov = 'Baghdad', status = 'open', expires = NOW + 7 * DAY, age = HOUR } = {}) {
  const id = ++rid;
  db.prepare(`INSERT INTO phone_requests
    (id, buyer_id, brand, model, max_price, governorate, status, offer_count, created_at, expires_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, buyer, brand, model, max, gov, status, NOW - age, expires);
  return id;
}

let oid = 0;
function offer({ request: reqId, seller, price = 550000, status = 'sent', at = NOW }) {
  const id = ++oid;
  db.prepare(`INSERT INTO request_offers(id, request_id, seller_id, price, status, created_at)
              VALUES(?, ?, ?, ?, ?, ?)`).run(id, reqId, seller, price, status, at);
  db.prepare("UPDATE phone_requests SET offer_count=(SELECT COUNT(*) FROM request_offers WHERE request_id=? AND status='sent') WHERE id=?")
    .run(reqId, reqId);
  return id;
}

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 200, `${path} → ${res.status}`);
  return res.json();
};

// ── the cast ────────────────────────────────────────────────────────────
const BUYER = user();
const SHOP = user({ type: 'shop' });
const OTHER_SELLER = user();

// 1. The site has the phone and a seller answered — the healthy case.
const ANSWERED = request({ buyer: BUYER });
// 2. The site has the phone and nobody said a word. The failure worth paging
//    an operator about, and indistinguishable from #3 without both counts.
const IGNORED = request({ buyer: BUYER, model: 'Galaxy S24', brand: 'Samsung', max: 700000 });
// 3. Nobody has it at any price — unmet demand, i.e. stock to import.
const UNFILLABLE = request({ buyer: BUYER, model: 'Pixel 9', brand: 'Google', max: 800000 });

listing({ seller: SHOP, price: 520000 });                                   // answers #1
listing({ seller: OTHER_SELLER, price: 900000 });                           // past #1's ceiling + slack
listing({ seller: SHOP, brand: 'Samsung', model: 'Galaxy S24', price: 650000 }); // answers #2
offer({ request: ANSWERED, seller: SHOP, price: 515000, at: NOW - HOUR + 5 * 60000 });

test('a request carries its own supply count, not a guess from its offers', async () => {
  const { requests } = await get('/admin/requests');
  const byId = new Map(requests.map((r) => [r.id, r]));

  assert.equal(byId.get(ANSWERED).matched_devices, 1);
  assert.equal(byId.get(ANSWERED).offers, 1);

  // The whole reason both numbers exist: same "unanswered", opposite causes.
  assert.equal(byId.get(IGNORED).matched_devices, 1);
  assert.equal(byId.get(IGNORED).offers, 0);
  assert.equal(byId.get(UNFILLABLE).matched_devices, 0);
  assert.equal(byId.get(UNFILLABLE).offers, 0);
});

test('the ceiling slack counts as supply, and says it is over budget', async () => {
  // 520k against a 600k ceiling is a clean match; the 900k listing is past
  // 600k × 1.2 and is not supply at all.
  const { requests } = await get('/admin/requests');
  const byId = new Map(requests.map((r) => [r.id, r]));
  assert.equal(byId.get(ANSWERED).matched_in_budget, 1);
  assert.equal(byId.get(ANSWERED).cheapest_match, 520000);

  const over = request({ buyer: BUYER, model: 'iPhone 13', max: 450000 });
  try {
    const after = await get('/admin/requests');
    const row = after.requests.find((r) => r.id === over);
    // 520000 ≤ 450000 × 1.2 = 540000 → supply, but over what the buyer said.
    assert.equal(row.matched_devices, 1);
    assert.equal(row.matched_in_budget, 0);
  } finally {
    db.prepare('DELETE FROM phone_requests WHERE id=?').run(over);
  }
});

test('a buyer\'s own listing is never supply for his own request', async () => {
  const mine = listing({ seller: BUYER, brand: 'Google', model: 'Pixel 9', price: 700000 });
  try {
    const { requests } = await get('/admin/requests');
    assert.equal(requests.find((r) => r.id === UNFILLABLE).matched_devices, 0);
  } finally {
    db.prepare('DELETE FROM phone_listings WHERE id=?').run(mine);
  }
});

test('sold and draft stock is not supply', async () => {
  const sold = listing({ seller: OTHER_SELLER, brand: 'Google', model: 'Pixel 9', price: 700000, status: 'sold' });
  const draft = listing({ seller: OTHER_SELLER, brand: 'Google', model: 'Pixel 9', price: 700000 });
  db.prepare('UPDATE phone_listings SET is_draft=1 WHERE id=?').run(draft);
  try {
    const { requests } = await get('/admin/requests');
    assert.equal(requests.find((r) => r.id === UNFILLABLE).matched_devices, 0);
  } finally {
    db.prepare('DELETE FROM phone_listings WHERE id IN (?,?)').run(sold, draft);
  }
});

test('the model fold decides the match, in both scripts', async () => {
  const arabic = request({ buyer: BUYER, model: 'ايفون ١٣', max: 600000 });
  try {
    const { requests } = await get('/admin/requests');
    assert.equal(requests.find((r) => r.id === arabic).matched_devices, 1);
  } finally {
    db.prepare('DELETE FROM phone_requests WHERE id=?').run(arabic);
  }
});

test('a call-for-price listing is a device, never a price', async () => {
  const cfp = listing({ seller: OTHER_SELLER, brand: 'Google', model: 'Pixel 9', price: 1 });
  try {
    const { requests } = await get('/admin/requests');
    const row = requests.find((r) => r.id === UNFILLABLE);
    assert.equal(row.matched_devices, 1);
    assert.equal(row.matched_call_for_price, 1);
    // The sentinel must not become "from 1 د.ع" anywhere — bug #9, kept out.
    assert.equal(row.cheapest_match, null);
    assert.equal(row.matched_in_budget, 0);
  } finally {
    db.prepare('DELETE FROM phone_listings WHERE id=?').run(cfp);
  }
});

test('the default list is the live board, not every row stored as open', async () => {
  const stale = request({ buyer: BUYER, expires: NOW - DAY, age: 30 * DAY });
  try {
    const live = await get('/admin/requests');
    assert.ok(!live.requests.some((r) => r.id === stale), 'expired-but-unswept row is not live demand');

    const open = await get('/admin/requests?status=open');
    const row = open.requests.find((r) => r.id === stale);
    assert.ok(row, 'it is still visible as stored-open');
    assert.equal(row.is_live, false);
  } finally {
    db.prepare('DELETE FROM phone_requests WHERE id=?').run(stale);
  }
});

test('filters narrow by answer and by supply', async () => {
  const unanswered = await get('/admin/requests?unanswered=1');
  assert.deepEqual(unanswered.requests.map((r) => r.id).sort(), [IGNORED, UNFILLABLE].sort());

  const unmatched = await get('/admin/requests?unmatched=1');
  assert.deepEqual(unmatched.requests.map((r) => r.id), [UNFILLABLE]);
  assert.equal(unmatched.total, 1);

  const brand = await get('/admin/requests?brand=Samsung');
  assert.deepEqual(brand.requests.map((r) => r.id), [IGNORED]);

  const search = await get('/admin/requests?q=Pixel');
  assert.deepEqual(search.requests.map((r) => r.id), [UNFILLABLE]);
});

test('the detail view names the sellers who held the phone and stayed quiet', async () => {
  const detail = await get(`/admin/requests/${IGNORED}`);
  assert.equal(detail.request.id, IGNORED);
  assert.equal(detail.offers.length, 0);
  assert.equal(detail.matched_listings.length, 1);
  assert.equal(detail.matched_listings[0].seller.id, SHOP);
  assert.equal(detail.matched_listings[0].seller_answered, false);
  assert.equal(detail.stats.matched_sellers, 1);
  assert.equal(detail.stats.matched_sellers_answered, 0);

  const answered = await get(`/admin/requests/${ANSWERED}`);
  assert.equal(answered.offers.length, 1);
  assert.equal(answered.offers[0].seller.id, SHOP);
  assert.equal(answered.offers[0].above_budget, false);
  assert.equal(answered.matched_listings[0].seller_answered, true);
  assert.equal(answered.stats.offer_count_drift, 0);
});

test('a withdrawn offer stops counting as an answer but stays on the record', async () => {
  const gone = offer({ request: IGNORED, seller: OTHER_SELLER, status: 'withdrawn' });
  try {
    const { requests } = await get('/admin/requests');
    const row = requests.find((r) => r.id === IGNORED);
    assert.equal(row.offers, 0);
    assert.equal(row.offers_withdrawn, 1);

    const detail = await get(`/admin/requests/${IGNORED}`);
    assert.equal(detail.offers.length, 1);
    assert.equal(detail.offers[0].status, 'withdrawn');
    assert.equal(detail.matched_listings[0].seller_answered, false);
  } finally {
    db.prepare('DELETE FROM request_offers WHERE id=?').run(gone);
  }
});

test('the summary separates "nobody answered" from "nobody has it"', async () => {
  const s = await get('/admin/requests/summary');
  assert.equal(s.totals.open, 3);
  assert.equal(s.offers.unanswered_open, 2);
  // Of those two, one is a broadcast that failed and one is stock we lack.
  assert.equal(s.supply.matched_but_unanswered, 1);
  assert.equal(s.supply.without_match, 1);
  assert.equal(s.supply.with_match, 2);
  assert.equal(s.supply.scan_capped, false);

  // Answer rate is over every request ever posted, so it cannot be read as
  // "most requests get answered" on the strength of one busy day.
  assert.equal(s.offers.answered_requests, 1);
  assert.equal(s.offers.answer_rate, 33.3);
  assert.equal(s.offers.median_first_response_ms, 5 * 60000);
});

test('top models rank demand and carry both counts', async () => {
  const s = await get('/admin/requests/summary');
  const top = s.top_models.find((m) => m.brand === 'Samsung');
  assert.equal(top.model, 'Galaxy S24');
  assert.equal(top.requests, 1);
  assert.equal(top.matched, 1);
  assert.equal(top.unanswered, 1);
  assert.equal(top.median_budget, 700000);
});

test('the scan cap is reported rather than silently shrinking the site', () => {
  const s = requestSummary(db, norm, { now: NOW, days: 30, maxScan: 1 });
  assert.equal(s.supply.scan_capped, true);
  assert.equal(s.supply.scanned, 1);
  // Totals are SQL over the whole table and stay exact under the cap.
  assert.equal(s.totals.open, 3);
});

test('the overview carries the same numbers the requests page does', async () => {
  const [overview, summary] = await Promise.all([get('/admin/overview'), get('/admin/requests/summary')]);
  assert.equal(overview.requests.open, summary.totals.open);
  assert.equal(overview.requests.unanswered_open, summary.offers.unanswered_open);
  assert.equal(overview.requests.matched_but_unanswered, summary.supply.matched_but_unanswered);
  assert.equal(overview.requests.open_without_match, summary.supply.without_match);
});

test('none of it is readable without an admin token', async () => {
  for (const path of ['/admin/requests', '/admin/requests/summary', `/admin/requests/${ANSWERED}`]) {
    assert.equal((await fetch(`${BASE}${path}`)).status, 401, path);
  }
});

test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
