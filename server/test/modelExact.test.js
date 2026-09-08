// The exact-model filter behind the request funnel's third step.
//
// This runs the REAL SQL expression against a real (in-memory) table, because
// the property that matters — both sides through one fold — is a property
// of the SQL, not of any JS around it. LIKE '%iPhone 13%' was rejected
// because it also returns every "iPhone 13 Pro Max"; the first test is that
// over-match, pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { arabicNormalizeSql } from '../src/searchNormalize.js';

function table(models) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE phone_listings(id INTEGER PRIMARY KEY, model TEXT)');
  const ins = db.prepare('INSERT INTO phone_listings(model) VALUES(?)');
  for (const m of models) ins.run(m);
  return db;
}
const exact = (db, q) => db.prepare(
  `SELECT model FROM phone_listings l WHERE ${arabicNormalizeSql('l.model')} = ${arabicNormalizeSql('?')}`,
).all(q).map((r) => r.model);
const like = (db, q) => db.prepare(
  'SELECT model FROM phone_listings WHERE model LIKE ?',
).all('%' + q + '%').map((r) => r.model);

test('"iPhone 13" no longer drags in every Pro and Pro Max', () => {
  const db = table(['iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone 13 mini']);
  assert.equal(like(db, 'iPhone 13').length, 4, 'precondition: this is why LIKE was unusable');
  assert.deepEqual(exact(db, 'iPhone 13'), ['iPhone 13']);
});

test('case and spacing differences are still one device', () => {
  // The chip label came from grouping on this same fold, so a chip for
  // "Galaxy S25 Ultra" must find the seller who typed "galaxy s25  ultra".
  const db = table(['Galaxy S25 Ultra', 'galaxy s25  ultra', 'GALAXY S25ULTRA', 'Galaxy S25']);
  assert.equal(exact(db, 'Galaxy S25 Ultra').length, 3);
  assert.equal(exact(db, 'Galaxy S25').length, 1);
});

test('Arabic orthography variants fold the same on both sides', () => {
  const db = table(['ايفون ١٣', 'أيفون 13', 'إيفون13']);
  // Whatever spelling the chip carries, it reaches all three.
  assert.equal(exact(db, 'ايفون 13').length, 3);
  assert.equal(exact(db, 'أيفون ١٣').length, 3);
});

test('a word of difference is a different device — no line-word merging', () => {
  // "Galaxy S26 Ultra" vs "S26 Ultra" stay separate on purpose; the join
  // that would merge them once renamed an Apple Watch to an iPhone.
  const db = table(['Galaxy S26 Ultra', 'S26 Ultra']);
  assert.deepEqual(exact(db, 'S26 Ultra'), ['S26 Ultra']);
});

test('the bound parameter is folded too, not just the column', () => {
  // If only the column were normalised, a chip label with a capital letter
  // or a double space would silently match nothing.
  const db = table(['redmi note 13']);
  assert.equal(exact(db, 'Redmi  Note 13').length, 1);
});
