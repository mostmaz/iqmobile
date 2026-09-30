// Who gets the 24-hour WhatsApp, and — mostly — who does not.
//
// The stakes are asymmetric: a missed nudge costs one sale, a wrong nudge
// costs money and lands in a stranger's WhatsApp, which is how a utility
// template gets reported and revoked. So almost every test here pins an
// exclusion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

// DB_PATH before the import — db.js opens the file at module load.
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-nudge-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const {
  pendingNudges, withinSendingHours, NUDGE_AFTER_MS, NUDGE_MAX_AGE_MS,
} = await import('../src/chatNudge.js');

const HOUR = 3600000, DAY = 86400000;
// A fixed clock at 12:00 Baghdad, so no test depends on when it is run —
// the quiet-hours rule would otherwise make the suite pass by day and fail
// at night, which this repo has shipped once already.
const NOW = Date.parse('2026-09-30T12:00:00+03:00');

let uid = 0, lid = 0, cid = 0, mid = 0;
// users.phone is NOT NULL, so "no phone" can only mean the empty string —
// which is what an admin-created or imported row can carry.
function user(phone = true) {
  const id = ++uid + 100;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
              VALUES(?,?,'x','مستخدم','Baghdad','individual',?)`)
    .run(id, phone ? `0770000${String(id).padStart(4, '0')}` : '', NOW);
  return id;
}
function listing(sellerId) {
  const id = ++lid;
  db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price,
      governorate, status, is_draft, created_at, updated_at, expires_at)
    VALUES(?,?,'Apple','iPhone 13','used',500000,'Baghdad','active',0,?,?,?)`)
    .run(id, sellerId, NOW - 10 * DAY, NOW, NOW + DAY);
  return id;
}
/** A chat whose last message is from `from`, `ageMs` ago, unread by the other side. */
function chat({ buyer, seller, from, ageMs, sellerRead = 0, buyerRead = 0, closed = null }) {
  const id = ++cid;
  const lst = listing(seller);
  const at = NOW - ageMs;
  db.prepare(`INSERT INTO chats(id, listing_id, buyer_id, seller_id, created_at, last_message_at,
                                buyer_last_read_at, seller_last_read_at, closed_at)
              VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id, lst, buyer, seller, at - HOUR, at, buyerRead || null, sellerRead || null, closed);
  db.prepare('INSERT INTO chat_messages(id, chat_id, sender_id, body, masked, created_at) VALUES(?,?,?,?,0,?)')
    .run(++mid, id, from, 'السعر اخر؟', at);
  return id;
}

const buyer = user();
const seller = user();

// ── the window ─────────────────────────────────────────────────────────

test('a message that landed an hour ago is not chased yet', () => {
  chat({ buyer, seller, from: buyer, ageMs: HOUR });
  assert.equal(pendingNudges(db, NOW).length, 0);
});

test('a day-old unanswered message is', () => {
  const c = chat({ buyer, seller, from: buyer, ageMs: NUDGE_AFTER_MS + HOUR });
  const due = pendingNudges(db, NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0].chat_id, c);
  assert.equal(due[0].user_id, seller);
  assert.equal(due[0].device, 'Apple iPhone 13');
});

test('a week-old one is left alone — the buyer has moved on', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats;');
  chat({ buyer, seller, from: buyer, ageMs: NUDGE_MAX_AGE_MS + DAY });
  assert.equal(pendingNudges(db, NOW).length, 0);
});

// ── the exclusions ─────────────────────────────────────────────────────

test('a seller who already opened the thread is not chased', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats;');
  chat({ buyer, seller, from: buyer, ageMs: 30 * HOUR, sellerRead: NOW - 2 * HOUR });
  assert.equal(pendingNudges(db, NOW).length, 0);
});

test('the nudge follows the unread message, whichever side it is on', () => {
  // The rule is "you were written to and never opened it", not "you are a
  // seller". A buyer who asked a price, got an answer and never came back is
  // exactly as stuck, and the template says «رسالة» rather than «من مشتري»
  // precisely so it can be sent in both directions.
  db.exec('DELETE FROM chat_messages; DELETE FROM chats;');
  chat({ buyer, seller, from: seller, ageMs: 30 * HOUR });
  const due = pendingNudges(db, NOW);
  assert.equal(due.length, 1);
  assert.equal(due[0].user_id, buyer);
});

test('a chat where the reply IS read is not chased', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats;');
  chat({ buyer, seller, from: seller, ageMs: 30 * HOUR, buyerRead: NOW - 2 * HOUR });
  assert.equal(pendingNudges(db, NOW).length, 0);
});

test('a closed chat is not chased', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats;');
  chat({ buyer, seller, from: buyer, ageMs: 30 * HOUR, closed: NOW - HOUR });
  assert.equal(pendingNudges(db, NOW).length, 0);
});

test('a user with no phone is skipped rather than crashing the sweep', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats;');
  const mute = user(false);
  chat({ buyer, seller: mute, from: buyer, ageMs: 30 * HOUR });
  assert.equal(pendingNudges(db, NOW).length, 0);
});

// ── the two caps ───────────────────────────────────────────────────────

test('a chat already nudged is never nudged again', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  const c = chat({ buyer, seller, from: buyer, ageMs: 30 * HOUR });
  assert.equal(pendingNudges(db, NOW).length, 1);
  db.prepare('INSERT INTO chat_nudges(chat_id, user_id, phone, outcome, created_at) VALUES(?,?,?,?,?)')
    .run(c, seller, '07700000001', 'sent', NOW - HOUR);
  assert.equal(pendingNudges(db, NOW).length, 0);
});

test('the ledger makes a second row for one chat impossible, not merely unlikely', () => {
  db.exec('DELETE FROM chat_nudges;');
  const c = chat({ buyer, seller, from: buyer, ageMs: 31 * HOUR });
  const ins = db.prepare('INSERT INTO chat_nudges(chat_id, user_id, phone, outcome, created_at) VALUES(?,?,?,?,?)');
  ins.run(c, seller, '0770', 'sent', NOW);
  assert.throws(() => ins.run(c, seller, '0770', 'sent', NOW), /UNIQUE|PRIMARY/i);
});

test('a shop with three stale chats gets ONE message that names all three', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  const b2 = user(), b3 = user();
  chat({ buyer, seller, from: buyer, ageMs: 30 * HOUR });
  chat({ buyer: b2, seller, from: b2, ageMs: 29 * HOUR });
  chat({ buyer: b3, seller, from: b3, ageMs: 28 * HOUR });

  const due = pendingNudges(db, NOW);
  assert.equal(due.length, 1, 'one message, not three');
  assert.equal(due[0].waiting, 3);
});

test('two different sellers each get their own', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  const s2 = user();
  chat({ buyer, seller, from: buyer, ageMs: 30 * HOUR });
  chat({ buyer, seller: s2, from: buyer, ageMs: 30 * HOUR });
  // Explicit limit: the sweep's own default is 1 (pacing, not selection).
  assert.equal(pendingNudges(db, NOW, { limit: 10 }).length, 2);
});

// ── the clock ──────────────────────────────────────────────────────────

test('nothing goes out at 3am Baghdad', () => {
  assert.equal(withinSendingHours(Date.parse('2026-09-30T03:00:00+03:00')), false);
  assert.equal(withinSendingHours(Date.parse('2026-09-30T22:30:00+03:00')), false);
  assert.equal(withinSendingHours(Date.parse('2026-09-30T09:00:00+03:00')), true);
  assert.equal(withinSendingHours(Date.parse('2026-09-30T20:59:00+03:00')), true);
});

test('the window is read in Baghdad time, not the server\'s', () => {
  // 21:30 Baghdad is 18:30 UTC. A naive getHours() on a UTC server would
  // call that 18:30 and send.
  assert.equal(withinSendingHours(Date.parse('2026-09-30T18:30:00Z')), false);
});

// ── the Cloud API request ──────────────────────────────────────────────

const { buildCloudBody } = await import('../src/whatsappTemplate.js');

test('the Cloud API body matches what Meta expects for a template', () => {
  const b = buildCloudBody('+9647701234567', ['موبايلات النخبة', 'Apple iPhone 13']);
  assert.equal(b.messaging_product, 'whatsapp');
  // Bare digits: Meta's own examples drop the '+', and a leading one has
  // been reported to fail on some numbers.
  assert.equal(b.to, '9647701234567');
  assert.equal(b.type, 'template');
  assert.equal(b.template.language.code, 'ar');
  assert.deepEqual(b.template.components, [{
    type: 'body',
    parameters: [
      { type: 'text', text: 'موبايلات النخبة' },
      { type: 'text', text: 'Apple iPhone 13' },
    ],
  }]);
});

test('parameter count is exactly two — Meta silently delivers nothing on a mismatch', () => {
  // The registered template has {{1}} and {{2}}. If chatNudge ever passes a
  // third, this is the test that says so rather than a month of no messages.
  const b = buildCloudBody('+9647701234567', ['a', 'b']);
  assert.equal(b.template.components[0].parameters.length, 2);
});

test('an unconfigured transport refuses instead of pretending', async () => {
  const { sendUtilityTemplate } = await import('../src/whatsappTemplate.js');
  // No WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN in the test env.
  const r = await sendUtilityTemplate('07701234567', ['a', 'b'], { dryRun: false });
  assert.equal(r.ok, false);
  assert.equal(r.outcome, 'unconfigured');
});

// ── pacing ─────────────────────────────────────────────────────────────

const { sentInLast24h, DAILY_CAP, PER_RUN_LIMIT } = await import('../src/chatNudge.js');

test('the sweep sends one at a time by default', () => {
  assert.equal(PER_RUN_LIMIT, 1);
});

test('the rolling 24h count ignores failures and forgets yesterday', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  // Real chats: chat_nudges.chat_id is a foreign key, which is the point —
  // the ledger cannot outlive the conversation it is about.
  const c1 = chat({ buyer, seller, from: buyer, ageMs: 30 * HOUR });
  const c2 = chat({ buyer, seller, from: buyer, ageMs: 31 * HOUR });
  const c3 = chat({ buyer, seller, from: buyer, ageMs: 32 * HOUR });
  const c4 = chat({ buyer, seller, from: buyer, ageMs: 33 * HOUR });
  const ins = db.prepare('INSERT INTO chat_nudges(chat_id, user_id, phone, outcome, created_at) VALUES(?,?,?,?,?)');
  ins.run(c1, buyer, '0770', 'sent', NOW - HOUR);
  ins.run(c2, buyer, '0770', 'dry_run', NOW - 2 * HOUR);
  // A rejected attempt burned no conversation, so it must not count toward
  // the tier limit — otherwise a bad token could starve the real budget.
  ins.run(c3, buyer, '0770', 'rejected', NOW - 3 * HOUR);
  // 25 hours ago is outside the rolling window Meta measures.
  ins.run(c4, buyer, '0770', 'sent', NOW - 25 * HOUR);

  assert.equal(sentInLast24h(db, NOW), 2);
  assert.ok(DAILY_CAP <= 250, 'must stay under a new WABA\'s 250/24h opening tier');
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
});
