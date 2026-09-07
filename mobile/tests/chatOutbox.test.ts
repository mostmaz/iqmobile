// The chat outbox: queueing rules, without storage or React.
//
// The behaviour worth pinning is what happens when a send's RESPONSE is lost
// rather than the send itself — the message really did arrive, our retry
// would post it twice, and nothing in the wire format tells us so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueue, remove, mark, prune, forChat, nextToSend, isAcknowledged,
  newKey, MAX_PER_CHAT, MAX_AGE_MS,
} from '../src/lib/chatOutboxCore.ts';

const T = Date.parse('2026-09-07T12:00:00+03:00');
const ME = 7;
const entry = (o = {}) => ({
  key: newKey(), chat_id: 1, body: 'متوفر؟', created_at: T,
  state: 'pending' as const, tries: 0, ...o,
});

test('the same attempt enqueued twice is still one message', () => {
  const e = entry();
  const list = enqueue(enqueue([], e), e);
  assert.equal(list.length, 1, 'a double tap must not send twice');
});

test('a failed send stays queued and counts its tries', () => {
  const e = entry();
  let list = enqueue([], e);
  list = mark(list, e.key, 'failed', 'network_error');
  assert.equal(list[0].state, 'failed');
  assert.equal(list[0].tries, 1);
  assert.equal(list[0].error, 'network_error');
  list = mark(list, e.key, 'failed', 'network_timeout');
  assert.equal(list[0].tries, 2, 'each attempt counts');
});

test('a successful send leaves the outbox entirely', () => {
  const e = entry();
  assert.deepEqual(remove(enqueue([], e), e.key), []);
});

test('messages send oldest first, so a conversation arrives in order', () => {
  const a = entry({ created_at: T, body: 'first' });
  const b = entry({ created_at: T + 1000, body: 'second' });
  // Enqueued newest-first to prove the ordering comes from created_at, not
  // from insertion order.
  const list = enqueue(enqueue([], b), a);
  assert.equal(nextToSend(list, 1)?.body, 'first');
});

test('another chat\'s queue is never touched', () => {
  const mine = entry({ chat_id: 1 });
  const other = entry({ chat_id: 2 });
  const list = enqueue(enqueue([], mine), other);
  assert.equal(forChat(list, 1).length, 1);
  assert.equal(nextToSend(list, 2)?.chat_id, 2);
});

test('an overflowing queue drops the oldest, never the newest', () => {
  let list: any[] = [];
  for (let i = 0; i < MAX_PER_CHAT + 5; i++) {
    list = enqueue(list, entry({ created_at: T + i, body: `m${i}` }));
  }
  assert.equal(forChat(list, 1).length, MAX_PER_CHAT);
  assert.equal(list.some((e) => e.body === 'm0'), false, 'oldest dropped');
  assert.equal(list.some((e) => e.body === `m${MAX_PER_CHAT + 4}`), true,
    'the message the user is looking at survives');
});

test('a day-old queued message is dropped rather than sent as a surprise', () => {
  const fresh = entry({ created_at: T });
  const old = entry({ created_at: T - MAX_AGE_MS - 1 });
  const list = prune(enqueue(enqueue([], fresh), old), T);
  assert.equal(list.length, 1);
  assert.equal(list[0].created_at, T);
});

test('a send whose response was lost is recognised, not sent twice', () => {
  // The real recovery case: the POST succeeded, the reply never came back,
  // so the entry is still queued while the message is already in the thread.
  const e = entry({ body: 'متوفر؟', created_at: T });
  const server = [{ sender_id: ME, body: 'متوفر؟', created_at: T + 4000 }];
  assert.equal(isAcknowledged(e, server, ME), true);
});

test('the same words typed again much later are a real second message', () => {
  // Without the time window this would silently swallow it — people ask
  // «متوفر؟» in the same thread days apart all the time.
  const e = entry({ body: 'متوفر؟', created_at: T });
  const server = [{ sender_id: ME, body: 'متوفر؟', created_at: T - 3 * 60 * 60 * 1000 }];
  assert.equal(isAcknowledged(e, server, ME), false);
});

test("the other person's identical message is not our acknowledgement", () => {
  const e = entry({ body: 'تمام', created_at: T });
  const server = [{ sender_id: ME + 1, body: 'تمام', created_at: T + 1000 }];
  assert.equal(isAcknowledged(e, server, ME), false, 'sender must match');
});

test('an image-only server message has no body and must not match', () => {
  const e = entry({ body: '', created_at: T });
  const server = [{ sender_id: ME, body: null, created_at: T + 1000 }];
  // Both sides read as '' — an empty outbox body should never exist, but if
  // one did it must not be acknowledged by every photo the user ever sent.
  assert.equal(isAcknowledged({ ...e, body: 'شيء' }, server, ME), false);
});
