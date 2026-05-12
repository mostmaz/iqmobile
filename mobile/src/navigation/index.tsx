// Root navigation.
//
// Flow:
//   1. First launch → OnboardingScreen (no account needed). On finish we
//      stamp ONBOARDED_KEY and drop the user on MainTabs as a guest.
//   2. Subsequent launches → MainTabs directly, regardless of auth state.
//   3. Any "auth-required" action (Sell, Chat, Save, …) routes to the
//      `AuthGate` modal screen, which lets the user log in or sign up.
//      After auth completes the screen pops itself.
//
// We deliberately do NOT gate the whole app on user. Anonymous browsing is
// the primary use case before someone commits to creating an account.

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as SecureStore from '../lib/secureStore';
import { NavigationContainer, CommonActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../auth/AuthContext';
import AuthGateScreen from '../screens/auth/AuthGateScreen';
import CompleteProfileScreen from '../screens/auth/CompleteProfileScreen';
import OnboardingScreen, { ONBOARDED_KEY } from '../screens/auth/OnboardingScreen';
import BrowseScreen from '../screens/browse/BrowseScreen';
import ListingDetailScreen from '../screens/listing/ListingDetailScreen';
import PostListingScreen from '../screens/listing/PostListingScreen';
import EditListingScreen from '../screens/listing/EditListingScreen';
import MyListingsScreen from '../screens/listing/MyListingsScreen';
// In-app chat is hidden for now — the Chats tab and Chat / ChatsList
// screens are no longer reachable. Server data + screen files remain so
// we can switch them back on later without rebuilding.
import DealsScreen from '../screens/deal/DealsScreen';
import RateUserScreen from '../screens/deal/RateUserScreen';
import SavedScreen from '../screens/profile/SavedScreen';
import NotificationsScreen from '../screens/profile/NotificationsScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import ProfileScreen from '../screens/common/ProfileScreen';
import { TabBar } from './TabBar';
import { NotificationBanner } from '../components/NotificationBanner';
import { navigationRef } from './ref';
import { connectSSE, disconnectSSE } from '../sse/client';
import { registerPushToken } from '../push/register';
import { theme } from '../theme';

const BrowseStack = createNativeStackNavigator();

function BrowseStackNav() {
  return (
    <BrowseStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <BrowseStack.Screen name="BrowseHome" component={BrowseScreen} />
      <BrowseStack.Screen name="ListingDetail" component={ListingDetailScreen} />
      <BrowseStack.Screen name="EditListing" component={EditListingScreen} />
      <BrowseStack.Screen name="MyListings" component={MyListingsScreen} />
      <BrowseStack.Screen name="Deals" component={DealsScreen} />
      <BrowseStack.Screen name="RateUser" component={RateUserScreen} />
      <BrowseStack.Screen name="Notifications" component={NotificationsScreen} />
      <BrowseStack.Screen name="EditProfile" component={EditProfileScreen} />
    </BrowseStack.Navigator>
  );
}
function SavedStackNav() {
  return (
    <BrowseStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <BrowseStack.Screen name="SavedHome" component={SavedScreen} />
      <BrowseStack.Screen name="ListingDetail" component={ListingDetailScreen} />
    </BrowseStack.Navigator>
  );
}
function ProfileStackNav() {
  return (
    <BrowseStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <BrowseStack.Screen name="ProfileHome" component={ProfileScreen} />
      <BrowseStack.Screen name="MyListings" component={MyListingsScreen} />
      <BrowseStack.Screen name="ListingDetail" component={ListingDetailScreen} />
      <BrowseStack.Screen name="EditListing" component={EditListingScreen} />
      <BrowseStack.Screen name="Deals" component={DealsScreen} />
      <BrowseStack.Screen name="RateUser" component={RateUserScreen} />
      <BrowseStack.Screen name="Notifications" component={NotificationsScreen} />
      <BrowseStack.Screen name="EditProfile" component={EditProfileScreen} />
      <BrowseStack.Screen name="HowItWorks" component={OnboardingScreen} />
    </BrowseStack.Navigator>
  );
}
function SellStackNav() {
  return (
    <BrowseStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <BrowseStack.Screen name="SellHome" component={PostListingScreen} />
      <BrowseStack.Screen name="ListingDetail" component={ListingDetailScreen} />
    </BrowseStack.Navigator>
  );
}

const Tabs = createBottomTabNavigator();
function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="Browse" component={BrowseStackNav} />
      <Tabs.Screen name="Saved" component={SavedStackNav} />
      <Tabs.Screen
        name="Sell"
        component={SellStackNav}
        listeners={({ navigation }) => ({
          // After a successful post we replace SellHome with ListingDetail
          // (so the user lands on their new listing). Without this listener,
          // tapping Sell again would keep showing that previous detail page
          // — the user expects a fresh "post a new listing" form instead.
          //
          // We also need to defeat React's component-instance reuse: when
          // the SellHome route still exists, navigating to it doesn't
          // remount PostListingScreen, so any leftover form state from a
          // canceled wizard would persist. Dispatching a full reset of the
          // Sell stack guarantees both:
          //   1. The Sell tab is on the SellHome route
          //   2. PostListingScreen mounts fresh (empty form)
          tabPress: (e) => {
            e.preventDefault();
            navigation.dispatch({
              ...CommonActions.navigate({ name: 'Sell' }),
              target: navigation.getState().key,
            });
            // Reset the nested Sell stack to a single SellHome route. The
            // setTimeout(0) lets the tab switch propagate first; the
            // dispatched reset then targets the (now active) Sell stack.
            setTimeout(() => {
              const state = navigation.getState();
              const sellRoute = state.routes.find((r: any) => r.name === 'Sell') as any;
              if (sellRoute?.state?.key) {
                navigation.dispatch({
                  ...CommonActions.reset({
                    index: 0,
                    routes: [{ name: 'SellHome' }],
                  }),
                  target: sellRoute.state.key,
                });
              }
            }, 0);
          },
        })}
      />
      <Tabs.Screen name="Profile" component={ProfileStackNav} />
    </Tabs.Navigator>
  );
}

const Root = createNativeStackNavigator();

export default function RootNav() {
  const { user, loading } = useAuth();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const needsProfileCompletion = !!user && !user.is_guest && user.profile_completed === false;

  useEffect(() => {
    SecureStore.getItem(ONBOARDED_KEY)
      .then((v) => setOnboarded(v === '1'))
      .catch(() => setOnboarded(false));
  }, []);

  // When the user transitions out of CompleteProfile (profile_completed
  // flips from false → true), the navigator swaps from {CompleteProfile}
  // back to {Main, AuthGate}. MainTabs mounts fresh and focuses its first
  // tab (Browse) — but the user got into CompleteProfile by tapping Sell
  // as a guest, so they want to land on the Sell wizard, not Browse.
  //
  // Watching the boolean inside RootNav means this fires AFTER React
  // has actually re-rendered with MainTabs in the tree, which is the
  // earliest moment a navigate-to-Sell dispatch will land on a real
  // route. The ref tracks the previous value so we only redirect on the
  // false→true transition, not on every render.
  const wasIncomplete = useRef(false);
  useEffect(() => {
    if (needsProfileCompletion) {
      wasIncomplete.current = true;
      return;
    }
    if (wasIncomplete.current) {
      wasIncomplete.current = false;
      // Give React one more tick to finish committing MainTabs.
      const t = setTimeout(() => {
        if (navigationRef.isReady()) {
          navigationRef.dispatch(
            CommonActions.navigate({
              name: 'Main',
              params: { screen: 'Sell', params: { screen: 'SellHome' } },
            }),
          );
        }
      }, 0);
      return () => clearTimeout(t);
    }
  }, [needsProfileCompletion]);

  useEffect(() => {
    // Live notifications + push token only matter when there's a user; the
    // SSE channel keys off the JWT.
    if (user) {
      connectSSE();
      registerPushToken();
    } else {
      disconnectSSE();
    }
    return () => disconnectSSE();
  }, [user]);

  if (loading || onboarded === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  // First-launch onboarding. Once dismissed, stays dismissed forever (the
  // Profile screen has a "كيف يعمل التطبيق" entry to re-view it).
  if (!onboarded) {
    return <OnboardingScreen onDone={() => setOnboarded(true)} />;
  }

  // (`needsProfileCompletion` is computed once at the top of this
  //  component and reused here for the navigator's conditional render.)

  return (
    <NavigationContainer ref={navigationRef}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        {needsProfileCompletion ? (
          <Root.Screen name="CompleteProfile" component={CompleteProfileScreen} />
        ) : (
          <>
            <Root.Screen name="Main" component={MainTabs} />
            {/* Auth gate is presented modally so it floats above whichever
                tab triggered it; on success it just pops itself off the
                stack and the original screen sees `user` populated. */}
            <Root.Screen
              name="AuthGate"
              component={AuthGateScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
          </>
        )}
      </Root.Navigator>
      <NotificationBanner />
    </NavigationContainer>
  );
}
