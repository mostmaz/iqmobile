// Bottom tab bar — matches the design: 5 icons, all SVG, with the
// center "Sell" button visually elevated (negative top margin + ink fill +
// rounded square) so it reads as the primary call to action without
// breaking the rhythm of the row.
//
// تصفح · اطلب جهاز · بيع · الطلبات · حسابي.
//
// «بحث» used to hold the second slot; it is a real field in the Browse
// header now, so nothing was lost by giving the slot to the request feature
// — which previously had one entry point for two different jobs. Posting a
// request and reading other people's requests are not the same errand, and
// one tab could only ever open on one of them.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StackActions } from '@react-navigation/native';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { IconHome, IconSearch, IconPlus, IconPerson, IconChat, IconRequest, IconList } from '../components/icons';
import { ar } from '../i18n/ar';
import { useRequestHub } from '../lib/requestHub';
import { badgeLabel } from '../lib/requestPulse';

// Labels come from the live i18n dictionary — read per render, not at
// module scope, so the Arabic/Kurdish switch reaches the tab bar too.
const LABELS = (): Record<string, string> => ({
  Browse: ar.tabs.browse,
  Search: ar.tabs.search,
  AskDevice: ar.tabs.askDevice,
  Sell: ar.tabs.sell,
  Requests: ar.tabs.requests,
  Chats: ar.tabs.chats,
  Profile: ar.tabs.profile,
});

// Routes that stay REGISTERED but leave the bar. Chats moved to the Browse
// header (design §A); Search became the header's field (design 8b). Both are
// still reachable by navigate() and by notification deep links, so removing
// the screens instead of the buttons would break those.
const HIDDEN = new Set(['Chats', 'Search']);

const ICONS: Record<string, (p: { size?: number; color?: string; sw?: number; filled?: boolean }) => React.ReactElement> = {
  Browse: IconHome,
  Search: IconSearch,
  // The phone-with-a-magnifier now marks the ASKING side, and the board of
  // lines marks the reading side. They were one icon for both jobs before.
  AskDevice: IconRequest,
  Sell: IconPlus,
  Requests: IconList,
  Chats: IconChat,
  Profile: IconPerson,
};

// Auth gates removed: every user has a guest session, so all tabs are
// reachable directly. (We'll re-introduce gating once real signup is
// required for sellers — see /auth/upgrade flow.)
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { pulse, openCompose } = useRequestHub();
  // «الطلبات» counts what has been posted near you since you last opened the
  // feed — the same window the feed's own subtitle describes, so the two
  // numbers can be reconciled by anyone who looks at both.
  const requestsBadge = badgeLabel(pulse?.count_new);
  return (
    <View style={{
      flexDirection: 'row-reverse',
      paddingTop: 8,
      paddingBottom: 10 + insets.bottom,
      paddingHorizontal: 6,
      backgroundColor: theme.surface,
      borderTopWidth: 1,
      borderColor: theme.line,
      gap: 4,
    }}>
      {/* Hidden routes stay REGISTERED so navigate() and notification deep
          links keep working; they just aren't rendered here. Focus therefore
          compares route keys, not indices. */}
      {state.routes.filter((r) => !HIDDEN.has(r.name)).map((route) => {
        const focused = route.key === state.routes[state.index].key;
        const isSell = route.name === 'Sell';
        const isAsk = route.name === 'AskDevice';
        const Icon = ICONS[route.name];
        const onPress = () => {
          // «اطلب جهاز» opens a sheet over whatever you were doing — there is
          // no screen behind it, deliberately, so a buyer who was looking at
          // a listing does not lose it to post a request about it. Its tab
          // therefore never becomes focused.
          if (isAsk) { openCompose(); return; }
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (event.defaultPrevented) return;
          if (!focused) { navigation.navigate(route.name); return; }
          // Re-tapping the ACTIVE tab pops its stack to the root — the
          // standard bottom-nav behaviour, and previously a no-op. Without
          // it, a tab left on a nested page (a promo screen, a shop) had no
          // one-tap way home, and back would not pop it either.
          const tabState: any = route.state;
          if (tabState && tabState.index > 0) {
            navigation.dispatch({
              ...StackActions.popToTop(),
              target: tabState.key,
            });
          }
        };

        if (isSell) {
          // The Sell button has its own visual treatment: rounded ink pill
          // pulled up slightly above the row with a soft ink shadow.
          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              activeOpacity={0.85}
              style={{
                flex: 1,
                alignItems: 'center',
                marginTop: -8,
                marginBottom: -2,
                paddingVertical: 10,
                paddingHorizontal: 6,
                borderRadius: radius.xl,
                backgroundColor: theme.ink,
                shadowColor: '#1B1A18',
                shadowOpacity: 0.25,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
                gap: 3,
              }}
            >
              <Icon size={22} color={theme.buttonInk} sw={2} />
              <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ color: theme.buttonInk, fontFamily: fonts.arBold, fontSize: 10.5 }}>
                {LABELS()[route.name]}
              </Text>
            </TouchableOpacity>
          );
        }

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            activeOpacity={0.7}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 6,
              gap: 3,
            }}
          >
            <View>
              <Icon size={22} color={isAsk ? theme.accentDeep : focused ? theme.ink : theme.subtle} sw={isAsk ? 1.8 : 1.7} />
              {route.name === 'Requests' && requestsBadge ? (
                <View style={{
                  position: 'absolute', top: -5, left: -8, minWidth: 16, height: 16,
                  paddingHorizontal: 4, borderRadius: 999, backgroundColor: theme.accent,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1.5, borderColor: theme.surface,
                }}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 9, color: '#fff' }}>
                    {requestsBadge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
              fontFamily: focused || isAsk ? fonts.arBold : fonts.ar,
              fontSize: 10.5,
              // «اطلب جهاز» carries the accent even unfocused: it is the one
              // tab that never lights up (it opens a sheet, not a screen), so
              // without a resting colour it would read as permanently
              // inactive next to four tabs that do highlight.
              color: isAsk ? theme.accentDeep : focused ? theme.ink : theme.subtle,
            }}>
              {LABELS()[route.name] || route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
