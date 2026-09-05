import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { growthAnalytics, growthDay } from '../src/growthAnalytics.js';
const ts = day => Date.parse(`${day}T12:00:00+03:00`);
function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, is_guest INTEGER, registered_at INTEGER, guest_created_at INTEGER);
    CREATE TABLE analytics_metadata(key TEXT PRIMARY KEY, value INTEGER);
    CREATE TABLE user_active_days(user_id INTEGER, day TEXT, PRIMARY KEY(user_id,day));
    CREATE TABLE events(type TEXT,user_id INTEGER,listing_id INTEGER,created_at INTEGER);
    CREATE TABLE chats(id INTEGER,buyer_id INTEGER,seller_id INTEGER);
    CREATE TABLE chat_messages(chat_id INTEGER,sender_id INTEGER,created_at INTEGER);`);
  db.prepare('INSERT INTO analytics_metadata VALUES(?,?)').run('registration_tracking_start', ts('2026-08-01'));
  return db;
}
test('separates guest creation from later registration, excludes unknown/imported dates', () => {
  const db = fixture();
  db.prepare('INSERT INTO users VALUES(1,0,?,?)').run(ts('2026-09-05'), ts('2026-08-02'));
  db.exec('INSERT INTO users VALUES(2,0,NULL,NULL)');
  const result = growthAnalytics(db, ts('2026-09-06'), 7);
  assert.deepEqual(result.acquisition, { registrations: 1, guests: 0 });
  assert.deepEqual(result.registrations_by_day, [{ day: '2026-09-05', registrations: 1 }]);
  db.close();
});
test('retention excludes incomplete target days and uses exact-day return; empty is null', () => {
  const db = fixture();
  const insert = db.prepare('INSERT INTO users VALUES(?,0,?,NULL)');
  insert.run(1,ts('2026-09-04')); insert.run(2,ts('2026-09-05')); insert.run(3,ts('2026-09-03'));
  db.exec("INSERT INTO user_active_days VALUES(1,'2026-09-05'),(2,'2026-09-06'),(3,'2026-09-05')");
  const result = growthAnalytics(db, ts('2026-09-06'), 90);
  assert.deepEqual(result.retention[0], { day: 1, eligible: 2, returned: 1, pct: 50 });
  assert.deepEqual(result.retention[1], { day: 7, eligible: 0, returned: 0, pct: null });
  db.close();
});
test('D7 and D30 mature cohorts count returns independently', () => {
  const db = fixture();
  db.prepare('INSERT INTO users VALUES(1,0,?,NULL)').run(ts('2026-08-02'));
  db.exec("INSERT INTO user_active_days VALUES(1,'2026-08-09'),(1,'2026-09-01')");
  const result = growthAnalytics(db, ts('2026-09-06'), 90);
  assert.equal(result.retention[1].pct,100); assert.equal(result.retention[2].pct,100);
  db.close();
});
test('contacts deduplicate channels, count buyer messages, exclude empty chats and seller replies', () => {
  const db = fixture(); const time=ts('2026-09-05');
  db.exec('INSERT INTO chats VALUES(1,1,9),(2,2,9),(3,3,9)');
  const event=db.prepare('INSERT INTO events VALUES(?,?,?,?)');
  event.run('contact_call',1,4,time); event.run('contact_whatsapp',1,4,time);
  event.run('contact_call',null,4,time); event.run('view',5,4,time);
  const msg=db.prepare('INSERT INTO chat_messages VALUES(?,?,?)');
  msg.run(1,1,time); msg.run(1,9,time); msg.run(2,2,time);
  assert.equal(growthAnalytics(db,ts('2026-09-06'),7).contact_buyers,2);
  db.close();
});
test('returning accounts require prior observed activity; guests and registered split', () => {
  const db=fixture();
  db.exec("INSERT INTO users VALUES(1,1,NULL,NULL),(2,0,NULL,NULL); INSERT INTO user_active_days VALUES(1,'2026-09-05'),(1,'2026-09-06'),(2,'2026-09-06')");
  assert.deepEqual(growthAnalytics(db,ts('2026-09-06')).active_today,{total:2,guests:1,registered:1,returning:1});
  assert.equal(growthDay(Date.parse('2026-09-05T21:00:00Z')),'2026-09-06');
  assert.equal(growthDay(Date.parse('2026-09-05T20:59:59Z')),'2026-09-05');
  db.close();
});
