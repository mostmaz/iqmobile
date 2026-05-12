import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { I18nManager, View, ActivityIndicator, Text } from 'react-native';
import { setupPushTapHandler } from './src/push/register';
import { go } from './src/navigation/ref';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts as useArabicFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { Inter_500Medium, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { AuthProvider } from './src/auth/AuthContext';
import RootNav from './src/navigation';
import { theme } from './src/theme';

const queryClient = new QueryClient();

// allowRTL is fine — it just permits opt-in writingDirection where used.
// We do NOT call forceRTL(true) because the codebase relies on explicit
// `flexDirection: 'row-reverse'` styles, which RN auto-flips when isRTL=true.
try { I18nManager.allowRTL(true); } catch {}

export default function App() {
  const [fontsLoaded] = useArabicFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_700Bold,
    Inter_500Medium,
    Inter_700Bold,
    JetBrainsMono_500Medium,
  });

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

  // Force the entire app subtree to behave as if isRTL is false, regardless
  // of the persisted I18nManager flag. The Yoga `direction: 'ltr'` style
  // overrides the inherited direction at the layout level — `row-reverse`
  // styles inside this subtree always render as visual right-to-left,
  // which is what every screen in this app expects. This is much more
  // robust than fighting with I18nManager.forceRTL across reload cycles.
  return (
    <View style={{ flex: 1, direction: 'ltr', backgroundColor: theme.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootNav />
            <StatusBar style="dark" />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </View>
  );
}
