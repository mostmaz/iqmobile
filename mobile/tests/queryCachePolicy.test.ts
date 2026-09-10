// What may be written to disk.
//
// The cache survives a sign-out, so this list is a privacy boundary rather
// than a tuning knob: anything keyed to the signed-in user must stay in
// memory, or the next account to use the phone restores the previous one's
// inbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPersistQuery } from '../src/lib/queryCachePolicy.ts';

test('public browsing data is cached — this is the point of the feature', () => {
  for (const k of [['listings'], ['brands'], ['listing', 12], ['shops'], ['banners'],
    ['search-alternatives', {}], ['catalog', 'apple']]) {
    assert.equal(shouldPersistQuery(k), true, `${k[0]} should persist`);
  }
});

test('anything belonging to a signed-in user never reaches disk', () => {
  for (const k of [['me'], ['chat', 3], ['chats'], ['messages', 3], ['inbox'],
    ['notifications'], ['myListings'], ['saved'], ['orders'], ['requests-mine'],
    ['offers', 1], ['mine']]) {
    assert.equal(shouldPersistQuery(k), false, `${k[0]} must NOT persist`);
  }
});

test('a prefixed variant of a private key is still private', () => {
  // ['chats-unread'] is as much the user's as ['chats'] is; matching only on
  // exact equality would have let it through.
  assert.equal(shouldPersistQuery(['chats-unread']), false);
  assert.equal(shouldPersistQuery(['inbox-count']), false);
  assert.equal(shouldPersistQuery(['me/profile']), false);
});

test('a key that merely contains a private word is not caught by accident', () => {
  // 'minerals' starts with 'mine' as a substring but is a different key —
  // guard against the sloppy `startsWith` that would swallow it.
  assert.equal(shouldPersistQuery(['minerals']), true);
  assert.equal(shouldPersistQuery(['chatter']), true);
});

test('a missing or odd key does not throw', () => {
  assert.equal(shouldPersistQuery([] as any), true);
  assert.equal(shouldPersistQuery([undefined] as any), true);
});

test('the requests badge is per-user, however public its numbers look', () => {
  // A count of requests near you reads like public browsing data, but the
  // key carries the viewer's governorate and their own last-seen stamp —
  // restoring it under the next account on a shared phone badges their tab
  // with somebody else's city.
  assert.equal(shouldPersistQuery(['request-pulse', 'Baghdad', 123]), false);
  assert.equal(shouldPersistQuery(['requests-board', 'Baghdad']), true,
    'the BOARD is public — the same requests everyone sees');
});
