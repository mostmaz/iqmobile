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
import { AppGate } from '../components/AppGate';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../auth/AuthContext';
import AuthGateScreen from '../screens/auth/AuthGateScreen';
import OtpVerifyScreen from '../screens/auth/OtpVerifyScreen';
import CompleteProfileScreen from '../screens/auth/CompleteProfileScreen';
import OnboardingScreen, { ONBOARDED_KEY } from '../screens/auth/OnboardingScreen';
import BrowseScreen from '../screens/browse/BrowseScreen';
import SearchScreen from '../screens/search/SearchScreen';
import SavedSearchesScreen from '../screens/search/SavedSearchesScreen';
import ListingDetailScreen from '../screens/listing/ListingDetailScreen';
import PostListingScreen from '../screens/listing/PostListingScreen';
import EditListingScreen from '../screens/listing/EditListingScreen';
import MyListingsScreen from '../screens/listing/MyListingsScreen';
import FeatureListingScreen from '../screens/listing/FeatureListingScreen';
import ShopsScreen from '../screens/shops/ShopsScreen';
import ShopScreen from '../screens/shops/ShopScreen';
import ShopRegisterScreen from '../screens/shops/ShopRegisterScreen';
import AdvertiseScreen from '../screens/advertise/AdvertiseScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import CartScreen from '../screens/orders/CartScreen';
import OrderConfirmedScreen from '../screens/orders/OrderConfirmedScreen';
import MyOrdersScreen from '../screens/orders/MyOrdersScreen';
import ChatsListScreen from '../screens/chat/ChatsListScreen';
import DealsScreen from '../screens/deal/DealsScreen';
import RateUserScreen from '../screens/deal/RateUserScreen';
import SavedScreen from '../screens/profile/SavedScreen';
import WishlistScreen from '../screens/profile/WishlistScreen';
import NotificationsScreen from '../screens/profile/NotificationsScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import ProfileScreen from '../screens/common/ProfileScreen';
import { TabBar } from './TabBar';
import { NotificationBanner } from '../components/NotificationBanner';
import { navigationRef } from './ref';
import { handleInstallReferrer } from '../lib/installReferrer';
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
      <BrowseStack.Screen name="FeatureListing" component={FeatureListingScreen} />
      <BrowseStack.Screen name="Shops" component={ShopsScreen} />
      <BrowseStack.Screen name="ShopDetail" component={ShopScreen} />
      <BrowseStack.Screen name="Cart" component={CartScreen} />
      <BrowseStack.Screen name="OrderConfirmed" component={OrderConfirmedScreen} />
      <BrowseStack.Screen name="MyOrders" component={MyOrdersScreen} />
      <BrowseStack.Screen name="ShopRegister" component={ShopRegisterScreen} />
      <BrowseStack.Screen name="Deals" component={DealsScreen} />
      <BrowseStack.Screen name="RateUser" component={RateUserScreen} />
      <BrowseStack.Screen name="Notifications" component={NotificationsScreen} />
      <BrowseStack.Screen name="SavedSearches" component={SavedSearchesScreen} />
      <BrowseStack.Screen name="Wishlist" component={WishlistScreen} />
      <BrowseStack.Screen name="EditProfile" component={EditProfileScreen} />
    </BrowseStack.Navigator>
  );
}
function SearchStackNav() {
  return (
    <BrowseStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <BrowseStack.Screen name="SearchHome" component={SearchScreen} />
      <BrowseStack.Screen name="ListingDetail" component={ListingDetailScreen} />
      <BrowseStack.Screen name="SavedSearches" component={SavedSearchesScreen} />
      <BrowseStack.Screen name="Wishlist" component={WishlistScreen} />
      <BrowseStack.Screen name="FeatureListing" component={FeatureListingScreen} />
    </BrowseStack.Navigator>
  );
}
function ProfileStackNav() {
  return (
    <BrowseStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <BrowseStack.Screen name="ProfileHome" component={ProfileScreen} />
      <BrowseStack.Screen name="Saved" component={SavedScreen} />
      <BrowseStack.Screen name="MyListings" component={MyListingsScreen} />
      <BrowseStack.Screen name="FeatureListing" component={FeatureListingScreen} />
      <BrowseStack.Screen name="Shops" component={ShopsScreen} />
      <BrowseStack.Screen name="ShopDetail" component={ShopScreen} />
      <BrowseStack.Screen name="Cart" component={CartScreen} />
      <BrowseStack.Screen name="OrderConfirmed" component={OrderConfirmedScreen} />
      <BrowseStack.Screen name="MyOrders" component={MyOrdersScreen} />
      <BrowseStack.Screen name="ShopRegister" component={ShopRegisterScreen} />
      <BrowseStack.Screen name="Advertise" component={AdvertiseScreen} />
      <BrowseStack.Screen name="ListingDetail" component={ListingDetailScreen} />
      <BrowseStack.Screen name="EditListing" component={EditListingScreen} />
      <BrowseStack.Screen name="Deals" component={DealsScreen} />
      <BrowseStack.Screen name="RateUser" component={RateUserScreen} />
      <BrowseStack.Screen name="Notifications" component={NotificationsScreen} />
      <BrowseStack.Screen name="SavedSearches" component={SavedSearchesScreen} />
      <BrowseStack.Screen name="Wishlist" component={WishlistScreen} />
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
      {/* Publishing lands on ListingDetail inside THIS stack — the promote
          CTA there needs the route locally or the post-publish upsell dies. */}
      <BrowseStack.Screen name="FeatureListing" component={FeatureListingScreen} />
      {/* ListingDetail's price-alert buttons need these locally too. */}
      <BrowseStack.Screen name="Wishlist" component={WishlistScreen} />
    </BrowseStack.Navigator>
  );
}
// Chats stack — the inbox lives at ChatsHome, individual conversations
// at Chat. ListingDetail is also registered here so the device-name tap
// inside ChatScreen has a route to navigate to.
function ChatsStackNav() {
  return (
    <BrowseStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <BrowseStack.Screen name="ChatsHome" component={ChatsListScreen} />
      <BrowseStack.Screen name="Chat" component={ChatScreen} />
      <BrowseStack.Screen name="ListingDetail" component={ListingDetailScreen} />
      <BrowseStack.Screen name="FeatureListing" component={FeatureListingScreen} />
      {/* ListingDetail's price-alert buttons need this locally too. */}
      <BrowseStack.Screen name="Wishlist" component={WishlistScreen} />
    </BrowseStack.Navigator>
  );
}

const Tabs = createBottomTabNavigator();

// Tapping a tab should land on that tab's ROOT screen, not wherever its
// nested stack was last left. Without this, opening a conversation and later
// tapping المحادثات again re-showed that same conversation instead of the
// inbox — the stack had simply been restored. Sell needs the same treatment
// for a different reason (see its call site).
//
// preventDefault + manual navigate keeps the tab switch; the deferred reset
// then targets the nested stack once it's active. `always` forces a reset
// even when the stack is already at its root — Sell uses it to defeat
// component-instance reuse so PostListingScreen mounts with a fresh form.
// Chats skips it so re-tapping the tab while on the inbox doesn't remount
// the list and throw away scroll position.
function resetToRootOnTabPress(tabName: string, rootRoute: string, opts?: { always?: boolean }) {
  return ({ navigation }: any) => ({
    tabPress: (e: any) => {
      e.preventDefault();
      navigation.dispatch({
        ...CommonActions.navigate({ name: tabName }),
        target: navigation.getState().key,
      });
      // setTimeout(0) lets the tab switch propagate first; the dispatched
      // reset then targets the (now active) nested stack.
      setTimeout(() => {
        const state = navigation.getState();
        const route = state.routes.find((r: any) => r.name === tabName) as any;
        const doReset = (key: string) => navigation.dispatch({
          ...CommonActions.reset({ index: 0, routes: [{ name: rootRoute }] }),
          target: key,
        });

        if (route?.state?.key) {
          // Nested stack is materialised — judge "at root" by the FOCUSED
          // ROUTE'S NAME, not by index: a deep-linked stack can hold a
          // non-root screen at index 0 with nothing beneath it.
          const focused = route.state.routes?.[route.state.index ?? route.state.routes.length - 1];
          if (opts?.always || (focused && focused.name !== rootRoute)) doReset(route.state.key);
          return;
        }

        // No nested state AT ALL. This is what a deep link leaves behind:
        // ListingDetail does getParent().navigate('Chats', { screen: 'Chat' }),
        // the nested navigator mounts straight onto Chat driven purely by
        // route.params — and params are sticky, so every later tab press
        // re-opened that same conversation. Navigate the nested navigator to
        // its root (overwriting params.screen), then reset on the next tick
        // once the state object exists, so the old conversation isn't left
        // under the inbox for the back button to find.
        if (route?.params?.screen && route.params.screen !== rootRoute) {
          navigation.dispatch({
            ...CommonActions.navigate({ name: tabName, params: { screen: rootRoute } }),
            target: state.key,
          });
          setTimeout(() => {
            const s2 = navigation.getState();
            const r2 = s2.routes.find((r: any) => r.name === tabName) as any;
            if (r2?.state?.key) doReset(r2.state.key);
          }, 0);
        }
      }, 0);
    },
  });
}

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="Browse" component={BrowseStackNav} />
      <Tabs.Screen name="Search" component={SearchStackNav} />
      <Tabs.Screen
        name="Sell"
        component={SellStackNav}
        // After a successful post we replace SellHome with ListingDetail (so
        // the user lands on their new listing) — tapping Sell again must show
        // a fresh post form, not that stale detail page. `always` forces the
        // reset even at root to defeat component-instance reuse: without it,
        // leftover form state from a canceled wizard would persist.
        listeners={resetToRootOnTabPress('Sell', 'SellHome', { always: true })}
      />
      <Tabs.Screen
        name="Chats"
        component={ChatsStackNav}
        // Re-entering المحادثات lands on the inbox, not the last-open
        // conversation the stack happened to be left on.
        listeners={resetToRootOnTabPress('Chats', 'ChatsHome')}
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

  // Deferred deep link: once the main app is active (past onboarding and any
  // required profile completion), route a brand-new Android user who arrived
  // via a listing's Play link straight to that listing. Runs at most once per
  // install (guarded internally), no-op on iOS.
  useEffect(() => {
    if (onboarded && !needsProfileCompletion) handleInstallReferrer();
  }, [onboarded, needsProfileCompletion]);

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

  // Deep linking: an https://api.iqmobile.org/l/:id link (App Link on
  // Android / Universal Link on iOS, verified via the server's
  // .well-known association files) — or the iqmobile://l/:id scheme —
  // opens ListingDetail inside the Browse tab. The path mirrors the nested
  // navigator hierarchy: Root → Main → Browse tab → ListingDetail(id).
  const linking = {
    prefixes: ['https://api.iqmobile.org', 'iqmobile://'],
    config: {
      screens: {
        Main: {
          screens: {
            Browse: {
              screens: { ListingDetail: 'l/:id' },
            },
          },
        },
      },
    },
  };

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
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
            <Root.Screen
              name="OtpVerify"
              component={OtpVerifyScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
          </>
        )}
      </Root.Navigator>
      <NotificationBanner />
      {/* Sits above the navigator so the update wall covers every screen,
          not just the one the user happens to be on. */}
      <AppGate />
    </NavigationContainer>
  );
}
