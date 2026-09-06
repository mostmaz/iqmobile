// Seller-facing listing advice.
//
// The invariant the whole feature rests on: never a number without a reason
// and an action. The last test asserts that structurally, so a future branch
// that returns a bare metric fails here rather than shipping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { listingAdvice, listingAdviceFor, THRESHOLDS } from '../src/listingAdvice.js';

const DAY = 86400000;
const NOW = Date.parse('2026-09-07T12:00:00+03:00');
const SELLER = 1;
const BUYER = 2;

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE phone_listings(id INTEGER PRIMARY KEY, seller_id INTEGER, brand TEXT,
      model TEXT, storage TEXT, asking_price INTEGER, price_on_request INTEGER DEFAULT 0,
      status TEXT, created_at INTEGER);
    CREATE TABLE listing_images(id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER);
    CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER, type TEXT,
      user_id INTEGER, created_at INTEGER);
    CREATE TABLE chats(id INTEGER PRIMARY KEY, listing_id INTEGER, buyer_id INTEGER);
    CREATE TABLE chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER,
      sender_id INTEGER, created_at INTEGER);
    CREATE TABLE listing_diagnostics(listing_id INTEGER PRIMARY KEY, price_delta_pct INTEGER);
  `);
  const listing = (o = {}) => {
    const row = {
      id: 10, seller_id: SELLER, brand: 'Apple', model: 'iPhone 13', storage: '128GB',
      asking_price: 700000, price_on_request: 0, status: 'active',
      created_at: NOW - 30 * DAY, ...o,
    };
    db.prepare(`INSERT INTO phone_listings VALUES(@id,@seller_id,@brand,@model,@storage,
      @asking_price,@price_on_request,@status,@created_at)`).run(row);
    return row;
  };
  const views = (n, listingId = 10, who = 99) => {
    for (let i = 0; i < n; i++) {
      db.prepare('INSERT INTO events(listing_id,type,user_id,created_at) VALUES(?,?,?,?)')
        .run(listingId, 'view', who, NOW - DAY);
    }
  };
  const photos = (n, listingId = 10) => {
    for (let i = 0; i < n; i++) db.prepare('INSERT INTO listing_images(listing_id) VALUES(?)').run(listingId);
  };
  const tap = (listingId = 10, who = BUYER) =>
    db.prepare('INSERT INTO events(listing_id,type,user_id,created_at) VALUES(?,?,?,?)')
      .run(listingId, 'contact_call', who, NOW - DAY);
  /** A buyer message, optionally followed by a seller reply. */
  const chat = ({ id = 100, listingId = 10, buyer = BUYER, askedAgo = 2, repliedAgo = null } = {}) => {
    db.prepare('INSERT INTO chats VALUES(?,?,?)').run(id, listingId, buyer);
    db.prepare('INSERT INTO chat_messages(chat_id,sender_id,created_at) VALUES(?,?,?)')
      .run(id, buyer, NOW - askedAgo * DAY);
    if (repliedAgo != null) {
      db.prepare('INSERT INTO chat_messages(chat_id,sender_id,created_at) VALUES(?,?,?)')
        .run(id, SELLER, NOW - repliedAgo * DAY);
    }
  };
  return { db, listing, views, photos, tap, chat };
}

const opts = { now: NOW };

test('a listing too young to judge gets no advice at all', () => {
  const { db, listing } = fixture();
  const l = listing({ created_at: NOW - 1 * DAY });
  assert.equal(listingAdvice(db, l, opts), null,
    'telling someone their one-day-old ad is failing is noise, not help');
});

test('an unanswered buyer outranks everything else', () => {
  const { db, listing, views, photos, chat } = fixture();
  const l = listing();
  photos(1);          // would otherwise be few_photos
  views(2);           // would otherwise be low_views
  chat({ askedAgo: 4 });
  const a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'unanswered_inquiries');
  assert.equal(a.severity, 'urgent');
  assert.equal(a.action, 'reply');
  assert.equal(a.metric.unanswered, 1);
  assert.equal(a.metric.waiting_days, 4);
});

test('a seller who replied is not nagged', () => {
  const { db, listing, views, photos, chat } = fixture();
  const l = listing();
  photos(3); views(40);
  chat({ askedAgo: 4, repliedAgo: 3 });
  const a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'ok');
});

test('a greeting sent before the buyer spoke is not a reply', () => {
  const { db, listing, views, photos, chat } = fixture();
  const l = listing();
  photos(3); views(40);
  // Seller message at day 6, buyer's question at day 4 — the seller has not
  // answered the question, they merely spoke first.
  chat({ askedAgo: 4, repliedAgo: 6 });
  const a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'unanswered_inquiries', 'a reply must come after the question');
});

test('a chat whose messages aged out of the 90-day purge is not counted as waiting', () => {
  const { db, listing, views, photos } = fixture();
  const l = listing();
  photos(3); views(40);
  // Thread row survives the purge, its messages do not.
  db.prepare('INSERT INTO chats VALUES(?,?,?)').run(100, 10, BUYER);
  const a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'views_no_inquiry',
    'there is no message left to answer, so nobody is being kept waiting');
});

test('few views blames photos when photos are short, reach when they are not', () => {
  const { db, listing, views, photos } = fixture();
  const l = listing();
  photos(1); views(3);
  let a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'low_views');
  assert.equal(a.reason, 'few_photos');
  assert.equal(a.action, 'add_photos');

  const f2 = fixture();
  const l2 = f2.listing();
  f2.photos(5); f2.views(3);
  a = listingAdvice(f2.db, l2, opts);
  assert.equal(a.reason, 'low_reach');
  assert.equal(a.action, 'improve_discovery');
});

test('views without inquiries names the price only with a real comparison behind it', () => {
  const { db, listing, views, photos } = fixture();
  const l = listing();
  photos(3); views(60);
  // No diagnostics row — the daily job needs three same-model peers before it
  // writes one, so there is no basis to claim the price is wrong.
  let a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'views_no_inquiry');
  assert.equal(a.reason, 'unclear_value');
  assert.notEqual(a.reason, 'price_high');

  db.prepare('INSERT INTO listing_diagnostics VALUES(?,?)').run(10, 26);
  a = listingAdvice(db, l, opts);
  assert.equal(a.reason, 'price_high');
  assert.equal(a.action, 'review_price');
  assert.equal(a.metric.price_delta_pct, 26);
});

test('a price only slightly above the median is not called out', () => {
  const { db, listing, views, photos } = fixture();
  const l = listing();
  photos(3); views(60);
  db.prepare('INSERT INTO listing_diagnostics VALUES(?,?)').run(10, THRESHOLDS.PRICE_HIGH_PCT);
  const a = listingAdvice(db, l, opts);
  assert.equal(a.reason, 'unclear_value', 'at the threshold, not over it');
});

test('a contact tap counts as an inquiry even with no chat', () => {
  const { db, listing, views, photos, tap } = fixture();
  const l = listing();
  photos(3); views(60); tap();
  const a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'ok', 'someone called — the listing is working');
});

test("the seller's own views and taps never count", () => {
  const { db, listing, photos, views } = fixture();
  const l = listing();
  photos(3);
  views(60, 10, SELLER);   // seller refreshing their own ad
  const a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'low_views', 'checking your own listing is not demand');
});

test('views older than the window do not prop up a dead listing', () => {
  const { db, listing, photos } = fixture();
  const l = listing({ created_at: NOW - 200 * DAY });
  photos(3);
  for (let i = 0; i < 80; i++) {
    db.prepare('INSERT INTO events(listing_id,type,user_id,created_at) VALUES(?,?,?,?)')
      .run(10, 'view', 99, NOW - 120 * DAY);
  }
  const a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'low_views');
  assert.equal(a.metric.views, 0);
});

test('a healthy listing is told so', () => {
  const { db, listing, views, photos, tap } = fixture();
  const l = listing();
  photos(4); views(80); tap();
  const a = listingAdvice(db, l, opts);
  assert.equal(a.id, 'ok');
  assert.equal(a.severity, 'ok');
  assert.equal(a.action, null);
});

test('every advice carries a reason, and every problem carries an action', () => {
  // The rule from shopDiagnostics.js: "a weak metric never travels alone."
  const cases = [
    (f) => { f.photos(1); f.views(2); },                          // low_views/few_photos
    (f) => { f.photos(5); f.views(2); },                          // low_views/low_reach
    (f) => { f.photos(3); f.views(60); },                         // views_no_inquiry
    (f) => { f.photos(3); f.views(60); f.chat({ askedAgo: 1 }); },// unanswered
    (f) => { f.photos(4); f.views(80); f.tap(); },                // ok
  ];
  for (const setup of cases) {
    const f = fixture();
    const l = f.listing();
    setup(f);
    const a = listingAdvice(f.db, l, opts);
    assert.ok(a, 'a judged listing always gets a verdict');
    assert.ok(a.metric && Object.keys(a.metric).length > 0, `${a.id} returned no metric`);
    assert.ok(a.reason, `${a.id} returned a metric with no reason`);
    assert.ok(a.severity, `${a.id} has no severity`);
    if (a.severity !== 'ok') {
      assert.ok(a.action, `${a.id} states a problem but offers no action`);
    }
  }
});

test('one broken row does not cost the seller the whole screen', () => {
  const { db, listing, photos, views } = fixture();
  const good = listing({ id: 10 });
  photos(3); views(60);
  const broken = { id: 999, seller_id: SELLER, created_at: null };
  const out = listingAdviceFor(db, [good, broken], opts);
  assert.ok(out[10], 'the good listing still gets advice');
  assert.equal(out[999], undefined);
});
