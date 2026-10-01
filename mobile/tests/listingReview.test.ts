import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewSettled, reviewPollDelay, reviewCopy, REVIEW_GIVE_UP_MS } from '../src/lib/listingReview.ts';

test('only the three final states are settled', () => {
  assert.equal(reviewSettled('checking'), false);
  assert.equal(reviewSettled(null), false);
  assert.equal(reviewSettled(undefined), false);
  assert.equal(reviewSettled('published'), true);
  assert.equal(reviewSettled('under_review'), true);
  assert.equal(reviewSettled('rejected'), true);
});

test('polling is quick at first, slower later, and stops', () => {
  assert.equal(reviewPollDelay(0), 1500);
  assert.equal(reviewPollDelay(9_999), 1500);
  assert.equal(reviewPollDelay(10_000), 2500);
  assert.equal(reviewPollDelay(29_999), 2500);
  assert.equal(reviewPollDelay(30_000), 4000);
  assert.equal(reviewPollDelay(REVIEW_GIVE_UP_MS - 1), 4000);
  assert.equal(reviewPollDelay(REVIEW_GIVE_UP_MS), null);
});

test('a reason is shown when there is one, and only on the states that carry one', () => {
  assert.match(reviewCopy('under_review', 'الشاشة مكسورة').body, /السبب: الشاشة مكسورة/);
  assert.match(reviewCopy('rejected', 'الشاشة مكسورة').body, /السبب: الشاشة مكسورة/);
  assert.doesNotMatch(reviewCopy('under_review', null).body, /السبب/);
  assert.doesNotMatch(reviewCopy('published', 'ignored').body, /السبب/);
  assert.equal(reviewCopy('checking').tone, 'checking');
  assert.equal(reviewCopy('timeout').tone, 'pending');
  assert.equal(reviewCopy('rejected').tone, 'danger');
});
