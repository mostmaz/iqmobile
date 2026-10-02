// The quality gate: an app from 1.0.0 posts a listing, the listing is born
// hidden, the app asks for the verdict, and the listing goes live when the
// model says clean — or when an operator does. Nothing on this path is
// auto-rejected; a refusal is a person's call and the seller is told.
//
// Exercised without a model or a key: the verdict is fed in through
// applyInspectionResult(), as listingInspectHold.test.js does, and the
// kick-off is given a no-op scheduler.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-inspect-gate-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-inspect-gate-secret';
// A key makes inspectionConfigured() true; the switch below makes it enabled.
process.env.OPENAI_API_KEY = 'sk-test-never-called';
const { default: express } = await import('express');
const { db, now, setSettingValue } = await import('../src/db.js');
const { issueToken } = await import('../src/auth.js');
const { default: listings } = await import('../src/routes/listings.js');
const {
  applyInspectionResult, resolveInspection, gateApplies, isGated, startGatedInspection,
  sweepStuckGates, reviewStateFor, reviewFor, inspectionEnabled, inspectsUpload,
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

function user(phone, appVersion = '1.0.0') {
  const id = Number(db.prepare(
    'INSERT INTO users(phone,password_hash,display_name,governorate,created_at) VALUES(?,?,?,?,?)',
  ).run(phone, 'unused', phone, 'Baghdad', now()).lastInsertRowid);
  db.prepare(
    'INSERT INTO user_active_days(user_id, day, requests, first_seen, last_seen, app_version) VALUES(?,?,?,?,?,?)',
  ).run(id, '2026-10-01', 1, now(), now(), appVersion);
  return { id, token: issueToken({ id }) };
}
async function call(u, method, route, body, version = '1.0.0') {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method,
    headers: {
      ...(u ? { Authorization: `Bearer ${u.token}` } : {}),
      'Content-Type': 'application/json',
      ...(version ? { 'x-app-version': version } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const row = (id) => db.prepare('SELECT * FROM phone_listings WHERE id=?').get(id);
const inbox = (userId) => db.prepare('SELECT kind, payload_json, pushed FROM notifications WHERE user_id=? ORDER BY id').all(userId)
  .map((n) => ({ kind: n.kind, payload: JSON.parse(n.payload_json), pushed: n.pushed }));
const addImage = (id) => db.prepare('INSERT INTO listing_images(listing_id, image_path, position, created_at) VALUES(?,?,?,?)')
  .run(id, '/uploads/x.jpg', 0, now());
const BODY = {
  brand: 'Apple', model: 'iPhone 13', condition: 'used', asking_price: 500000,
  governorate: 'Baghdad', contact_phone: '07700000011',
};
const defect = { kind: 'cracked_screen', source: 'image', evidence: 'الشاشة مكسورة في الزاوية' };
const GOOD = { verdict: 'clean', confidence: 'high', defects: [] };
const BAD_SURE = { verdict: 'defective', confidence: 'high', defects: [defect] };
const UNCLEAR = { verdict: 'suspect', confidence: 'medium', defects: [defect] };

setSettingValue('listing_inspection_enabled', '1');
const seller = user('07700000011');
const other = user('07700000012');
// A shop, so the one-listing-an-hour rule does not stop the tests posting.
db.prepare("UPDATE users SET seller_type='shop' WHERE id=?").run(seller.id);

test('a hidden gated listing still counts toward the hourly limit', async () => {
  const solo = user('07700000013');
  const a = await call(solo, 'POST', '/listings', { ...BODY, client_key: 'solo-1' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(row(a.data.id).status, 'removed');
  const b = await call(solo, 'POST', '/listings', { ...BODY, client_key: 'solo-2' });
  assert.equal(b.status, 429);
  assert.equal(b.data.error, 'listing_hourly_limit');
});

test('the gate is a version question, on top of the enabled switch', () => {
  assert.equal(inspectionEnabled(), true);
  assert.equal(gateApplies('1.0.0'), true);
  assert.equal(gateApplies('1.2.3'), true);
  assert.equal(gateApplies('0.5.2'), false);
  assert.equal(gateApplies(undefined), false);
  setSettingValue('listing_inspection_enabled', '0');
  assert.equal(gateApplies('1.0.0'), false);
  setSettingValue('listing_inspection_enabled', '1');
});

test('photo uploads are inspected only from apps 1.0.0 and up', async () => {
  const live = { status: 'active', review_hold: 0, inspection_state: null };
  for (const v of [undefined, '', '0', '0.5.2', '0.9.9']) assert.equal(inspectsUpload(live, v), false, String(v));
  for (const v of ['1.0.0', '1.0.1', '1.2.0', '2.0.0']) assert.equal(inspectsUpload(live, v), true, v);
  // A listing waiting on the gate is checked once, when its app asks.
  const waiting = { status: 'removed', review_hold: 1, inspection_state: 'awaiting' };
  assert.equal(inspectsUpload(waiting, '1.0.0'), false);
  // And the upload route is the one asking, with the caller's version.
  const src = fs.readFileSync(new URL('../src/routes/listings.js', import.meta.url), 'utf8');
  assert.match(src, /if \(inspectsUpload\(row, req\.get\('x-app-version'\)\)\) setImmediate\(\(\) => inspectListingAsync\(row\.id\)\)/);
  assert.equal((src.match(/inspectListingAsync\(/g) || []).length, 1, 'no other route schedules a check');
});

test('an old app posts a live listing, exactly as before', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'old-1' }, '0.5.2');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'active');
  assert.equal(r.data.review.state, 'published');
  const l = row(r.data.id);
  assert.equal(l.status, 'active');
  assert.equal(l.review_hold, 0);
  assert.equal(l.inspection_state, null);
  assert.equal(isGated(l), false);
});

test('a 1.0.0 app posts a hidden listing that only its seller can see, as checking', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'under_review');
  assert.equal(r.data.review.state, 'checking');
  const id = r.data.id;
  const l = row(id);
  assert.equal(l.status, 'removed');
  assert.equal(l.review_hold, 1);
  assert.equal(l.inspection_state, 'awaiting');
  assert.ok(isGated(l));

  // Invisible to the public, visible to the seller.
  const pub = await call(null, 'GET', '/listings?limit=50');
  assert.ok(!pub.data.some((x) => x.id === id));
  assert.equal((await call(null, 'GET', `/listings/${id}`)).status, 404);
  const mine = await call(seller, 'GET', '/listings/mine');
  const me = mine.data.find((x) => x.id === id);
  assert.equal(me.status, 'under_review');
  assert.equal(me.review_state, 'checking');

  // The status page is the seller's alone.
  assert.equal((await call(other, 'GET', `/listings/${id}/review`)).status, 403);
  const rv = await call(seller, 'GET', `/listings/${id}/review`);
  assert.equal(rv.data.state, 'checking');
  assert.equal(rv.data.listing.model, 'iPhone 13');
});

test('asking for the verdict with no photos publishes at once, unchecked', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-nophoto' });
  const id = r.data.id;
  const ins = await call(seller, 'POST', `/listings/${id}/inspect`);
  assert.equal(ins.status, 200);
  assert.equal(ins.data.state, 'published');
  const l = row(id);
  assert.equal(l.status, 'active');
  assert.equal(l.review_hold, 0);
  assert.equal(l.inspection_state, 'unchecked');
  assert.ok(l.bumped_at >= l.created_at);
  // And now it is public.
  assert.equal((await call(null, 'GET', `/listings/${id}`)).status, 200);
});

test('with photos the kick-off marks it checking, once', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-photo' });
  const id = r.data.id;
  addImage(id);
  let scheduled = 0;
  assert.equal(startGatedInspection(row(id), () => { scheduled++; }), 'checking');
  assert.equal(row(id).inspection_state, 'checking');
  // A retry from the app does not start a second check.
  assert.equal(startGatedInspection(row(id), () => { scheduled++; }), 'checking');
  assert.equal(scheduled, 1);
  assert.equal(reviewStateFor(row(id)), 'checking');
});

test('a clean verdict publishes; the seller hears nothing extra', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-good' });
  const id = r.data.id;
  addImage(id);
  startGatedInspection(row(id), () => {});
  const before = inbox(seller.id).length;
  assert.equal(applyInspectionResult(id, GOOD), 'published');
  const l = row(id);
  assert.equal(l.status, 'active');
  assert.equal(l.review_hold, 0);
  assert.equal(l.inspection_state, 'passed');
  assert.equal(reviewStateFor(l), 'published');
  assert.equal(inbox(seller.id).length, before);
  // The verdict is kept, as a clean row no operator needs to touch.
  const ins = db.prepare('SELECT * FROM listing_inspections WHERE listing_id=?').get(id);
  assert.equal(ins.verdict, 'clean');
  assert.equal(ins.action, 'published');
  assert.equal(ins.judged_by, 'model');
});

test('anything else holds for a person — even a confident defective is not auto-rejected', async () => {
  for (const [key, verdict] of [['new-bad', BAD_SURE], ['new-unclear', UNCLEAR]]) {
    const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: key });
    const id = r.data.id;
    addImage(id);
    startGatedInspection(row(id), () => {});
    assert.equal(applyInspectionResult(id, verdict), 'held');
    const l = row(id);
    assert.equal(l.status, 'removed');
    assert.equal(l.review_hold, 1);
    assert.equal(l.inspection_state, 'review');
    const rv = reviewFor(id);
    assert.equal(rv.state, 'under_review');
    assert.equal(rv.reason, defect.evidence);
    // Inbox row for the record, no push: the seller is on the status screen.
    const note = inbox(seller.id).filter((n) => n.payload.listing_id === id);
    assert.deepEqual(note.map((n) => [n.kind, n.pushed]), [['listing.review.pending', 0]]);
    assert.equal((await call(null, 'GET', `/listings/${id}`)).status, 404);
  }
});

test('the operator approves: live, announced, seller pushed, with a fresh clock', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-approve' });
  const id = r.data.id;
  addImage(id);
  startGatedInspection(row(id), () => {});
  applyInspectionResult(id, UNCLEAR);
  const insId = db.prepare('SELECT id FROM listing_inspections WHERE listing_id=?').get(id).id;
  const t0 = Date.now();
  assert.equal(resolveInspection(insId, 'approve'), id);
  const l = row(id);
  assert.equal(l.status, 'active');
  assert.equal(l.review_hold, 0);
  assert.equal(l.inspection_state, 'approved');
  assert.ok(l.bumped_at >= t0 - 5);
  assert.ok(l.expires_at > t0 + 29 * 24 * 60 * 60 * 1000);
  assert.equal(reviewFor(id).state, 'published');
  const note = inbox(seller.id).filter((n) => n.payload.listing_id === id).map((n) => [n.kind, n.pushed]);
  assert.deepEqual(note, [['listing.review.pending', 0], ['listing.review.approved', 1]]);
});

test('the operator refuses: rejected, with the reason, seller pushed, status page still readable', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-refuse' });
  const id = r.data.id;
  addImage(id);
  startGatedInspection(row(id), () => {});
  applyInspectionResult(id, BAD_SURE);
  const insId = db.prepare('SELECT id FROM listing_inspections WHERE listing_id=?').get(id).id;
  assert.equal(resolveInspection(insId, 'remove', { reason: 'الشاشة مكسورة بوضوح في الصورة الثانية' }), id);
  const l = row(id);
  assert.equal(l.status, 'removed');
  assert.equal(l.review_hold, 0);
  assert.equal(l.inspection_state, 'rejected');
  const rv = await call(seller, 'GET', `/listings/${id}/review`);
  assert.equal(rv.status, 200);
  assert.equal(rv.data.state, 'rejected');
  assert.equal(rv.data.reason, 'الشاشة مكسورة بوضوح في الصورة الثانية');
  const note = inbox(seller.id).filter((n) => n.payload.listing_id === id).map((n) => [n.kind, n.pushed]);
  assert.deepEqual(note, [['listing.review.pending', 0], ['listing.review.rejected', 1]]);
  // Gone from the seller's list, as a removed listing is.
  const mine = await call(seller, 'GET', '/listings/mine');
  assert.ok(!mine.data.some((x) => x.id === id));
});

test('the backstop publishes a quiet listing the app abandoned without photos', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-abandoned' });
  const id = r.data.id;
  const quiet = { schedule: () => {} };
  // Not yet: it was touched a second ago.
  assert.ok(!sweepStuckGates(Date.now(), quiet).some((x) => x.id === id));
  assert.equal(row(id).inspection_state, 'awaiting');
  // Three minutes later, nothing to check → live. (Listings with photos
  // left in 'checking' by the tests above are re-queued, not published.)
  const swept = sweepStuckGates(Date.now() + 4 * 60 * 1000, quiet);
  assert.deepEqual(swept.find((x) => x.id === id), { id, action: 'published' });
  assert.equal(row(id).status, 'active');
  assert.equal(row(id).inspection_state, 'unchecked');
});

test('a listing the seller deletes while waiting leaves the gate for good', async () => {
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-deleted' });
  const id = r.data.id;
  assert.equal((await call(seller, 'DELETE', `/listings/${id}`)).status, 200);
  const l = row(id);
  assert.equal(l.status, 'removed');
  assert.equal(l.review_hold, 0);
  assert.equal(l.inspection_state, null);
  assert.ok(!sweepStuckGates(Date.now() + 10 * 60 * 1000, { schedule: () => {} }).some((x) => x.id === id));
});

test('with the check switched off, a 1.0.0 app posts live like everyone else', async () => {
  setSettingValue('listing_inspection_enabled', '0');
  const r = await call(seller, 'POST', '/listings', { ...BODY, client_key: 'new-off' });
  assert.equal(r.data.status, 'active');
  assert.equal(r.data.review.state, 'published');
  setSettingValue('listing_inspection_enabled', '1');
});
