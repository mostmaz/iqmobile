// The printed-sticker request and the free week it can earn.
//
// Every test here pins a rule that a human would otherwise have to remember
// while clicking through a queue: that a shop cannot ask twice, that the
// device count is read from live listings rather than trusted, and — the one
// that costs real money if it breaks — that granting the free week EXTENDS a
// paid featuring window instead of replacing it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

// DB_PATH must be set before db.js is imported: it opens the file at module
// load, so an import hoisted above this line would open the wrong database
// and the test would pass alone and fail inside the suite.
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-sticker-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const {
  createStickerRequest, stickerStatus, advanceSticker,
  submitStickerProof, decideStickerProof,
  REWARD_DAYS, REWARD_MIN_LISTINGS, MAX_QTY,
} = await import('../src/shopSticker.js');

const NOW = Date.now();
const DAY = 86400000;

function shop(id, extra = {}) {
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate,
                                seller_type, shop_name, shop_address, shop_featured_until, created_at)
              VALUES(?,?,'x','حساب','Baghdad','shop',?,?,?,?)`)
    .run(id, `0770000${String(id).padStart(4, '0')}`, extra.shop_name || `متجر ${id}`,
      extra.address ?? 'الكرادة، شارع ٦٢، مقابل الجامع', extra.featured_until ?? null, NOW);
  return id;
}

let lid = 0;
function listing(sellerId, status = 'active', draft = 0) {
  const id = ++lid;
  db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price,
      governorate, status, is_draft, created_at, updated_at, expires_at)
    VALUES(?,?,'Apple','iPhone 13','used',500000,'Baghdad',?,?,?,?,?)`)
    .run(id, sellerId, status, draft, NOW, NOW, NOW + DAY);
  return id;
}

// ── asking for a sticker ───────────────────────────────────────────────

test('a request needs a real address — a governorate alone is not deliverable', () => {
  const id = shop(101, { address: 'بغداد' });
  const out = createStickerRequest(id, { address: 'بغداد' });
  assert.equal(out.error, 'address_required');
  assert.equal(out.status, 400);
});

test('a shop cannot queue a second sticker while one is unfulfilled', () => {
  const id = shop(102);
  assert.equal(createStickerRequest(id, {}).ok, true);
  const second = createStickerRequest(id, {});
  assert.equal(second.error, 'request_pending');
  assert.equal(stickerStatus(id).can_request, false);
});

test('quantity is clamped, not trusted', () => {
  const id = shop(103);
  createStickerRequest(id, { qty: 900, sticker_kind: 'stand' });
  const st = stickerStatus(id);
  assert.equal(st.open.qty, MAX_QTY);
  assert.equal(st.open.sticker_kind, 'stand');
});

test('an unknown sticker kind falls back to the window decal', () => {
  const id = shop(104);
  createStickerRequest(id, { sticker_kind: 'billboard' });
  assert.equal(stickerStatus(id).open.sticker_kind, 'window');
});

test('shipping closes the request, so the shop may ask again later', () => {
  const id = shop(105);
  const { id: reqId } = createStickerRequest(id, {});
  assert.equal(advanceSticker(reqId, 'shipped', 1).ok, true);
  assert.equal(stickerStatus(id).can_request, true);
});

test('a shipped sticker cannot be walked backwards into printing', () => {
  const id = shop(106);
  const { id: reqId } = createStickerRequest(id, {});
  advanceSticker(reqId, 'shipped', 1);
  const again = advanceSticker(reqId, 'printing', 1);
  assert.equal(again.error, 'bad_state');
});

// ── the free week ──────────────────────────────────────────────────────

test('the device count is read from live listings, not taken on trust', () => {
  const id = shop(107);
  createStickerRequest(id, {});
  for (let i = 0; i < REWARD_MIN_LISTINGS - 1; i++) listing(id);
  // Drafts and sold stock are not stock a customer can walk in and buy.
  listing(id, 'active', 1);
  listing(id, 'sold');

  const out = submitStickerProof(id, '/uploads/proof.jpg');
  assert.equal(out.error, 'not_enough_listings');
  assert.equal(out.listings, REWARD_MIN_LISTINGS - 1);

  listing(id);
  assert.equal(submitStickerProof(id, '/uploads/proof.jpg').ok, true);
  assert.equal(stickerStatus(id).reward.status, 'pending');
});

test('a proof cannot be sent twice while the first is unreviewed', () => {
  const id = shop(108);
  createStickerRequest(id, {});
  for (let i = 0; i < REWARD_MIN_LISTINGS; i++) listing(id);
  submitStickerProof(id, '/uploads/a.jpg');
  assert.equal(submitStickerProof(id, '/uploads/b.jpg').error, 'proof_pending');
});

test('there is nothing to prove without a sticker request', () => {
  const id = shop(109);
  for (let i = 0; i < REWARD_MIN_LISTINGS; i++) listing(id);
  assert.equal(submitStickerProof(id, '/uploads/a.jpg').error, 'no_sticker_request');
});

test('granting gives exactly one week of featuring', () => {
  const id = shop(110);
  const { id: reqId } = createStickerRequest(id, {});
  for (let i = 0; i < REWARD_MIN_LISTINGS; i++) listing(id);
  submitStickerProof(id, '/uploads/a.jpg');

  const before = Date.now();
  const out = decideStickerProof(reqId, 'grant', 1);
  assert.equal(out.ok, true);

  const until = db.prepare('SELECT shop_featured_until AS u FROM users WHERE id=?').get(id).u;
  const days = (until - before) / DAY;
  assert.ok(days > REWARD_DAYS - 0.01 && days < REWARD_DAYS + 0.01, `${days} days`);
});

test('a shop that already paid for featuring keeps its days — the free week is ADDED', () => {
  // The bug this pins: setting shop_featured_until = now + 7d would take
  // three weeks off a shop that had just paid for a month, as a reward.
  const paidUntil = NOW + 30 * DAY;
  const id = shop(111, { featured_until: paidUntil });
  const { id: reqId } = createStickerRequest(id, {});
  for (let i = 0; i < REWARD_MIN_LISTINGS; i++) listing(id);
  submitStickerProof(id, '/uploads/a.jpg');
  decideStickerProof(reqId, 'grant', 1);

  const until = db.prepare('SELECT shop_featured_until AS u FROM users WHERE id=?').get(id).u;
  assert.equal(until, paidUntil + REWARD_DAYS * DAY);
});

test('the same proof cannot be granted twice', () => {
  const id = shop(112);
  const { id: reqId } = createStickerRequest(id, {});
  for (let i = 0; i < REWARD_MIN_LISTINGS; i++) listing(id);
  submitStickerProof(id, '/uploads/a.jpg');
  decideStickerProof(reqId, 'grant', 1);
  assert.equal(decideStickerProof(reqId, 'grant', 1).error, 'bad_state');
});

test('a rejected proof grants nothing and lets the shop try again', () => {
  const id = shop(113);
  const { id: reqId } = createStickerRequest(id, {});
  for (let i = 0; i < REWARD_MIN_LISTINGS; i++) listing(id);
  submitStickerProof(id, '/uploads/blurry.jpg');
  decideStickerProof(reqId, 'reject', 1, 'الصورة ما تبيّن الملصق');

  const u = db.prepare('SELECT shop_featured_until AS u FROM users WHERE id=?').get(id).u;
  assert.equal(u, null);
  const st = stickerStatus(id);
  assert.equal(st.reward.status, 'rejected');
  assert.equal(st.reward.can_submit, true);
});

test('the shop is told each step, and the reward notification carries its end date', () => {
  const id = shop(114);
  const { id: reqId } = createStickerRequest(id, {});
  advanceSticker(reqId, 'printing', 1);
  advanceSticker(reqId, 'shipped', 1);
  for (let i = 0; i < REWARD_MIN_LISTINGS; i++) listing(id);
  submitStickerProof(id, '/uploads/a.jpg');
  decideStickerProof(reqId, 'grant', 1);

  const kinds = db.prepare('SELECT kind, payload_json FROM notifications WHERE user_id=? ORDER BY id').all(id);
  assert.deepEqual(kinds.map((k) => k.kind),
    ['sticker.printing', 'sticker.shipped', 'sticker.reward_granted']);
  assert.ok(JSON.parse(kinds[2].payload_json).until > Date.now());
});

test('the sticker notification payload never says request_id', () => {
  // request_id is the phone-request key, and the app routes on it: a sticker
  // notification carrying one would open some buyer's request instead.
  const id = shop(115);
  const { id: reqId } = createStickerRequest(id, {});
  advanceSticker(reqId, 'shipped', 1);
  const row = db.prepare("SELECT payload_json FROM notifications WHERE user_id=? AND kind='sticker.shipped'").get(id);
  const payload = JSON.parse(row.payload_json);
  assert.equal(payload.request_id, undefined);
  assert.equal(payload.sticker_request_id, reqId);
});

test('a non-shop account has no sticker status at all', () => {
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
              VALUES(200,'07700009999','x','فرد','Baghdad','individual',?)`).run(NOW);
  assert.equal(stickerStatus(200), null);
  assert.equal(createStickerRequest(200, {}).error, 'not_a_shop');
});
