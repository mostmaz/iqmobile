// End-to-end exercise of the ضمان iQ pipeline against a local server on
// :4400. Seeds its own rows, walks every rule, prints PASS/FAIL lines, and
// cleans up after itself. Temporary — deleted after the feature lands.
import 'dotenv/config';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

const db = new Database(process.env.DB_PATH || './data/iqmobile2.db');
const BASE = 'http://127.0.0.1:4400';
const t = Date.now();
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label} ${extra}`); }
};

// ── seed ──────────────────────────────────────────────────────────────
const mkUser = (phone, name) => {
  db.prepare(
    `INSERT INTO users(phone, password_hash, display_name, governorate, created_at) VALUES(?,'x',?,?,?)`,
  ).run(phone, name, 'Baghdad', t);
  return db.prepare('SELECT id FROM users WHERE phone=?').get(phone).id;
};
const sellerId = mkUser('07711111111', 'g-test-seller');
const buyerId = mkUser('07722222222', 'g-test-buyer');

const mkListing = (over = {}) => {
  const o = {
    seller_id: sellerId, brand: 'Samsung', model: 'Galaxy A55', storage: '256GB',
    condition: 'used', asking_price: 400000, status: 'active', optin: 1, ...over,
  };
  const ins = db.prepare(
    `INSERT INTO phone_listings(
       seller_id, brand, model, storage, condition, accessories_json, asking_price,
       governorate, status, contact_phone, created_at, expires_at, updated_at, iq_guarantee_optin
     ) VALUES (?,?,?,?,?,'[]',?,?,?,?,?,?,?,?)`,
  ).run(o.seller_id, o.brand, o.model, o.storage, o.condition, o.asking_price,
    'Baghdad', o.status, '07733333333', t, t + 31536000000, t, o.optin);
  return ins.lastInsertRowid;
};

const usedL = mkListing();                                   // 400k used, opted in
const used700 = mkListing({ asking_price: 700000, optin: 0 });
const used1200 = mkListing({ asking_price: 1200000 });
const used555 = mkListing({ asking_price: 555000 });
const newL = mkListing({ condition: 'new' });

const SECRET = process.env.JWT_SECRET;
const buyerTok = jwt.sign({ id: buyerId, phone: '07722222222' }, SECRET, { expiresIn: '1h' });
const sellerTok = jwt.sign({ id: sellerId, phone: '07711111111' }, SECRET, { expiresIn: '1h' });
const adminTok = jwt.sign({ id: 1, kind: 'admin', username: 't' }, SECRET, { expiresIn: '1h' });

const api = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
};

// ── 1. fee math + eligibility on GET /listings/:id ───────────────────
{
  const g = async (id) => (await api(`/listings/${id}`)).data.guarantee;
  const a = await g(usedL);
  ok(a && a.pct === 10 && a.fee === 40000 && a.total === 440000 && a.seller_opted_in === true,
    'quote 400k → 10% / 40,000 / 440,000 / opted-in', JSON.stringify(a));
  const b = await g(used700);
  ok(b && b.pct === 7 && b.fee === 49000 && b.seller_opted_in === false, 'quote 700k → 7% / 49,000', JSON.stringify(b));
  const c = await g(used1200);
  ok(c && c.pct === 5 && c.fee === 60000, 'quote 1.2M → 5% / 60,000', JSON.stringify(c));
  const d = await g(used555);
  ok(d && d.fee === 39000, 'quote 555k → fee rounds to 39,000', JSON.stringify(d));
  ok((await g(newL)) === null, 'new-condition listing → guarantee null');
}

// ── 2. create + guards ────────────────────────────────────────────────
let orderId;
{
  const r1 = await api('/guarantee/orders', { method: 'POST', token: buyerTok, body: { listing_id: usedL, buyer_phone: '07722222222' } });
  ok(r1.status === 200 && /^GR-\d+$/.test(r1.data.code) && r1.data.total === 440000 && r1.data.seller_opted_in === 1,
    `create → ${r1.data?.code} total 440,000`, JSON.stringify(r1.data).slice(0, 120));
  orderId = r1.data.id;

  const dup = await api('/guarantee/orders', { method: 'POST', token: buyerTok, body: { listing_id: usedL, buyer_phone: '07722222222' } });
  ok(dup.status === 409 && dup.data.error === 'already_requested', 'duplicate → 409 already_requested', JSON.stringify(dup.data));

  const own = await api('/guarantee/orders', { method: 'POST', token: sellerTok, body: { listing_id: usedL, buyer_phone: '07711111111' } });
  ok(own.status === 403 && own.data.error === 'own_listing', 'own listing → 403');

  const newC = await api('/guarantee/orders', { method: 'POST', token: buyerTok, body: { listing_id: newL, buyer_phone: '07722222222' } });
  ok(newC.status === 409 && newC.data.error === 'not_eligible', 'new-condition create → 409 not_eligible');

  const mine = await api('/guarantee/mine', { token: buyerTok });
  ok(Array.isArray(mine.data) && mine.data.some((o) => o.id === orderId), 'GET /guarantee/mine shows the order');

  const wq1 = await api('/admin/work-queue', { token: adminTok });
  ok(wq1.data.guarantee >= 1, `work-queue guarantee count = ${wq1.data.guarantee}`);
}

// ── 3. admin pipeline walk ────────────────────────────────────────────
{
  const patch = (body) => api(`/admin/guarantee/${orderId}`, { method: 'PATCH', token: adminTok, body });

  const skip = await patch({ status: 'shipped' });
  ok(skip.status === 409 && skip.data.error === 'bad_transition', 'stage skip new→shipped → 409 bad_transition');

  ok((await patch({ status: 'buyer_confirmed' })).status === 200, 'new → buyer_confirmed');
  const wq2 = await api('/admin/work-queue', { token: adminTok });
  ok(wq2.data.guarantee === 0, 'work-queue count falls after buyer_confirmed');

  ok((await patch({ status: 'seller_confirmed' })).status === 200, 'buyer_confirmed → seller_confirmed');
  const lst = db.prepare('SELECT status FROM phone_listings WHERE id=?').get(usedL);
  ok(lst.status === 'reserved', `listing reserved after seller_confirmed (is: ${lst.status})`);

  ok((await patch({ status: 'picked_up' })).status === 200, 'seller_confirmed → picked_up');

  const noReport = await patch({ status: 'inspected' });
  ok(noReport.status === 400 && noReport.data.error === 'report_required', 'inspected without report → 400 report_required');
  const badFp = await patch({ status: 'inspected', inspection_report: 'حالة ممتازة', front_payment: 9999999 });
  ok(badFp.status === 400 && badFp.data.error === 'bad_front_payment', 'front_payment > total → 400');
  const insp = await patch({ status: 'inspected', inspection_report: 'الجهاز مطابق للوصف، بطارية 88%', front_payment: 50000 });
  ok(insp.status === 200 && insp.data.order.front_payment === 50000, 'inspected with report + 50,000 عربون');

  ok((await patch({ status: 'front_paid' })).status === 200, 'inspected → front_paid');
  ok((await patch({ status: 'shipped' })).status === 200, 'front_paid → shipped');
  const del = await patch({ status: 'delivered' });
  ok(del.status === 200 && del.data.order.delivered_at > 0, 'shipped → delivered (+delivered_at)');
  const lst2 = db.prepare('SELECT status, sold_at FROM phone_listings WHERE id=?').get(usedL);
  ok(lst2.status === 'sold' && lst2.sold_at > 0, `listing sold after delivery (is: ${lst2.status})`);

  // notifications: one per forward step (7 transitions)
  const kinds = db.prepare(
    "SELECT kind FROM notifications WHERE user_id=? AND kind LIKE 'guarantee.%' ORDER BY id",
  ).all(buyerId).map((r) => r.kind);
  ok(kinds.length === 7 && kinds[3] === 'guarantee.inspected', `7 buyer notifications (${kinds.join(',')})`);
}

// ── 4. cancel restores the listing; buyer-cancel windows ─────────────
{
  const l2 = mkListing({ asking_price: 300000 });
  const c1 = await api('/guarantee/orders', { method: 'POST', token: buyerTok, body: { listing_id: l2, buyer_phone: '07722222222' } });
  const id2 = c1.data.id;
  const patch = (body) => api(`/admin/guarantee/${id2}`, { method: 'PATCH', token: adminTok, body });
  await patch({ status: 'buyer_confirmed' });
  await patch({ status: 'seller_confirmed' });
  await patch({ status: 'picked_up' });
  const bc = await api(`/guarantee/${id2}/cancel`, { method: 'POST', token: buyerTok });
  ok(bc.status === 409 && bc.data.error === 'not_cancellable', 'buyer cancel at picked_up → 409');
  const cx = await patch({ status: 'cancelled', cancel_reason: 'فشل الفحص' });
  ok(cx.status === 200 && cx.data.order.cancelled_stage === 'picked_up', 'admin cancel stamps cancelled_stage=picked_up');
  const lst3 = db.prepare('SELECT status FROM phone_listings WHERE id=?').get(l2);
  ok(lst3.status === 'active', `listing restored to active after cancel (is: ${lst3.status})`);

  const l3 = mkListing({ asking_price: 200000 });
  const c2 = await api('/guarantee/orders', { method: 'POST', token: buyerTok, body: { listing_id: l3, buyer_phone: '07722222222' } });
  const bc2 = await api(`/guarantee/${c2.data.id}/cancel`, { method: 'POST', token: buyerTok });
  ok(bc2.status === 200 && bc2.data.status === 'cancelled' && bc2.data.cancel_reason === 'cancelled_by_buyer',
    'buyer cancel at new → cancelled_by_buyer');
}

// ── cleanup ───────────────────────────────────────────────────────────
db.prepare("DELETE FROM notifications WHERE user_id IN (?,?)").run(buyerId, sellerId);
db.prepare("DELETE FROM guarantee_orders WHERE buyer_id=?").run(buyerId);
db.prepare("DELETE FROM phone_listings WHERE seller_id=?").run(sellerId);
db.prepare("DELETE FROM users WHERE id IN (?,?)").run(sellerId, buyerId);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
