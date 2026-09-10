// One rewarded ad, shown only because a seller pressed a button.
//
// Everything here is best-effort and every failure is non-fatal, because the
// contract with the seller is that a broken ad costs them nothing. The server
// has already recorded a `pending` attempt by the time we get here; if the ad
// never loads, that row simply stays pending and no boost is spent.
//
// The `onUserEarnedReward` callback is NOT the grant. It only tells us when
// to start asking the server whether Google's own server-to-server callback
// has arrived. A rooted phone can fire that callback at will; it cannot forge
// Google's signature.
//
// The SDK is imported dynamically so that a build where the native module is
// missing — a stale Expo Go, a JS-only reload — degrades to "unavailable"
// instead of a red screen at startup.

import { Platform } from 'react-native';

export type RewardedOutcome =
  | { status: 'earned' }
  | { status: 'dismissed' }        // closed before the reward
  | { status: 'unavailable' }      // no fill, or the SDK is missing
  | { status: 'failed'; message?: string };

let initialised = false;

async function sdk() {
  try {
    return await import('react-native-google-mobile-ads');
  } catch {
    return null;
  }
}

/** Idempotent. Safe to call on every attempt. */
export async function initAds(): Promise<boolean> {
  const m = await sdk();
  if (!m) return false;
  if (initialised) return true;
  try {
    await m.default().initialize();
    initialised = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Load and show one rewarded ad.
 *
 * `serverSideVerificationOptions` is the whole point of the exercise: the
 * nonce the server minted travels to Google as `customData` and comes back
 * to us in Google's signed callback, which is how a reward is tied to the
 * attempt that asked for it. `userId` lets the callback name the seller
 * without us trusting the client to.
 */
export async function showRewarded(opts: {
  adUnitId: string;
  nonce: string;
  userId: string | number;
}): Promise<RewardedOutcome> {
  const m = await sdk();
  if (!m) return { status: 'unavailable' };
  if (!(await initAds())) return { status: 'unavailable' };

  const { RewardedAd, RewardedAdEventType, AdEventType } = m;

  return new Promise<RewardedOutcome>((resolve) => {
    let settled = false;
    let earned = false;
    const done = (out: RewardedOutcome) => {
      if (settled) return;
      settled = true;
      try { unsubscribe.forEach((fn) => fn()); } catch { /* listeners already gone */ }
      resolve(out);
    };

    let ad: any;
    try {
      ad = RewardedAd.createForAdRequest(opts.adUnitId, {
        // Iraq is outside the EEA and this app ships no consent form, so a
        // non-personalised request is the honest default until one exists.
        requestNonPersonalizedAdsOnly: true,
        serverSideVerificationOptions: {
          customData: opts.nonce,
          userId: String(opts.userId),
        },
      });
    } catch (e: any) {
      return done({ status: 'failed', message: e?.message });
    }

    const unsubscribe: Array<() => void> = [];
    unsubscribe.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      try { ad.show(); } catch (e: any) { done({ status: 'failed', message: e?.message }); }
    }));
    unsubscribe.push(ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      // Not a grant. A signal that Google's callback is on its way.
      earned = true;
    }));
    unsubscribe.push(ad.addAdEventListener(AdEventType.CLOSED, () => {
      done(earned ? { status: 'earned' } : { status: 'dismissed' });
    }));
    unsubscribe.push(ad.addAdEventListener(AdEventType.ERROR, (e: any) => {
      // "no-fill" is the ordinary case where the network simply has nothing
      // to show right now, and it must read as "try later", not as a fault.
      const code = String(e?.code || '');
      done(code.includes('no-fill') ? { status: 'unavailable' } : { status: 'failed', message: e?.message });
    }));

    // A load that never resolves would leave the seller on a spinner. The
    // SDK has no timeout of its own.
    setTimeout(() => done({ status: 'unavailable' }), 30000);

    try { ad.load(); } catch (e: any) { done({ status: 'failed', message: e?.message }); }
  });
}

/** Which unit to ask for. The server sends it; this is only the fallback. */
export function testUnitFor(): string {
  return Platform.OS === 'ios'
    ? 'ca-app-pub-3940256099942544/1712485313'
    : 'ca-app-pub-3940256099942544/5224354917';
}
