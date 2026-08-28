import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { I18nManager, View, ActivityIndicator, Text, LogBox } from 'react-native';

// Dev-only noise: without a PostHog key (every local run) the provider is
// deliberately not mounted, and posthog-react-native warns on each mount.
// The warning teaches nothing and its toast sits exactly where the tab bar
// is, stealing taps during testing. Release builds have no LogBox.
LogBox.ignoreLogs(['usePostHog was called without a PostHog client']);
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { setupPushTapHandler } from './src/push/register';
import { initMeta } from './src/analytics/meta';
import { go } from './src/navigation/ref';

// Sentry — runs as early as possible so even crashes during module
// initialisation are captured. DSN comes from app.json's extra so we
// don't hardcode it in source. Empty DSN = noop (Sentry SDK skips
// sending events), which is what we want until the DSN is set.
const sentryDsn = (Constants.expoConfig?.extra as any)?.sentryDsn;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    // Tag every event with the runtime environment so prod/dev are
    // easy to separate in the dashboard. __DEV__ is true in Expo Go
    // and dev EAS builds, false in preview/production builds.
    environment: __DEV__ ? 'development' : 'production',
    // 10% of transactions sampled for performance traces — plenty of
    // signal without burning quota. Crashes/errors are always 100%.
    tracesSampleRate: 0.1,
    // Don't auto-capture every console.log — only console.error/warn.
    integrations: [],
    // Strip PII Sentry can't tell is sensitive (phone numbers, etc.)
    sendDefaultPii: false,
  });
}
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostHogProvider } from 'posthog-react-native';

// PostHog — product analytics (DAU, funnels, retention, screen views,
// taps). Read key + host from app.json so the build can ship without
// hardcoding them. Empty key = no PostHogProvider gets mounted (see
// AppInner return), so zero events are sent.
const posthogKey = (Constants.expoConfig?.extra as any)?.posthogKey || '';
const posthogHost = (Constants.expoConfig?.extra as any)?.posthogHost || 'https://eu.i.posthog.com';
import {
  useFonts as useArabicFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { Inter_500Medium, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { AuthProvider } from './src/auth/AuthContext';
import { CartProvider } from './src/lib/cart';
import { CompareProvider } from './src/lib/compare';
import RootNav from './src/navigation';
import { loadLang, onLangChange } from './src/i18n/ar';
import { theme } from './src/theme';

const queryClient = new QueryClient();

// allowRTL is fine — it just permits opt-in writingDirection where used.
// We do NOT call forceRTL(true) because the codebase relies on explicit
// `flexDirection: 'row-reverse'` styles, which RN auto-flips when isRTL=true.
try { I18nManager.allowRTL(true); } catch {}

function AppInner() {
  const [fontsLoaded] = useArabicFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_700Bold,
    Inter_500Medium,
    Inter_700Bold,
    JetBrainsMono_500Medium,
  });

  // Meta (Facebook) App Events — initialise once on launch. Handles the
  // iOS App Tracking Transparency prompt and logs the app-activate event
  // Meta uses for install attribution. No-ops until a real Meta App ID is
  // set in app.json (see src/analytics/meta.ts).
  useEffect(() => { initMeta(); }, []);

  // Language: restore the saved choice on launch, and bump a key whenever it
  // changes so the tree remounts with the new strings.
  const [langKey, setLangKey] = useState(0);
  useEffect(() => {
    loadLang().then(() => setLangKey((k) => k + 1));
    return onLangChange(() => setLangKey((k) => k + 1));
  }, []);

  // Notification-tap routing. Server attaches a `kind` (and any extras
  // it needs) to the data payload of every push. We translate that into
  // an in-app navigation here. Adding a new kind = add a case below.
  useEffect(() => {
    setupPushTapHandler((data) => {
      switch (data?.kind) {
        case 'listing.expired':
        case 'listing.sold':
        case 'listing.saved':
          if (data?.listing_id) go('Main', { screen: 'Browse', params: { screen: 'ListingDetail', params: { id: data.listing_id } } });
          break;
        case 'broadcast':
          // Marketing / announcement — just open the app, no specific route.
          break;
        default:
          // Unknown kind: best-effort, just open the app.
          break;
      }
    });
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
        <Text style={{ color: theme.subtle, marginTop: 12 }}>جاري التحميل...</Text>
      </View>
    );
  }

  const body = (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CartProvider>
            <CompareProvider>
            {/* key={langKey} remounts the whole nav tree when the language
                changes, so every screen re-reads the (in-place swapped)
                string dictionary in the new language. */}
            <RootNav key={langKey} />
            <StatusBar style="dark" />
            </CompareProvider>
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );

  // Force the entire app subtree to behave as if isRTL is false, regardless
  // of the persisted I18nManager flag. The Yoga `direction: 'ltr'` style
  // overrides the inherited direction at the layout level — `row-reverse`
  // styles inside this subtree always render as visual right-to-left,
  // which is what every screen in this app expects. This is much more
  // robust than fighting with I18nManager.forceRTL across reload cycles.
  //
  // PostHogProvider is only mounted when an API key is configured. With
  // no key, no provider, no events. The `autocapture` flag turns on the
  // built-in lifecycle + screen + tap tracking — gives us DAU, session
  // length, screen views, and click events without any per-component
  // instrumentation.
  return (
    <View style={{ flex: 1, direction: 'ltr', backgroundColor: theme.bg }}>
      {posthogKey ? (
        <PostHogProvider
          apiKey={posthogKey}
          options={{
            host: posthogHost,
            // Auto-capture app open/foreground/background. Required for DAU.
            captureAppLifecycleEvents: true,
            // Send events in batches every 10s to keep network noise low.
            flushInterval: 10000,
          }}
          // Auto-capture taps on Touchables + screen views from React
          // Navigation. We can turn `captureTouches` off if we start
          // hitting event quota; the named manual captures
          // (listing.viewed, listing.contact_call, etc.) are what we
          // really care about for product decisions.
          autocapture={{
            captureTouches: true,
            captureScreens: true,
          }}
        >
          {body}
        </PostHogProvider>
      ) : body}
    </View>
  );
}

// Sentry.wrap (a) installs a top-level error boundary that reports any
// React render crash to Sentry instead of just showing the red screen,
// and (b) tags the app's root component for tracing. When DSN is empty
// it degrades gracefully — wrap() is a noop.
export default sentryDsn ? Sentry.wrap(AppInner) : AppInner;
