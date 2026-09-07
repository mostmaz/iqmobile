import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordView, forget, sanitize, railItems, RECENT_MAX, RECENT_MIN_TO_SHOW,
} from '../src/lib/recentlyViewedCore.ts';

const e = (id: number, at = id) => ({ id, brand: 'Apple', model: `m${id}`, at });

test('most recent first', () => {
  const l = recordView(recordView([], e(1)), e(2));
  assert.deepEqual(l.map((x) => x.id), [2, 1]);
});

test('re-opening moves a device, it does not duplicate it', () => {
  // Without this a rail of twelve is four devices repeated.
  let l = recordView(recordView(recordView([], e(1)), e(2)), e(3));
  l = recordView(l, e(1));
  assert.deepEqual(l.map((x) => x.id), [1, 3, 2]);
});

test('the list stays short — this is a prompt, not an archive', () => {
  let l: any[] = [];
  for (let i = 1; i <= RECENT_MAX + 6; i++) l = recordView(l, e(i));
  assert.equal(l.length, RECENT_MAX);
  assert.equal(l[0].id, RECENT_MAX + 6, 'newest kept');
});

test('a junk entry is ignored rather than stored', () => {
  assert.deepEqual(recordView([], { id: 0 } as any), []);
  assert.deepEqual(recordView([], { id: -1 } as any), []);
  assert.deepEqual(recordView([], {} as any), []);
});

test('a corrupt store degrades to empty instead of crashing the feed', () => {
  assert.deepEqual(sanitize(null), []);
  assert.deepEqual(sanitize('nonsense'), []);
  assert.deepEqual(sanitize([{ id: 'x' }, null, { id: 3, brand: 'Apple' }]).map((x) => x.id), [3]);
});

test('the rail hides the device you are already looking at', () => {
  const l = [e(3), e(2), e(1)];
  assert.deepEqual(railItems(l, 3).map((x) => x.id), [2, 1]);
});

test('a rail of one is not worth the space it takes from listings', () => {
  assert.deepEqual(railItems([e(1)]), []);
  assert.equal(railItems([e(2), e(1)]).length, RECENT_MIN_TO_SHOW);
  // Excluding the current device can drop it below the floor, and then it
  // should disappear rather than render a single lonely tile.
  assert.deepEqual(railItems([e(2), e(1)], 2), []);
});

test('forget removes exactly one', () => {
  assert.deepEqual(forget([e(1), e(2)], 1).map((x) => x.id), [2]);
});
