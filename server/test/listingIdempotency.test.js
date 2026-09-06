// The create-retry contract: a repeat of a client_key this seller already
// used returns the SAME listing rather than making a second one.
//
// The failure this guards against is not hypothetical — the wizard now
// persists a draft across app kills, and that draft carries its client_key
// precisely so a create whose response was lost can be retried. Without the
// unique index the retry would post the phone twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE phone_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      brand TEXT, model TEXT, asking_price INTEGER,
      client_key TEXT
    );
    CREATE UNIQUE INDEX idx_listings_client_key
      ON phone_listings(seller_id, client_key) WHERE client_key IS NOT NULL;
  `);
  return db;
}

const insert = (db, sellerId, key) => db
  .prepare('INSERT INTO phone_listings(seller_id, brand, model, asking_price, client_key) VALUES(?,?,?,?,?)')
  .run(sellerId, 'Apple', 'iPhone 13', 500000, key).lastInsertRowid;

const lookup = (db, sellerId, key) => db
  .prepare('SELECT id FROM phone_listings WHERE seller_id=? AND client_key=?')
  .get(sellerId, key);

test('a repeated key for the same seller is found, so the route can return the first listing', () => {
  const db = fixture();
  const first = insert(db, 1, 'k-abc');
  const prior = lookup(db, 1, 'k-abc');
  assert.ok(prior, 'the retry must find the listing the first attempt made');
  assert.equal(prior.id, first);
  // And if the route did not check, the index would stop the duplicate anyway.
  assert.throws(() => insert(db, 1, 'k-abc'), /UNIQUE/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM phone_listings').get().n, 1);
});

test('the same key from a different seller is a different listing', () => {
  const db = fixture();
  insert(db, 1, 'k-abc');
  // Keys are client-generated, so two devices CAN collide. Scoping the index
  // per seller is what keeps that from being one user blocking another.
  assert.doesNotThrow(() => insert(db, 2, 'k-abc'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM phone_listings').get().n, 2);
  assert.notEqual(lookup(db, 1, 'k-abc').id, lookup(db, 2, 'k-abc').id);
});

test('listings without a key never collide', () => {
  const db = fixture();
  // Years of existing rows have client_key NULL. A non-partial index would
  // treat them all as duplicates of each other and break every legacy write.
  assert.doesNotThrow(() => insert(db, 1, null));
  assert.doesNotThrow(() => insert(db, 1, null));
  assert.doesNotThrow(() => insert(db, 1, null));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM phone_listings').get().n, 3);
});

test('a fresh key from the same seller creates a second listing', () => {
  const db = fixture();
  const a = insert(db, 1, 'k-one');
  const b = insert(db, 1, 'k-two');
  assert.notEqual(a, b);
  assert.equal(lookup(db, 1, 'k-two').id, b);
  // Posting a second phone must not be mistaken for a retry of the first.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM phone_listings').get().n, 2);
});
