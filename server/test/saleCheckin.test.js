// «انباع الجهاز؟»: asked 72h after the first contact, answered with a
// price or a «still here», re-asked weekly at most twice, never after
// silence, and only to a build that can show the buttons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-sold-check-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-sold-check';
const { db } = await import('../src/db.js');
const {
  dueCheckins, runSaleCheckins, answerSaleCheckin, checkinStateFor, firstContactAt,
  FIRST_ASK_AFTER_MS, REASK_AFTER_MS, MAX_ROUNDS, KIND,
} = await import('../src/saleCheckin.js');
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const HOUR = 3600000, DAY = 86400000;
const NOW = Date.parse('2026-10-01T12:00:00+03:00');
let uid = 0, lid = 0, cid = 0, mid = 0;
function user({ version = '1.0.0', guest = false } = {}) {
  const id = ++uid + 500;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at, is_guest)
              VALUES(?,?,'x','بائع','Baghdad','individual',?,?)`).run(id, guest ? `guest:${id}` : `07700${String(id).padStart(6, '0')}`, NOW - 30 * DAY, guest ? 1 : 0);
  if (version) {
    db.prepare(`INSERT INTO user_active_days(user_id, day, requests, first_seen, last_seen, platform, app_version)
                VALUES(?, '2026-09-30', 1, ?, ?, 'android', ?)`).run(id, NOW - DAY, NOW - DAY, version);
  }
  return id;
}
function listing(sellerId, { status = 'active' } = {}) {
  const id = ++lid;
  db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price, governorate, status, is_draft, created_at, updated_at, expires_at)
              VALUES(?,?,'Samsung','Galaxy S21','used',400000,'Baghdad',?,0,?,?,?)`).run(id, sellerId, status, NOW - 10 * DAY, NOW - 10 * DAY, NOW + 20 * DAY);
  return id;
}
function contactByChat(listingId, sellerId, at) {
  const b = user();
  const c = ++cid;
  db.prepare('INSERT INTO chats(id, listing_id, buyer_id, seller_id, created_at, last_message_at) VALUES(?,?,?,?,?,?)').run(c, listingId, b, sellerId, at, at);
  db.prepare('INSERT INTO chat_messages(id, chat_id, sender_id, body, masked, created_at) VALUES(?,?,?,?,0,?)').run(++mid, c, b, 'متوفر؟', at);
}
function contactByCall(listingId, at) {
  db.prepare("INSERT INTO events(type, listing_id, user_id, created_at) VALUES('contact_call', ?, NULL, ?)").run(listingId, at);
}
const dueIds = (at) => dueCheckins(db, at).map((d) => d.listing_id);
const inbox = (userId) => db.prepare('SELECT kind, payload_json, read FROM notifications WHERE user_id=? ORDER BY id').all(userId)
  .map((n) => ({ kind: n.kind, payload: JSON.parse(n.payload_json), read: n.read }));

test('first contact is the earliest of a buyer message and a call tap', () => {
  const s = user(); const l = listing(s);
  assert.equal(firstContactAt(db, l), null);
  contactByChat(l, s, NOW - 2 * DAY);
  contactByCall(l, NOW - 4 * DAY);
  assert.equal(firstContactAt(db, l), NOW - 4 * DAY);
});

test('asked 72 hours after the first contact, not before, with the device named', () => {
  const s = user(); const l = listing(s);
  contactByChat(l, s, NOW - FIRST_ASK_AFTER_MS + HOUR);
  assert.ok(!dueIds(NOW).includes(l));
  const r = runSaleCheckins({ at: NOW + 2 * HOUR });
  assert.ok(r.asked >= 1);
  const [n] = inbox(s).filter((x) => x.kind === KIND);
  assert.equal(n.payload.listing_id, l);
  assert.equal(n.payload.round, 1);
  assert.equal(n.payload.device, 'Samsung Galaxy S21');
  const st = checkinStateFor(db, l);
  assert.equal(st.pending.round, 1);
  // Not asked twice while the question is open.
  assert.ok(!dueIds(NOW + 10 * DAY).includes(l));
});

test('a listing nobody contacted, a sold one, and a held one are never asked', () => {
  const s = user();
  const quiet = listing(s);
  const sold = listing(s, { status: 'sold' }); contactByChat(sold, s, NOW - 10 * DAY);
  const held = listing(s); db.prepare("UPDATE phone_listings SET status='removed', review_hold=1 WHERE id=?").run(held); contactByChat(held, s, NOW - 10 * DAY);
  const ids = dueIds(NOW);
  for (const id of [quiet, sold, held]) assert.ok(!ids.includes(id), `listing ${id}`);
});

test('only a build that can show the buttons is asked; guests never', () => {
  const old = user({ version: '0.5.2' }); const l1 = listing(old); contactByCall(l1, NOW - 5 * DAY);
  const none = user({ version: null }); const l2 = listing(none); contactByCall(l2, NOW - 5 * DAY);
  const g = user({ guest: true }); const l3 = listing(g); contactByCall(l3, NOW - 5 * DAY);
  const ok = user(); const l4 = listing(ok); contactByCall(l4, NOW - 5 * DAY);
  const ids = dueIds(NOW);
  assert.ok(!ids.includes(l1)); assert.ok(!ids.includes(l2)); assert.ok(!ids.includes(l3));
  assert.ok(ids.includes(l4));
});

test('«انباع» closes the listing, keeps the price if given, and clears the inbox row', () => {
  const s = user(); const l = listing(s); contactByCall(l, NOW - 5 * DAY);
  runSaleCheckins({ at: NOW });
  const out = answerSaleCheckin(l, s, 'sold', { salePrice: '375000', at: NOW + HOUR });
  assert.equal(out.ok, true);
  const row = db.prepare('SELECT status, sold_at, sale_price FROM phone_listings WHERE id=?').get(l);
  assert.deepEqual(row, { status: 'sold', sold_at: NOW + HOUR, sale_price: 375000 });
  assert.equal(out.pending, null);
  assert.equal(out.last_answer, 'sold');
  assert.ok(inbox(s).filter((x) => x.kind === KIND).every((x) => x.read === 1));
  // Someone else's listing: refused.
  const other = user();
  assert.equal(answerSaleCheckin(l, other, 'still').error, 'forbidden');
});

test('«انباع» without a price still closes it; a price is optional', () => {
  const s = user(); const l = listing(s); contactByCall(l, NOW - 5 * DAY);
  runSaleCheckins({ at: NOW });
  answerSaleCheckin(l, s, 'sold', { at: NOW + HOUR });
  const row = db.prepare('SELECT status, sale_price FROM phone_listings WHERE id=?').get(l);
  assert.deepEqual(row, { status: 'sold', sale_price: null });
});

test('«بعده موجود» → asked again in 7 days, at most twice; silence ends it', () => {
  const s = user(); const l = listing(s); contactByCall(l, NOW - 5 * DAY);
  runSaleCheckins({ at: NOW });
  answerSaleCheckin(l, s, 'still', { at: NOW + HOUR });
  assert.equal(db.prepare('SELECT status FROM phone_listings WHERE id=?').get(l).status, 'active');
  // Six days later: not yet. Seven: round 2.
  assert.ok(!dueIds(NOW + HOUR + 6 * DAY).includes(l));
  assert.deepEqual(dueCheckins(db, NOW + HOUR + REASK_AFTER_MS).filter((d) => d.listing_id === l).map((d) => d.round), [2]);
  runSaleCheckins({ at: NOW + HOUR + REASK_AFTER_MS });
  answerSaleCheckin(l, s, 'still', { at: NOW + 2 * HOUR + REASK_AFTER_MS });
  assert.deepEqual(dueCheckins(db, NOW + 2 * HOUR + 2 * REASK_AFTER_MS).filter((d) => d.listing_id === l).map((d) => d.round), [3]);
  runSaleCheckins({ at: NOW + 2 * HOUR + 2 * REASK_AFTER_MS });
  answerSaleCheckin(l, s, 'still', { at: NOW + 3 * HOUR + 2 * REASK_AFTER_MS });
  // Three rounds is the ceiling.
  assert.equal(MAX_ROUNDS, 3);
  assert.ok(!dueIds(NOW + 100 * DAY).includes(l));

  // A question left unanswered is not repeated.
  const s2 = user(); const l2 = listing(s2); contactByCall(l2, NOW - 5 * DAY);
  runSaleCheckins({ at: NOW });
  assert.ok(!dueIds(NOW + 30 * DAY).includes(l2));
});

test('answering from the listing itself works without an open question', () => {
  const s = user(); const l = listing(s);
  const out = answerSaleCheckin(l, s, 'sold', { salePrice: 300000, at: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.rounds, 1);
  assert.equal(db.prepare('SELECT status FROM phone_listings WHERE id=?').get(l).status, 'sold');
});
