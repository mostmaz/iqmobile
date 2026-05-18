// Thin wrapper around PostHog so the rest of the app calls `track('foo', {…})`
// without dragging in PostHog's API or worrying about whether the SDK is
// even initialised (no key = no provider = these calls are no-ops).
//
// Naming convention: `noun.verb` — `listing.viewed`, `user.signup`. Past
// tense for things that have already happened. Lowercase + dots so they
// sort nicely in PostHog's event-list UI.
//
// Properties: stick to flat scalars (numbers, strings, booleans). Avoid
// nested objects — they make filtering in the PostHog UI painful.

import { usePostHog } from 'posthog-react-native';
import { useCallback } from 'react';

export function useTrack() {
  const posthog = usePostHog();
  return useCallback(
    (event: string, props?: Record<string, any>) => {
      try {
        posthog?.capture(event, props);
      } catch {
        // Never let analytics throw. If PostHog is misconfigured we
        // want the app to keep running.
      }
    },
    [posthog],
  );
}

// `identify` ties anonymous events to a user once they log in. Call it
// right after auth completes — PostHog will retroactively associate
// pre-auth events with this user_id.
export function useIdentify() {
  const posthog = usePostHog();
  return useCallback(
    (userId: string | number, traits?: Record<string, any>) => {
      try {
        posthog?.identify(String(userId), traits);
      } catch { /* see useTrack */ }
    },
    [posthog],
  );
}

// `reset` clears the current user identity. Call on logout.
export function useResetIdentity() {
  const posthog = usePostHog();
  return useCallback(() => {
    try { posthog?.reset(); } catch { /* see useTrack */ }
  }, [posthog]);
}
