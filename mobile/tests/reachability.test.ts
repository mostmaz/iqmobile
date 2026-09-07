// Reachability: the decisions, without a network or React Native.
//
// The two behaviours that matter are the ones a naive version gets wrong:
// a single failed request must not declare the app offline (mobile links
// fail one request all the time), and an HTTP error must not either — a 500
// is the server answering, which is proof we reached it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReachability, isUnreachableError } from '../src/lib/reachabilityCore.ts';

test('one failure is not offline; two consecutive are', () => {
  const r = createReachability();
  assert.equal(r.report('unreachable'), true, 'a lone timeout is just a slow link');
  assert.equal(r.report('unreachable'), false);
});

test('any success resets the streak', () => {
  const r = createReachability();
  r.report('unreachable');
  r.report('ok');
  assert.equal(r.report('unreachable'), true, 'the streak restarted, so this is failure #1');
});

test('coming back online is announced once, not per request', () => {
  const r = createReachability();
  const seen: boolean[] = [];
  r.subscribe((o) => seen.push(o));
  r.report('unreachable'); r.report('unreachable');   // → offline
  r.report('ok'); r.report('ok'); r.report('ok');     // → online, once
  assert.deepEqual(seen, [false, true]);
});

test('an HTTP error means online — the server answered', () => {
  // The whole point of measuring our own server rather than the radio: a 500
  // and a 401 are both proof of reachability. Only client.ts's two transport
  // markers count against us.
  assert.equal(isUnreachableError({ status: 500 }), false);
  assert.equal(isUnreachableError({ status: 401, data: {} }), false);
  assert.equal(isUnreachableError(new Error('http_404')), false);
  assert.equal(isUnreachableError({ isTimeout: true }), true);
  assert.equal(isUnreachableError({ isNetwork: true }), true);
  assert.equal(isUnreachableError(null), false);
});

test('probe backoff climbs, and ordinary traffic cannot hold it down', () => {
  const r = createReachability({ backoff: [1000, 5000, 20000] });
  r.report('unreachable'); r.report('unreachable');
  assert.equal(r.nextProbeDelay(), 1000);
  // While offline, real requests keep failing. If those reset the backoff the
  // app would probe every second forever and flatten the battery.
  r.report('unreachable'); r.report('unreachable');
  assert.equal(r.nextProbeDelay(), 5000);
  assert.equal(r.nextProbeDelay(), 20000);
  assert.equal(r.nextProbeDelay(), 20000, 'clamps at the last step');
});

test('reconnecting resets the backoff for the next outage', () => {
  const r = createReachability({ backoff: [1000, 5000, 20000] });
  r.report('unreachable'); r.report('unreachable');
  r.nextProbeDelay(); r.nextProbeDelay();
  r.report('ok');
  r.report('unreachable'); r.report('unreachable');
  assert.equal(r.nextProbeDelay(), 1000, 'a fresh outage starts probing fast again');
});

test('foreground resets the backoff without faking a success', () => {
  const r = createReachability({ backoff: [1000, 5000, 20000] });
  r.report('unreachable'); r.report('unreachable');
  r.nextProbeDelay(); r.nextProbeDelay();
  r.resetBackoff();
  assert.equal(r.isOnline(), false, 'still offline until something actually answers');
  assert.equal(r.nextProbeDelay(), 1000);
});

test('an app that starts offline is not assumed online forever', () => {
  const r = createReachability({ online: false });
  assert.equal(r.isOnline(), false);
  assert.equal(r.report('ok'), true);
});
