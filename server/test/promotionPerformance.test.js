// Promotion performance.
//
// Every test here is about NOT overclaiming. The default feed orders by
// created_at DESC, so a listing's view rate decays with age regardless of
// promotion — "after > before" would look like a win for a listing nobody
// promoted. The module reports a window and refuses to compute a lift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { promotionWindow, windowStats, promotionPerformance } from '../src/promotionPerformance.js';

const DAY = 86400000;
const NOW = Date.parse('2026-09-07T12:00:00+03:00');
const SELLER = 1;
const BUYER = 2;

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE phone_listings(id INTEGER PRIMARY KEY, seller_id INTEGER,
      created_at INTEGER, featured_until INTEGER);
    CREATE TABLE feature_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER, status TEXT, reviewed_at INTEGER);
    CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER,
      type TEXT, user_id INTEGER, created_at INTEGER);
  `);
  const listing = (o = {}) => {
    const row = { id: 10, seller_id: SELLER, created_at: NOW - 60 * DAY, featured_until: NOW + 5 * DAY, ...o };
    db.prepare('INSERT INTO phone_listings VALUES(@id,@seller_id,@created_at,@featured_until)').run(row);
    return row;
  };
  const approved = (reviewedAt) =>
    db.prepare("INSERT INTO feature_requests(listing_id,status,reviewed_at) VALUES(10,'approved',?)").run(reviewedAt);
  const view = (at, who = 99) =>
    db.prepare("INSERT INTO events(listing_id,type,user_id,created_at) VALUES(10,'view',?,?)").run(who, at);
  const contact = (at, who = BUYER) =>
    db.prepare("INSERT INTO events(listing_id,type,user_id,created_at) VALUES(10,'contact_call',?,?)").run(who, at);
  return { db, listing, approved, view, contact };
}

test('an unpromoted listing has no window and no report', () => {
  const { db, listing } = fixture();
  const l = listing({ featured_until: null });
  assert.equal(promotionWindow(db, l.id, NOW), null);
  assert.equal(promotionPerformance(db, l, NOW), null);
});

test('the window starts at reviewed_at, not at boosted_at', () => {
  // boosted_at is re-stamped on every boost, so it marks the last bump rather
  // than the start of the promotion.
  const { db, listing, approved } = fixture();
  const l = listing();
  approved(NOW - 7 * DAY);
  assert.equal(promotionWindow(db, l.id, NOW).from, NOW - 7 * DAY);
});

test('stacked approvals report the whole promoted run, not its last segment', () => {
  // FeatureListingScreen uses .find() and takes the first match, which is
  // exact for one request and wrong for a run of them.
  const { db, listing, approved } = fixture();
  const l = listing();
  approved(NOW - 20 * DAY);
  approved(NOW - 7 * DAY);
  assert.equal(promotionWindow(db, l.id, NOW).from, NOW - 20 * DAY);
});

test("the seller's own views never count", () => {
  // The live bug this module refuses to repeat: /listings/mine counted them,
  // so a seller refreshing their own ad inflated the number they were
  // checking and then paid to promote it.
  const { db, listing, approved, view } = fixture();
  const l = listing();
  approved(NOW - 7 * DAY);
  for (let i = 0; i < 30; i++) view(NOW - 3 * DAY, SELLER);
  view(NOW - 3 * DAY, 99);
  const p = promotionPerformance(db, l, NOW);
  assert.equal(p.during.views, 1);
});

test('views outside the window are not counted inside it', () => {
  const { db, listing, approved, view } = fixture();
  const l = listing();
  approved(NOW - 7 * DAY);
  view(NOW - 30 * DAY);       // long before
  view(NOW - 3 * DAY);        // during
  const p = promotionPerformance(db, l, NOW);
  assert.equal(p.during.views, 1);
});

test('a comparable stretch before is offered only when it really existed', () => {
  const { db, listing, approved, view } = fixture();
  // Promoted 7 days ago, but the listing is only 8 days old — the prior
  // 7-day stretch would run past its creation, and half a window compared
  // against a whole one is not a comparison.
  const l = listing({ created_at: NOW - 8 * DAY });
  approved(NOW - 7 * DAY);
  view(NOW - 3 * DAY);
  const p = promotionPerformance(db, l, NOW);
  assert.equal(p.before, null);
});

test('a long-lived listing does get its before-window', () => {
  const { db, listing, approved, view, contact } = fixture();
  const l = listing({ created_at: NOW - 90 * DAY });
  approved(NOW - 6 * DAY);
  view(NOW - 10 * DAY); view(NOW - 9 * DAY);   // before
  view(NOW - 2 * DAY); contact(NOW - 2 * DAY); // during
  const p = promotionPerformance(db, l, NOW);
  assert.equal(p.before.views, 2);
  assert.equal(p.during.views, 1);
  assert.equal(p.during.contacts, 1);
});

test('the decay caveat always rides along, and no lift is ever computed', () => {
  // The point of the whole module. A "+300%" here would be a number the data
  // cannot support, and the age decay alone would produce one.
  const { db, listing, approved, view } = fixture();
  const l = listing({ created_at: NOW - 90 * DAY });
  approved(NOW - 6 * DAY);
  view(NOW - 2 * DAY);
  const p = promotionPerformance(db, l, NOW);
  assert.ok(p.caveats.includes('decay'));
  assert.ok(p.caveats.includes('saves_undercount'));
  assert.equal(p.lift, undefined, 'there must be no lift field to render');
  assert.equal(p.change, undefined);
});

test('a promotion younger than a day reports as pending, not as zero', () => {
  // Hours of data read as noise, and "0 views" on a promotion bought this
  // morning is a refund request waiting to happen.
  const { db, listing, approved } = fixture();
  const l = listing();
  approved(NOW - 3600_000);
  const p = promotionPerformance(db, l, NOW);
  assert.equal(p.pending, true);
  assert.equal(p.during, undefined);
});

test('an expired promotion still reports, and says it is over', () => {
  const { db, listing, approved, view } = fixture();
  const l = listing({ created_at: NOW - 90 * DAY, featured_until: NOW - 2 * DAY });
  approved(NOW - 9 * DAY);
  view(NOW - 5 * DAY);
  const p = promotionPerformance(db, l, NOW);
  assert.equal(p.active, false);
  assert.equal(p.during.views, 1);
  // Nothing after featured_until belongs to the promotion.
  assert.equal(p.until, NOW - 2 * DAY);
});

test('windowStats is half-open so a boundary event lands in exactly one window', () => {
  const { db, listing, view } = fixture();
  const l = listing();
  view(NOW - 5 * DAY);
  const a = windowStats(db, { listingId: 10, sellerId: SELLER, from: NOW - 6 * DAY, to: NOW - 5 * DAY });
  const b = windowStats(db, { listingId: 10, sellerId: SELLER, from: NOW - 5 * DAY, to: NOW - 4 * DAY });
  assert.equal(a.views + b.views, 1, 'counted once, not twice and not zero');
  assert.equal(b.views, 1, 'the `from` edge is inclusive');
});
