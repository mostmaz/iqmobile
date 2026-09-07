// Photo slots suggest; they never gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_SLOTS, slotAt, nextSlot, slotIdAt } from '../src/lib/photoSlots.ts';

test('the four labels are the ones already in the dictionary', () => {
  // ar.post.front / back2 / side / box were written and never used. This is
  // the wiring, so the ids must match the keys or the strings drift.
  assert.deepEqual(PHOTO_SLOTS.map((s) => s.id), ['front', 'back2', 'side', 'box']);
});

test('a fifth photo is unlabelled rather than wrongly labelled', () => {
  assert.equal(slotAt(3)?.id, 'box');
  assert.equal(slotAt(4), null, 'we cannot say what photo five shows');
  assert.equal(slotIdAt(9), null);
});

test('the next prompt follows the count', () => {
  assert.equal(nextSlot(0)?.id, 'front');
  assert.equal(nextSlot(2)?.id, 'side');
  assert.equal(nextSlot(4), null, 'past the shot list there is nothing to ask for');
});
