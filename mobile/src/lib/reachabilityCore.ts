// Are we able to reach OUR server? — the pure half, with no React Native in it.
//
// Deliberately not `@react-native-community/netinfo`. Two reasons, and the
// second is the real one:
//
//   1. It is a native module, so adding it forces a rebuild of every dev
//      client and simulator build in flight.
//   2. It answers the wrong question. NetInfo reports the radio: whether the
//      phone is associated with a network. On Iraqi mobile data the common
//      failure is not "no signal" — it is full bars and no working data path,
//      a captive portal, or a carrier that silently blackholes the route. The
//      radio says connected the whole time. What actually matters to this app
//      is whether api.iqmobile.org answers, and every request we make is
//      already a measurement of exactly that.
//
// So this module is fed by the outcomes of real requests, and only falls back
// to an explicit probe once we believe we are offline — because once offline
// react-query stops firing the requests that would tell us otherwise, and
// without a probe the app would never discover the connection came back.
//
// Two rules keep it from flapping:
//   - Only a transport failure counts against us. An HTTP 500 is the server
//     answering, and a 401 is it answering emphatically; both mean online.
//   - One failure is not offline. Single requests fail constantly on a mobile
//     link; it takes CONSECUTIVE failures to flip, and any success resets.

/** What a finished request tells us. `ok` = bytes came back, whatever they said. */
export type Outcome = 'ok' | 'unreachable';

export type Reachability = ReturnType<typeof createReachability>;

export function createReachability({
  /**
   * Consecutive transport failures before we call it offline. Two, not one:
   * a lone timeout on a slow link is normal and showing an offline banner for
   * it would make the app look broken more often than the network is.
   */
  threshold = 2,
  /**
   * Probe backoff while offline, in ms. Climbs to a minute so a phone left in
   * a dead zone is not burning battery on a request per second, but starts
   * quickly because most outages are the few seconds inside a lift or tunnel.
   */
  backoff = [2000, 5000, 15000, 30000, 60000],
  online: initialOnline = true,
}: { threshold?: number; backoff?: number[]; online?: boolean } = {}) {
  let online = initialOnline;
  let failures = 0;
  // Counts probe rounds, not request failures: it must not be reset by the
  // ordinary traffic that keeps failing while we are already offline, or the
  // backoff would never actually back off.
  let probeRound = 0;
  const listeners = new Set<(online: boolean) => void>();

  function set(next: boolean) {
    if (next === online) return;
    online = next;
    if (next) probeRound = 0;
    for (const l of listeners) l(next);
  }

  return {
    isOnline: () => online,

    /** Feed one finished request. Returns the (possibly unchanged) state. */
    report(outcome: Outcome): boolean {
      if (outcome === 'ok') {
        failures = 0;
        set(true);
      } else {
        failures++;
        if (failures >= threshold) set(false);
      }
      return online;
    },

    /**
     * How long to wait before the next probe. Call once per probe round —
     * it advances the backoff itself, so a caller cannot forget to.
     */
    nextProbeDelay(): number {
      const d = backoff[Math.min(probeRound, backoff.length - 1)];
      probeRound++;
      return d;
    },

    /**
     * Coming back to the foreground is the strongest hint available that the
     * situation changed — the user has probably just walked out of the dead
     * zone. Probe now rather than waiting out a 60s backoff.
     */
    resetBackoff() { probeRound = 0; },

    subscribe(fn: (online: boolean) => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    /** Test seam. */
    _state: () => ({ online, failures, probeRound }),
  };
}

/**
 * Does this thrown error mean we could not reach the server at all?
 *
 * client.ts marks exactly two cases: `isTimeout` for a deadline it enforced
 * and `isNetwork` for a transport failure. Anything else carried a real HTTP
 * response, which is proof of reachability no matter how bad the status.
 */
export function isUnreachableError(e: any): boolean {
  return !!(e?.isTimeout || e?.isNetwork);
}
