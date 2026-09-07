// The React Native half of reachability: feed it real requests, probe when
// we think we're offline, and tell react-query. Decisions live in
// reachabilityCore.ts; this file only supplies a clock, a socket and AppState.

import { AppState } from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import { createReachability } from './reachabilityCore';
import { getBaseUrl, setRequestOutcomeSink } from '../api/client';

const reach = createReachability();

// A 30-byte JSON endpoint with no auth and no DB work — cheap enough to poll
// from a phone that may be on a metered connection. Deliberately NOT a real
// data route: a probe that fetches listings would look like recovery to the
// cache and repopulate screens with a request the user did not ask for.
const PROBE_PATH = '/health';
const PROBE_TIMEOUT_MS = 8000;

let probeTimer: ReturnType<typeof setTimeout> | null = null;

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(getBaseUrl() + PROBE_PATH, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function stopProbing() {
  if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
}

/**
 * Probe on a climbing backoff for as long as we believe we are offline.
 *
 * This loop is not an optimisation, it is the only way back: once
 * onlineManager is told we are offline, react-query stops firing the
 * requests whose success would tell us otherwise. Without a probe the app
 * would sit in its offline state until the user killed it.
 */
function scheduleProbe() {
  stopProbing();
  if (reach.isOnline()) return;
  probeTimer = setTimeout(async () => {
    probeTimer = null;
    reach.report((await probe()) ? 'ok' : 'unreachable');
    scheduleProbe();
  }, reach.nextProbeDelay());
}

let started = false;

/** Call once, as early as possible. Safe to call again. */
export function startReachability() {
  if (started) return;
  started = true;

  // Seed react-query with our own answer rather than its browser-oriented
  // default, which assumes online and never learns otherwise on RN.
  onlineManager.setOnline(reach.isOnline());
  reach.subscribe((online) => {
    onlineManager.setOnline(online);
    if (online) stopProbing(); else scheduleProbe();
  });

  setRequestOutcomeSink((ok) => { reach.report(ok ? 'ok' : 'unreachable'); });

  // Foregrounding is the best signal available that the world changed — the
  // user has plausibly just walked out of the lift. Probe immediately instead
  // of serving out a backoff that may have climbed to a minute.
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') { stopProbing(); return; }
    if (!reach.isOnline()) { reach.resetBackoff(); scheduleProbe(); }
  });
}

export function isOnline() { return reach.isOnline(); }
export function subscribeOnline(fn: (online: boolean) => void) { return reach.subscribe(fn); }

/** Force a check now — the offline banner's retry, and the outbox's trigger. */
export async function checkNow(): Promise<boolean> {
  const ok = await probe();
  reach.report(ok ? 'ok' : 'unreachable');
  return ok;
}
