// Deferred deep link for brand-new Android users.
//
// When someone taps a listing's web page and installs from the Google Play
// button, that button carries `&referrer=listing_<id>` (set server-side).
// Google's Play Install Referrer preserves it through the install, and
// expo-application exposes it via getInstallReferrerAsync() — no third-party
// SDK, no paid service. On the first launch where the main app is mounted we
// read it once, and if it names a listing, navigate straight there.
//
// iOS has no equivalent (Apple doesn't pass install attribution to the app),
// so this is a no-op there — matching the "free tier" scope.

import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { navigationRef } from '../navigation/ref';

const FLAG = 'install_referrer_handled';

function goToListing(id: number) {
  // Nested navigate matching the tree: Root → Main → Browse → ListingDetail.
  (navigationRef as any).navigate('Main', {
    screen: 'Browse',
    params: { screen: 'ListingDetail', params: { id } },
  });
}

// Call once the Main navigator is active (not during onboarding/auth). Safe
// to call more than once — the persisted flag makes it act at most once per
// install, and it only ever fires for an Android install that came from a
// listing link.
export async function handleInstallReferrer(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await SecureStore.getItemAsync(FLAG)) return;

    const referrer = await Application.getInstallReferrerAsync(); // e.g. "listing_698"
    const m = /listing_(\d+)/.exec(referrer || '');
    if (!m) {
      // Nothing to route to — mark handled so we don't re-read every launch.
      await SecureStore.setItemAsync(FLAG, '1');
      return;
    }

    const id = Number(m[1]);
    // Wait for navigation to be ready, then route once and record it.
    let tries = 0;
    const attempt = async () => {
      if (navigationRef.isReady()) {
        goToListing(id);
        await SecureStore.setItemAsync(FLAG, '1');
      } else if (tries++ < 40) {
        setTimeout(attempt, 300);
      }
    };
    attempt();
  } catch {
    // Best-effort — a referrer read failure must never block app boot.
  }
}
