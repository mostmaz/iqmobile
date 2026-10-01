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
function chat({
  buyer, seller, from, ageMs, sellerRead = 0, buyerRead = 0, closed = null,
  body = 'السعر اخر؟', openedBeforeMs = HOUR, empty = false,
}) {
  const id = ++cid;
  const lst = listing(seller);
  const at = NOW - ageMs;
  db.prepare(`INSERT INTO chats(id, listing_id, buyer_id, seller_id, created_at, last_message_at,
                                buyer_last_read_at, seller_last_read_at, closed_at)
              VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id, lst, buyer, seller, at - openedBeforeMs, at, buyerRead || null, sellerRead || null, closed);
  if (!empty) {
    db.prepare('INSERT INTO chat_messages(id, chat_id, sender_id, body, masked, created_at) VALUES(?,?,?,?,0,?)')
      .run(++mid, id, from, body, at);
  }
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

test('a three-day-old one is still chased — the window runs to a week', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats;');
  chat({ buyer, seller, from: buyer, ageMs: 3 * DAY });
  assert.equal(pendingNudges(db, NOW).length, 1);
});

test('one older than the window is left alone — the buyer has moved on', () => {
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

const nudged = db.prepare(
  'INSERT INTO chat_nudges(chat_id, listing_id, user_id, phone, outcome, created_at) VALUES(?,?,?,?,?,?)',
);
const listingOf = (chatId) => db.prepare('SELECT listing_id AS l FROM chats WHERE id=?').get(chatId).l;

test('a listing already nudged is never nudged again', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  const c = chat({ buyer, seller, from: buyer, ageMs: 30 * HOUR });
  assert.equal(pendingNudges(db, NOW).length, 1);
  nudged.run(c, listingOf(c), seller, '07700000001', 'sent', NOW - HOUR);
  assert.equal(pendingNudges(db, NOW).length, 0);
});

test('a SECOND buyer on the same listing earns no second message', () => {
  // The bug this pins: chats are UNIQUE(listing_id, buyer_id), so two buyers
  // asking about one phone are two chats. Keyed on the chat, that seller
  // would have been written to twice about the same device.
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  const lst = listing(seller);
  const mkChat = (b, ageMs) => {
    const id = ++cid + 500;
    const at = NOW - ageMs;
    db.prepare(`INSERT INTO chats(id, listing_id, buyer_id, seller_id, created_at, last_message_at)
                VALUES(?,?,?,?,?,?)`).run(id, lst, b, seller, at - HOUR, at);
    db.prepare('INSERT INTO chat_messages(id, chat_id, sender_id, body, masked, created_at) VALUES(?,?,?,?,0,?)')
      .run(++mid, id, b, 'موجود؟', at);
    return id;
  };
  const b2 = user();
  const first = mkChat(buyer, 30 * HOUR);
  mkChat(b2, 29 * HOUR);

  const due = pendingNudges(db, NOW, { limit: 10 });
  assert.equal(due.length, 1, 'one message for one listing');
  assert.equal(due[0].waiting, 2, 'and it says two are waiting');

  nudged.run(first, lst, seller, '0770', 'sent', NOW);
  assert.equal(pendingNudges(db, NOW, { limit: 10 }).length, 0, 'the other chat is covered too');
});

test('the ledger makes a second message for one listing impossible, not merely unlikely', () => {
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  const c1 = chat({ buyer, seller, from: buyer, ageMs: 31 * HOUR });
  const l = listingOf(c1);
  nudged.run(c1, l, seller, '0770', 'sent', NOW);
  // A different chat row, same person, same listing — the unique index is
  // the rule, not the chat_id primary key.
  const c2 = chat({ buyer, seller, from: buyer, ageMs: 32 * HOUR });
  assert.throws(() => nudged.run(c2, l, seller, '0770', 'sent', NOW), /UNIQUE/i);
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

const { buildCloudBody } = await import('../src/whatsapp.js');

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
  const { sendWhatsApp } = await import('../src/whatsapp.js');
  // No linked bot session and no cloud credentials in the test env.
  const r = await sendWhatsApp('07701234567', { name: 'a', device: 'b' }, { dryRun: false });
  assert.equal(r.ok, false);
  assert.equal(r.outcome, 'unconfigured');
});

test('the bot text names the device and, when there are several, the count', async () => {
  const { botText } = await import('../src/whatsapp.js');
  const one = botText({ name: 'أبو علي', device: 'iPhone 13', waiting: 1, userId: 7 });
  assert.match(one, /أبو علي/);
  assert.match(one, /iPhone 13/);
  assert.doesNotMatch(one, /محادث/);

  const many = botText({ name: 'أبو علي', device: 'iPhone 13', waiting: 3, userId: 7 });
  assert.match(many, /محادثات/);
});

test('the count is written the way Arabic counts, in Arabic-Indic digits', async () => {
  const { waitingPhrase } = await import('../src/whatsapp.js');
  assert.equal(waitingPhrase(1), '', 'one conversation is the default case, not a count');
  assert.match(waitingPhrase(2), /محادثتين/, 'two is a dual word, not "2 محادثات"');
  assert.match(waitingPhrase(5), /٥ محادثات/);
  assert.match(waitingPhrase(14), /١٤ محادثة/, 'eleven and up take the singular');
  // The rest of the message says «٢٤ ساعة»; a Western 5 beside it is the
  // kind of seam a reader notices instantly.
  assert.doesNotMatch(waitingPhrase(5), /[0-9]/);
});

test('the same person always gets the same wording — a resend must not look careless', async () => {
  const { botText } = await import('../src/whatsapp.js');
  const a = botText({ name: 'س', device: 'x', userId: 42 });
  const b = botText({ name: 'س', device: 'x', userId: 42 });
  assert.equal(a, b);
});

test('the corpus is actually varied — every combination is reachable', async () => {
  const { botText } = await import('../src/whatsapp.js');
  // The bug this pins: plain FNV-1a barely mixes its low bits, and `% 4`
  // reads exactly those. Ids 1–8 produced FOUR messages on a period of four,
  // with all three lists advancing in lockstep — a thousand near-identical
  // messages from one number, which is the signal this whole design exists
  // to avoid.
  const seen = new Set();
  for (let id = 1; id <= 400; id++) seen.add(botText({ name: 'س', device: 'x', userId: id }));
  assert.equal(seen.size, 64, `expected all 4×4×4 combinations, got ${seen.size}`);

  // And the distribution is not PERIODIC, which is the shape the bug had:
  // every id matched id+4 exactly. Demanding that no two of a handful of ids
  // ever collide would be wrong — eight draws from sixty-four collide about
  // a third of the time by birthday — so count the period-4 matches instead.
  // Broken: 100. Healthy: one or two.
  let periodic = 0;
  for (let id = 1; id <= 100; id++) {
    if (botText({ name: 'س', device: 'x', userId: id }) === botText({ name: 'س', device: 'x', userId: id + 4 })) periodic += 1;
  }
  assert.ok(periodic < 10, `${periodic}/100 ids repeat at period 4 — the hash is not mixing`);
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
  const ins = db.prepare('INSERT INTO chat_nudges(chat_id, listing_id, user_id, phone, outcome, created_at) VALUES(?,?,?,?,?,?)');
  ins.run(c1, listingOf(c1), buyer, '0770', 'sent', NOW - HOUR);
  ins.run(c2, listingOf(c2), buyer, '0770', 'dry_run', NOW - 2 * HOUR);
  // A rejected attempt burned no conversation, so it must not count toward
  // the tier limit — otherwise a bad token could starve the real budget.
  ins.run(c3, listingOf(c3), buyer, '0770', 'rejected', NOW - 3 * HOUR);
  // 25 hours ago is outside the rolling window Meta measures.
  ins.run(c4, listingOf(c4), buyer, '0770', 'sent', NOW - 25 * HOUR);

  assert.equal(sentInLast24h(db, NOW), 2);
  assert.ok(DAILY_CAP <= 250, 'must stay under a new WABA\'s 250/24h opening tier');
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
});

test('the freshest unanswered chat is first in the queue, not the oldest', () => {
  // With one message a quarter hour and a sliding seven-day ceiling,
  // oldest-first spent the whole day on leads that had gone cold and made the
  // "next" name change every few minutes as messages aged out of the window.
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  const s2 = user(), s3 = user();
  chat({ buyer, seller, from: buyer, ageMs: 6 * DAY });
  const fresh = chat({ buyer, seller: s2, from: buyer, ageMs: 25 * HOUR });
  chat({ buyer, seller: s3, from: buyer, ageMs: 3 * DAY });
  const due = pendingNudges(db, NOW, { limit: 10 });
  assert.equal(due[0].chat_id, fresh);
  assert.equal(due.length, 3);
});

test('by default only people with NO push token are written to', () => {
  // A person with a token was told the moment the message arrived. Writing
  // to them again on WhatsApp is a second nag, and it spends the ban risk on
  // the one group that never needed the fallback.
  db.exec('DELETE FROM chat_messages; DELETE FROM chats; DELETE FROM chat_nudges;');
  const withToken = user();
  db.prepare("UPDATE users SET expo_push_token='ExponentPushToken[x]' WHERE id=?").run(withToken);
  chat({ buyer, seller: withToken, from: buyer, ageMs: 30 * HOUR });
  chat({ buyer, seller, from: buyer, ageMs: 30 * HOUR });   // `seller` has no token

  const due = pendingNudges(db, NOW, { limit: 10 });
  assert.equal(due.length, 1);
  assert.equal(due[0].user_id, seller);
  assert.equal(due[0].has_push_token, false);

  // The switch widens it to everyone.
  assert.equal(pendingNudges(db, NOW, { limit: 10, onlyNoPush: false }).length, 2);
});

// ── threads that were never a contact ─────────────────────────────────
// Fresh people per test: the suite shares one database, and everything
// above left due threads behind. `dueFor` reads the whole queue and keeps
// one seller's rows.
const dueFor = (sellerId) => pendingNudges(db, NOW, { limit: 500 }).filter((n) => n.user_id === sellerId);

test('a thread the buyer opened and never wrote in is not chased', () => {
  const b = user(), s = user();
  chat({ buyer: b, seller: s, from: b, ageMs: 2 * DAY, empty: true });
  assert.deepEqual(dueFor(s), []);
});

test('a quick-reply chip is a question even when tapped two seconds in', () => {
  const b = user(), s = user();
  const c = chat({ buyer: b, seller: s, from: b, ageMs: 2 * DAY, body: 'هل المنتج متوفر؟', openedBeforeMs: 2000 });
  assert.deepEqual(dueFor(s).map((n) => n.chat_id), [c]);
});

test('a fast chip followed by a typed message is a conversation', () => {
  const b = user(), s = user();
  const c = chat({ buyer: b, seller: s, from: b, ageMs: 2 * DAY, body: 'هل المنتج متوفر؟', openedBeforeMs: 1500 });
  db.prepare('INSERT INTO chat_messages(id, chat_id, sender_id, body, masked, created_at) VALUES(?,?,?,?,0,?)')
    .run(++mid, c, b, 'اقصد نسخة 256', NOW - 2 * DAY + 60_000);
  assert.deepEqual(dueFor(s).map((n) => n.chat_id), [c]);
});

// ── who is being chased, and what they are told ───────────────────────

test('the seller is chased when the buyer wrote last, the buyer when the seller did', () => {
  const b = user(), s = user();
  const c1 = chat({ buyer: b, seller: s, from: b, ageMs: 2 * DAY });
  assert.deepEqual(dueFor(s).map((n) => [n.chat_id, n.role]), [[c1, 'seller']]);
  const b2 = user(), s2 = user();
  const c2 = chat({ buyer: b2, seller: s2, from: s2, ageMs: 2 * DAY, body: 'نعم متوفر' });
  assert.deepEqual(dueFor(b2).map((n) => [n.chat_id, n.role]), [[c2, 'buyer']]);
});

test('a guest buyer has no phone to write to and is skipped', () => {
  const s = user();
  const g = user();
  db.prepare("UPDATE users SET is_guest=1, phone='guest:abc123' WHERE id=?").run(g);
  chat({ buyer: g, seller: s, from: s, ageMs: 2 * DAY, body: 'نعم متوفر' });
  assert.deepEqual(dueFor(g), []);
});

test('the buyer reads a message written to a buyer', async () => {
  const { botText } = await import('../src/whatsapp.js');
  const seller = botText({ name: 'أبو علي', device: 'iPhone 13', userId: 7, role: 'seller' });
  const buyer = botText({ name: 'أبو علي', device: 'iPhone 13', userId: 7, role: 'buyer' });
  assert.notEqual(seller, buyer);
  assert.match(buyer, /iPhone 13/);
  // The seller's copy talks about a customer waiting; the buyer's about a reply.
  assert.doesNotMatch(buyer, /الزبون|يشتري من غيره|يسأل عن/);
  assert.match(buyer, /رد|جاوبك/);
  // Still one stable wording per person.
  assert.equal(buyer, botText({ name: 'أبو علي', device: 'iPhone 13', userId: 7, role: 'buyer' }));
});
