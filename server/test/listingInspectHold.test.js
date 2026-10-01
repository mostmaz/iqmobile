// The AI quality check's decision path, exercised without a model or a key:
// applyInspectionResult() takes the verdict the model would have returned
// and must hold, queue, or leave the listing alone; resolveInspection()
// is the operator's approve / remove on top of that.
//
// The contract under test: a BAD listing is never visible to buyers while
// it waits, its seller can still see it (as 'under_review') and is told
// what is happening, and an approval publishes it with a fresh TTL.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-inspect-hold-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-inspect-hold-secret';
const { default: express } = await import('express');
const { db, now, setSettingValue } = await import('../src/db.js');
const { issueToken } = await import('../src/auth.js');
const { default: listings } = await import('../src/routes/listings.js');
const {
  applyInspectionResult, resolveInspection, holdEnabled, MODEL, providerFor, keyEnvFor,
} = await import('../src/listingInspect.js');

const app = express();
app.use(express.json());
app.use('/listings', listings);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function user(phone) {
  const id = Number(db.prepare(
    'INSERT INTO users(phone,password_hash,display_name,governorate,created_at) VALUES(?,?,?,?,?)',
  ).run(phone, 'unused', phone, 'Baghdad', now()).lastInsertRowid);
  // A build new enough to label listing.review.* rows, so the inbox row is
  // written and the test can read it back.
  db.prepare(
    'INSERT INTO user_active_days(user_id, day, requests, first_seen, last_seen, app_version) VALUES(?,?,?,?,?,?)',
  ).run(id, '2026-10-01', 1, now(), now(), '0.5.3');
  return { id, token: issueToken({ id }) };
}
function listing(sellerId) {
  const t = now();
  const id = Number(db.prepare(
    `INSERT INTO phone_listings(seller_id, brand, model, condition, asking_price, governorate, status,
       created_at, expires_at, updated_at)
     VALUES(?,?,?,?,?,?,'active',?,?,?)`,
  ).run(sellerId, 'Apple', 'iPhone 13', 'used', 500000, 'Baghdad', t, t + 1000, t).lastInsertRowid);
  db.prepare('INSERT INTO listing_images(listing_id, image_path, position, created_at) VALUES(?,?,?,?)')
    .run(id, '/uploads/x.jpg', 0, t);
  return id;
}
async function call(u, method, route, body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method,
    headers: { ...(u ? { Authorization: `Bearer ${u.token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const row = (id) => db.prepare('SELECT * FROM phone_listings WHERE id=?').get(id);
const inbox = (userId) => db.prepare('SELECT kind, payload_json FROM notifications WHERE user_id=? ORDER BY id').all(userId)
  .map((n) => ({ kind: n.kind, payload: JSON.parse(n.payload_json) }));

const BAD = {
  verdict: 'defective', confidence: 'high',
  defects: [{ kind: 'cracked_screen', source: 'image', evidence: 'الشاشة مكسورة في الزاوية' }],
};

test('hold is on by default', () => {
  assert.equal(holdEnabled(), true);
});

test('the model name picks the vendor and the key it needs', () => {
  assert.equal(MODEL(), 'gpt-6-luna');
  assert.equal(providerFor(), 'openai');
  assert.equal(keyEnvFor(), 'OPENAI_API_KEY');
  assert.equal(providerFor('claude-sonnet-5-5'), 'anthropic');
  assert.equal(keyEnvFor('claude-sonnet-5-5'), 'ANTHROPIC_API_KEY');
  assert.equal(providerFor('gpt-5.6-luna'), 'openai');
});

test('a bad verdict holds the listing: hidden from buyers, visible to its seller, seller notified', async () => {
  const seller = user('07700000001');
  const buyer = user('07700000002');
  const id = listing(seller.id);

  assert.equal(applyInspectionResult(id, BAD), 'held');
  const l = row(id);
  assert.equal(l.status, 'removed');
  assert.equal(l.review_hold, 1);

  // Buyers (and anonymous visitors) get a 404; the seller sees under_review.
  assert.equal((await call(buyer, 'GET', `/listings/${id}`)).status, 404);
  assert.equal((await call(null, 'GET', `/listings/${id}`)).status, 404);
  const own = await call(seller, 'GET', `/listings/${id}`);
  assert.equal(own.status, 200);
  assert.equal(own.data.status, 'under_review');

  // In "my listings", under its own tab and in "all" — and NOT under active.
  const all = await call(seller, 'GET', '/listings/mine?status=all');
  assert.deepEqual(all.data.map((x) => [x.id, x.status]), [[id, 'under_review']]);
  const held = await call(seller, 'GET', '/listings/mine?status=under_review');
  assert.equal(held.data.length, 1);
  // The model's reason reaches the seller through the inspection notes.
  assert.equal(held.data[0].inspection.notes[0].evidence, 'الشاشة مكسورة في الزاوية');
  const active = await call(seller, 'GET', '/listings/mine?status=active');
  assert.equal(active.data.length, 0);

  // Told once, with the reason and the listing id to tap through.
  assert.deepEqual(inbox(seller.id), [{
    kind: 'listing.review.pending',
    payload: { status: 'pending', listing_id: id, reason: 'الشاشة مكسورة في الزاوية' },
  }]);
  assert.equal(inbox(buyer.id).length, 0);

  // The seller cannot publish it themselves.
  const patch = await call(seller, 'PATCH', `/listings/${id}`, { status: 'active' });
  assert.equal(patch.status, 409);
  assert.equal(patch.data.error, 'under_review');
  assert.equal(row(id).status, 'removed');
  // …but can still fix the text while it waits.
  const edit = await call(seller, 'PATCH', `/listings/${id}`, { description: 'بحالة ممتازة' });
  assert.equal(edit.status, 200);

  // A re-inspection of a held listing keeps it held and does not nag again.
  assert.equal(applyInspectionResult(id, BAD), 'held');
  assert.equal(inbox(seller.id).length, 1);
});

test('operator approval publishes a held listing with a fresh expiry and tells the seller', async () => {
  const seller = user('07700000003');
  const id = listing(seller.id);
  applyInspectionResult(id, BAD);
  const before = row(id);
  const ins = db.prepare('SELECT id FROM listing_inspections WHERE listing_id=?').get(id);

  assert.equal(resolveInspection(ins.id, 'approve'), id);
  const l = row(id);
  assert.equal(l.status, 'active');
  assert.equal(l.review_hold, 0);
  assert.ok(l.expires_at > before.expires_at, 'the TTL restarts at publish time');
  assert.equal(db.prepare('SELECT status FROM listing_inspections WHERE id=?').get(ins.id).status, 'approved');
  assert.deepEqual(inbox(seller.id).map((n) => n.kind), ['listing.review.pending', 'listing.review.approved']);

  // Public again.
  assert.equal((await call(null, 'GET', `/listings/${id}`)).status, 200);
  // Notes are gone once a human has overruled them.
  const mine = await call(seller, 'GET', '/listings/mine?status=active');
  assert.equal(mine.data[0].inspection, null);
});

test('operator removal keeps it unpublished, clears the hold, and gives the reason', () => {
  const seller = user('07700000004');
  const id = listing(seller.id);
  applyInspectionResult(id, BAD);
  const ins = db.prepare('SELECT id FROM listing_inspections WHERE listing_id=?').get(id);

  assert.equal(resolveInspection(ins.id, 'remove', { reason: 'الظهر مهشّم' }), id);
  const l = row(id);
  assert.equal(l.status, 'removed');
  assert.equal(l.review_hold, 0);
  const last = inbox(seller.id).at(-1);
  assert.equal(last.kind, 'listing.review.rejected');
  assert.equal(last.payload.reason, 'الظهر مهشّم');
});

test('good and unclear verdicts leave the listing live', () => {
  const seller = user('07700000005');
  const good = listing(seller.id);
  assert.equal(applyInspectionResult(good, { verdict: 'clean', confidence: 'high', defects: [] }), 'clean');
  assert.equal(row(good).status, 'active');

  const unclear = listing(seller.id);
  assert.equal(applyInspectionResult(unclear, {
    verdict: 'suspect', confidence: 'medium',
    defects: [{ kind: 'screen_defect', source: 'image', evidence: 'قد توجد بقعة على الشاشة' }],
  }), 'queued');
  assert.equal(row(unclear).status, 'active');
  assert.equal(row(unclear).review_hold, 0);

  // A hesitant "defective" is a suspect, not a reason to hide the ad.
  const hesitant = listing(seller.id);
  assert.equal(applyInspectionResult(hesitant, { ...BAD, confidence: 'low' }), 'queued');
  assert.equal(row(hesitant).status, 'active');
  assert.equal(inbox(seller.id).length, 0);
});

test('with the hold switch off a bad verdict only queues the listing', () => {
  setSettingValue('listing_inspection_hold', '0');
  try {
    const seller = user('07700000006');
    const id = listing(seller.id);
    assert.equal(applyInspectionResult(id, BAD), 'queued');
    assert.equal(row(id).status, 'active');
    assert.equal(inbox(seller.id).length, 0);
  } finally {
    setSettingValue('listing_inspection_hold', '1');
  }
});

test('seller deleting a held listing clears the hold', async () => {
  const seller = user('07700000007');
  const id = listing(seller.id);
  applyInspectionResult(id, BAD);
  assert.equal((await call(seller, 'DELETE', `/listings/${id}`)).status, 200);
  assert.equal(row(id).review_hold, 0);
  const all = await call(seller, 'GET', '/listings/mine?status=all');
  assert.equal(all.data.length, 0);
});
