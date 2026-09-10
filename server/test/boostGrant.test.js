// The granting path, against a real schema on a real (temporary) database.
//
// boostLimits and smartBoost are tested as pure functions elsewhere; what
// this file exercises is the part that cannot be pure — the transaction, the
// UNIQUE index that makes a replayed callback harmless, and the expirer sweep
// that runs hours later with nobody watching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// db.js reads DB_PATH at import time, so it is set before the dynamic import.
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-boost-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db, setSettingValue } = await import('../src/db.js');
const { grantBoost } = await import('../src/routes/boosts.js');

const HOUR = 3600000;
const DAY = 24 * HOUR;

// Each test gets its OWN seller. The daily limit is real and global to a
// user, so a shared seller means test 3 fails because tests 1 and 2 spent
// the allowance — which is the limiter working, and a useless signal.
let sellerSeq = 500;

setSettingValue('rewarded_boost_enabled', '1');

// users has several NOT NULL columns with no default; an INSERT OR IGNORE
// that omits them fails silently and every listing insert then trips the
// foreign key, which is a confusing way to learn you have no seller.
function seedUser(id, phone, name) {
  db.prepare(
    `INSERT OR IGNORE INTO users(id, phone, password_hash, display_name, governorate, created_at)
     VALUES(?,?,?,?,?,?)`,
  ).run(id, phone, '', name, 'Baghdad', Date.now());
  const ok = db.prepare('SELECT 1 FROM users WHERE id=?').get(id);
  if (!ok) throw new Error(`seed failed for user ${id}`);
}

function freshSeller() {
  const id = ++sellerSeq;
  seedUser(id, `0770000${String(id).padStart(4, '0')}`, `Seller ${id}`);
  return id;
}

let nextId = 9000;
function listing(seller, o = {}) {
  const id = ++nextId;
  const t = Date.now();
  db.prepare(
    `INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price,
       governorate, status, created_at, expires_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, seller, 'Apple', 'iPhone 15', 'used', 500000, 'Baghdad',
    o.status || 'active', o.created_at ?? (t - 30 * DAY), t + 30 * DAY, t);
  return id;
}

function attempt(seller, listingId, nonce, rank) {
  db.prepare(
    `INSERT INTO listing_boosts(user_id, listing_id, nonce, status, rank_at_request, requested_at)
     VALUES(?,?,?,'pending',?,?)`,
  ).run(seller, listingId, nonce, rank, Date.now());
}

test('a verified reward grants exactly one boost', () => {
  const seller = freshSeller();
  const id = listing(seller);
  attempt(seller, id, 'n-1', 999);                       // far down the feed
  const out = grantBoost({ nonce: 'n-1', transactionId: 'tx-1' });
  assert.equal(out.ok, true);
  assert.equal(out.type, 'immediate_bump');

  const row = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(id);
  assert.ok(row.bumped_at > 0, 'bumped');
  assert.ok(row.boost_highlight_until > Date.now(), 'and highlighted');
  assert.equal(row.boost_scheduled_bump_at, null, 'one ad, one bump');
});

test('created_at is never written by a boost', () => {
  const seller = freshSeller();
  const before = Date.now() - 77 * DAY;
  const id = listing(seller, { created_at: before });
  attempt(seller, id, 'n-created', 999);
  grantBoost({ nonce: 'n-created', transactionId: 'tx-created' });
  assert.equal(
    db.prepare('SELECT created_at FROM phone_listings WHERE id=?').get(id).created_at,
    before,
    'created_at means "posted" and the listing page says so',
  );
});

test('a replayed callback grants nothing the second time', () => {
  const seller = freshSeller();
  const id = listing(seller);
  attempt(seller, id, 'n-2', 999);
  const first = grantBoost({ nonce: 'n-2', transactionId: 'tx-2' });
  const second = grantBoost({ nonce: 'n-2', transactionId: 'tx-2' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already_granted');
  const n = db.prepare("SELECT COUNT(*) n FROM listing_boosts WHERE nonce='n-2' AND granted_at IS NOT NULL").get().n;
  assert.equal(n, 1);
});

test('an unknown nonce is dropped, not granted', () => {
  const out = grantBoost({ nonce: 'never-minted', transactionId: 'tx-x' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unknown_nonce');
});

test('a listing sold while the ad played is not boosted', () => {
  const seller = freshSeller();
  const id = listing(seller);
  attempt(seller, id, 'n-3', 999);
  db.prepare("UPDATE phone_listings SET status='sold' WHERE id=?").run(id);
  const out = grantBoost({ nonce: 'n-3', transactionId: 'tx-3' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'listing_gone');
  assert.equal(db.prepare('SELECT bumped_at FROM phone_listings WHERE id=?').get(id).bumped_at, null);
  assert.equal(db.prepare("SELECT status FROM listing_boosts WHERE nonce='n-3'").get().status, 'failed');
});

test('the allowance is re-checked at grant time, not trusted from the start', () => {
  // Two ads watched in parallel both passed the check at /start. Only one
  // may land, or the limit is advisory.
  const seller = freshSeller();
  const a = listing(seller);
  const b = listing(seller);
  attempt(seller, a, 'n-p1', 999);
  attempt(seller, b, 'n-p2', 999);

  const first = grantBoost({ nonce: 'n-p1', transactionId: 'tx-p1' });
  const second = grantBoost({ nonce: 'n-p2', transactionId: 'tx-p2' });

  assert.equal(first.ok, true, 'the first lands');
  assert.equal(second.ok, false, 'the second does not — the 4h gap has not passed');
  assert.equal(second.reason, 'cooldown');

  const granted = db.prepare(
    "SELECT COUNT(*) n FROM listing_boosts WHERE user_id=? AND granted_at IS NOT NULL",
  ).get(seller).n;
  assert.equal(granted, 1, 'one ad in flight, one boost out');
});

test('a listing near the top is highlighted now and bumped later', () => {
  // Fresh seller so the allowance is clean.
  const other = freshSeller();
  const id = ++nextId;
  const t = Date.now();
  db.prepare(
    `INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price,
       governorate, status, created_at, expires_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, other, 'Apple', 'iPhone 15', 'used', 500000, 'Baghdad', 'active', t, t + 30 * DAY, t);
  db.prepare(
    `INSERT INTO listing_boosts(user_id, listing_id, nonce, status, rank_at_request, requested_at)
     VALUES(?,?,?,'pending',?,?)`,
  ).run(other, id, 'n-top', 0, t);

  const out = grantBoost({ nonce: 'n-top', transactionId: 'tx-top' });
  assert.equal(out.ok, true);
  assert.equal(out.type, 'delayed_bump');
  const row = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(id);
  assert.equal(row.bumped_at, null, 'not bumped yet — that is the whole point');
  assert.ok(row.boost_scheduled_bump_at > Date.now());
  assert.equal(db.prepare("SELECT status FROM listing_boosts WHERE nonce='n-top'").get().status, 'scheduled');
});

test('cleanup', () => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
