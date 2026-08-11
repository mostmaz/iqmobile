import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import { theme } from './src/theme';
import { AuthProvider, useAuth } from './src/lib/auth';
import LoginScreen from './src/screens/LoginScreen';
import QueueScreen from './src/screens/QueueScreen';
import OrdersScreen from './src/screens/OrdersScreen';

const Stack = createNativeStackNavigator();
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
  return null; // everything else opens the queue, which is the default screen
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
        <Stack.Screen name="Queue" component={QueueScreen} />
        <Stack.Screen name="Orders" component={OrdersScreen} />
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
