import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import { theme } from './src/theme';
import { AuthProvider, useAuth } from './src/lib/auth';
import LoginScreen from './src/screens/LoginScreen';
import QueueScreen from './src/screens/QueueScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import GuaranteeScreen from './src/screens/GuaranteeScreen';
import ListingsScreen from './src/screens/ListingsScreen';
import ShopsScreen from './src/screens/ShopsScreen';
import ModerationScreen from './src/screens/ModerationScreen';
import MoreScreen from './src/screens/MoreScreen';
import UsersScreen from './src/screens/UsersScreen';
import PromoteScreen from './src/screens/PromoteScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import StoreScreen from './src/screens/StoreScreen';
import CatalogScreen from './src/screens/CatalogScreen';
import InspectionScreen from './src/screens/InspectionScreen';
import OverviewScreen from './src/screens/OverviewScreen';
import GrowthScreen from './src/screens/GrowthScreen';
import ShopReviewScreen from './src/screens/ShopReviewScreen';
import ChatsScreen from './src/screens/ChatsScreen';
import SocialScreen from './src/screens/SocialScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Two tabs only. The queue is what a notification opens into and "كل الأقسام"
// is where everything else lives — a five-tab bar on a tool this size just
// makes each target smaller.
function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.line },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.faint,
        tabBarLabelStyle: { fontSize: 12 },
        tabBarIcon: () => null,
        tabBarLabel: route.name === 'QueueTab' ? 'المهام' : 'كل الأقسام',
      })}
    >
      <Tab.Screen name="QueueTab" component={QueueScreen} />
      <Tab.Screen name="MoreTab" component={MoreScreen} />
    </Tab.Navigator>
  );
}
const navRef = createNavigationContainerRef();

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // An operator's phone sleeps in a pocket; refetching on focus is the
      // difference between acting on live counts and acting on this
      // morning's.
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
});

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: { ...DefaultTheme.colors, background: theme.bg, card: theme.surface, text: theme.ink, border: theme.line, primary: theme.accent },
};

/** Where each push kind lands when tapped. */
function routeFor(kind?: string): string | null {
  if (kind === 'order.new') return 'Orders';
  if (kind === 'guarantee.new') return 'Guarantee';
  if (kind === 'store.chat') return 'Chats';
  if (kind === 'listing.new') return 'Listings';
  if (kind === 'shop.new') return 'ShopReview';
  if (kind === 'report.new') return 'Moderation';
  if (kind === 'device.suggested') return 'Moderation';
  if (kind === 'feature.requested') return 'Promote';
  return null; // the rest land on the queue, which is the default screen
}

function Root() {
  const { admin, ready } = useAuth();
  const pending = useRef<string | null>(null);

  // A notification tapped from a cold start arrives before the navigator is
  // mounted, so it is held and replayed once we know where to send it.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const kind = (res.notification.request.content.data as any)?.kind;
      const route = routeFor(kind);
      if (!route) return;
      if (navRef.isReady()) navRef.navigate(route as never);
      else pending.current = route;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Any push means something changed server-side; drop the cached counts
    // so the queue is right the moment it is looked at.
    const sub = Notifications.addNotificationReceivedListener(() => {
      qc.invalidateQueries({ queryKey: ['work-queue'] });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
    });
    return () => sub.remove();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!admin) return <LoginScreen />;

  return (
    <NavigationContainer
      ref={navRef}
      theme={navTheme}
      onReady={() => {
        if (pending.current && navRef.isReady()) {
          navRef.navigate(pending.current as never);
          pending.current = null;
        }
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
          animation: Platform.OS === 'android' ? 'fade_from_bottom' : 'default',
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Orders" component={OrdersScreen} />
        <Stack.Screen name="Guarantee" component={GuaranteeScreen} />
        <Stack.Screen name="Listings" component={ListingsScreen} />
        <Stack.Screen name="Shops" component={ShopsScreen} />
        <Stack.Screen name="Moderation" component={ModerationScreen} />
        <Stack.Screen name="Users" component={UsersScreen} />
        <Stack.Screen name="Promote" component={PromoteScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Store" component={StoreScreen} />
        <Stack.Screen name="Chats" component={ChatsScreen} />
        <Stack.Screen name="Social" component={SocialScreen} />
        <Stack.Screen name="Catalog" component={CatalogScreen} />
        <Stack.Screen name="Inspection" component={InspectionScreen} />
        <Stack.Screen name="Overview" component={OverviewScreen} />
        <Stack.Screen name="Growth" component={GrowthScreen} />
        <Stack.Screen name="ShopReview" component={ShopReviewScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusBar style="light" />
          <Root />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
