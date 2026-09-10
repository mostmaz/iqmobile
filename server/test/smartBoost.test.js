import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { listingRankPosition, decideBoost } from '../src/smartBoost.js';
import { BOOST_DEFAULTS } from '../src/boostLimits.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-10T12:00:00+03:00');
const CFG = { ...BOOST_DEFAULTS, enabled: true };

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE phone_listings(
    id INTEGER PRIMARY KEY, seller_id INTEGER, brand TEXT, status TEXT,
    created_at INTEGER, bumped_at INTEGER, is_draft INTEGER, stale_since INTEGER)`);
  const add = (o = {}) => {
    const row = {
      id: null, seller_id: 1, brand: 'Apple', status: 'active',
      created_at: NOW - DAY, bumped_at: null, is_draft: 0, stale_since: null, ...o,
    };
    const info = db.prepare(
      `INSERT INTO phone_listings(seller_id,brand,status,created_at,bumped_at,is_draft,stale_since)
       VALUES(@seller_id,@brand,@status,@created_at,@bumped_at,@is_draft,@stale_since)`,
    ).run(row);
    return Number(info.lastInsertRowid);
  };
  return { db, add };
}

test('the newest listing is at rank 0', () => {
  const { db, add } = fixture();
  add({ created_at: NOW - 5 * DAY });
  add({ created_at: NOW - 3 * DAY });
  const newest = add({ created_at: NOW - 1 * HOUR });
  assert.equal(listingRankPosition(db, newest), 0);
});

test('rank counts what a buyer can actually buy', () => {
  // Sold, removed, draft and price-book rows are above nobody. Counting them
  // would inflate every rank and push every listing into the immediate-bump
  // branch, quietly killing Smart Boost.
  const { db, add } = fixture();
  const mine = add({ created_at: NOW - 10 * DAY });
  add({ created_at: NOW, status: 'sold' });
  add({ created_at: NOW, status: 'expired' });
  add({ created_at: NOW, status: 'removed' });
  add({ created_at: NOW, is_draft: 1 });
  add({ created_at: NOW, stale_since: NOW - HOUR });
  assert.equal(listingRankPosition(db, mine), 0);
  add({ created_at: NOW, status: 'reserved' });
  assert.equal(listingRankPosition(db, mine), 1, 'reserved is still on sale');
});

test('a bump moves a listing up the rank, its age does not', () => {
  const { db, add } = fixture();
  const old = add({ created_at: NOW - 90 * DAY });
  for (let i = 0; i < 5; i++) add({ created_at: NOW - i * HOUR });
  assert.equal(listingRankPosition(db, old), 5);
  db.prepare('UPDATE phone_listings SET bumped_at=? WHERE id=?').run(NOW, old);
  assert.equal(listingRankPosition(db, old), 0, 'bumped to the front');
  assert.equal(
    db.prepare('SELECT created_at FROM phone_listings WHERE id=?').get(old).created_at,
    NOW - 90 * DAY,
    'and created_at is untouched',
  );
});

test('a listing near the top waits for its bump', () => {
  const d = decideBoost(3, CFG, NOW);
  assert.equal(d.type, 'delayed_bump');
  assert.equal(d.bumpedAt, null, 'rank is not touched yet');
  assert.equal(d.highlightUntil, NOW + 4 * HOUR);
  assert.equal(d.scheduledBumpAt, NOW + 4 * HOUR, 'bumped when the highlight ends');
});

test('a listing down the feed is bumped now and never again', () => {
  const d = decideBoost(200, CFG, NOW);
  assert.equal(d.type, 'immediate_bump');
  assert.equal(d.bumpedAt, NOW);
  assert.equal(d.scheduledBumpAt, null, 'one ad is one bump');
});

test('the threshold is exclusive at its edge', () => {
  assert.equal(decideBoost(CFG.topThreshold - 1, CFG, NOW).type, 'delayed_bump');
  assert.equal(decideBoost(CFG.topThreshold, CFG, NOW).type, 'immediate_bump');
});

test('a threshold of zero turns Smart Boost off', () => {
  // The operator's escape hatch: every boost becomes immediate.
  assert.equal(decideBoost(0, { ...CFG, topThreshold: 0 }, NOW).type, 'immediate_bump');
});
