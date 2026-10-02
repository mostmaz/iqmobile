// The batching incident of 2 Oct 2026, replayed through the real sweep.
//
// One buyer asked one seller about three phones within an hour. The first
// reminder said «٣ محادثات» — and recorded only the first chat, so the next
// two sweeps found the second and third still owed and sent two more. This
// file pins the three rules that stop it: every chat a message names is
// recorded with it, one person hears from us at most once a day, and a
// number WhatsApp does not know is not tried again for a month.
//
// Dry-run transport: the selection and the ledger are real, nothing is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-nudge-batch-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';
process.env.WHATSAPP_PROVIDER = 'cloud';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-number';
process.env.WHATSAPP_TOKEN = 'test-token';

const { db, setSettingValue } = await import('../src/db.js');
const { runChatNudges, pendingNudges, noteNudgeOpened } = await import('../src/chatNudge.js');

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-02T14:30:00+03:00');
setSettingValue('chat_nudge_enabled', '1');
setSettingValue('chat_nudge_dry_run', '1');
setSettingValue('chat_nudge_only_no_push', '0');

let uid = 500, lid = 0, cid = 0, mid = 0;
function user() {
  const id = ++uid;
  db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
              VALUES(?,?,'x','مستخدم','Baghdad','individual',?)`).run(id, `0770100${String(id).padStart(4, '0')}`, NOW - 90 * DAY);
  db.prepare(`INSERT INTO user_active_days(user_id, day, requests, first_seen, last_seen, platform, app_version)
              VALUES(?, '2026-09-01', 1, ?, ?, 'android', '0.5.2')`).run(id, NOW - 30 * DAY, NOW - 30 * DAY);
  return id;
}
/** The buyer asks the seller about a new phone, `at`. */
function ask(buyer, seller, at) {
  const l = ++lid, c = ++cid;
  db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price,
      governorate, status, is_draft, created_at, updated_at, expires_at)
    VALUES(?,?,'Apple','iPhone 13','used',500000,'Baghdad','active',0,?,?,?)`).run(l, seller, NOW - 10 * DAY, NOW, NOW + 10 * DAY);
  db.prepare(`INSERT INTO chats(id, listing_id, buyer_id, seller_id, created_at, last_message_at)
              VALUES(?,?,?,?,?,?)`).run(c, l, buyer, seller, at - MIN, at);
  db.prepare('INSERT INTO chat_messages(id, chat_id, sender_id, body, masked, created_at) VALUES(?,?,?,?,0,?)')
    .run(++mid, c, buyer, 'متوفر؟', at);
  return c;
}
const messagesTo = (u) => db.prepare("SELECT COUNT(*) AS n FROM chat_nudges WHERE user_id=? AND outcome IN ('sent','dry_run')").get(u).n;
const rows = (u) => db.prepare('SELECT chat_id, outcome, batch_id FROM chat_nudges WHERE user_id=? ORDER BY id').all(u);
/** Sweeps every 15 minutes from `from` for `count` runs, as the expirer does. */
async function sweeps(from, count) { for (let i = 0; i < count; i++) await runChatNudges({ at: from + i * 15 * MIN }); }

test('three questions an hour apart: one WhatsApp, not three', async () => {
  const b = user(), s = user();
  ask(b, s, NOW - 2 * HOUR - 5 * MIN);   // due now
  ask(b, s, NOW - 2 * HOUR + 10 * MIN);  // due in 10 minutes
  ask(b, s, NOW - 2 * HOUR + 45 * MIN);  // due in 45 minutes
  await sweeps(NOW, 8);                  // two hours of sweeps
  assert.equal(messagesTo(s), 1);
});

test('chats that are due together are all recorded with the one message', async () => {
  const b = user(), s = user();
  const c1 = ask(b, s, NOW - 5 * HOUR), c2 = ask(b, s, NOW - 4 * HOUR), c3 = ask(b, s, NOW - 3 * HOUR);
  await runChatNudges({ at: NOW });
  const r = rows(s);
  assert.equal(r.filter((x) => x.outcome === 'dry_run').length, 1);
  assert.deepEqual(r.filter((x) => x.outcome === 'batched').map((x) => x.chat_id).sort(), [c1, c2].sort());
  const main = db.prepare("SELECT id, chat_id FROM chat_nudges WHERE user_id=? AND outcome='dry_run'").get(s);
  assert.equal(main.chat_id, c3, 'the freshest chat carries the message');
  assert.ok(r.filter((x) => x.outcome === 'batched').every((x) => x.batch_id === main.id));
  // A week later none of the three is owed anything.
  assert.equal(pendingNudges(db, NOW + 2 * DAY, { limit: 50, onlyNoPush: false }).filter((n) => n.user_id === s).length, 0);
});

test('one person hears from us at most once a day; the next day is a new day', async () => {
  const b = user(), s = user();
  ask(b, s, NOW - 3 * HOUR);
  await runChatNudges({ at: NOW });
  ask(b, s, NOW + HOUR);                 // a new question, due at NOW+3h
  await sweeps(NOW + 3 * HOUR, 8);
  assert.equal(messagesTo(s), 1, 'still inside the 24 hours');
  ask(b, s, NOW + DAY + HOUR);           // the next day
  await runChatNudges({ at: NOW + DAY + 3 * HOUR });
  assert.equal(messagesTo(s), 2);
});

test('a number WhatsApp does not know is not tried again for a month', async () => {
  const b = user(), s = user();
  const first = ask(b, s, NOW - 10 * DAY);
  db.prepare("INSERT INTO chat_nudges(chat_id, listing_id, user_id, phone, outcome, created_at) VALUES(?,?,?,?,'not_on_whatsapp',?)")
    .run(first, lid, s, '0770', NOW - 2 * DAY);
  ask(b, s, NOW - 3 * HOUR);
  assert.equal(pendingNudges(db, NOW, { limit: 50, onlyNoPush: false }).filter((n) => n.user_id === s).length, 0);
  ask(b, s, NOW + 29 * DAY);
  assert.equal(pendingNudges(db, NOW + 29 * DAY + 3 * HOUR, { limit: 50, onlyNoPush: false }).filter((n) => n.user_id === s).length, 1);
});

test('opening any chat the message named counts as opening the reminder', async () => {
  const b = user(), s = user();
  const older = ask(b, s, NOW - 5 * HOUR);
  ask(b, s, NOW - 3 * HOUR);
  await runChatNudges({ at: NOW });
  // Opens are only counted on messages that really went out; promote this
  // dry run to what a live send writes.
  db.prepare("UPDATE chat_nudges SET outcome='sent' WHERE user_id=? AND outcome='dry_run'").run(s);
  noteNudgeOpened(older, s, NOW + HOUR);
  const main = db.prepare("SELECT opened_at FROM chat_nudges WHERE user_id=? AND outcome='sent'").get(s);
  assert.equal(main.opened_at, NOW + HOUR);
});

test.after(() => db.close());
