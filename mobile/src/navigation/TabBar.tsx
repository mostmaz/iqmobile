// Bottom tab bar — matches the design: 5 icons, all SVG, with the
// center "Sell" button visually elevated (negative top margin + ink fill +
// rounded square) so it reads as the primary call to action without
// breaking the rhythm of the row.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StackActions } from '@react-navigation/native';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { IconHome, IconSearch, IconPlus, IconPerson, IconChat } from '../components/icons';
import { ar } from '../i18n/ar';

// Labels come from the live i18n dictionary — read per render, not at
// module scope, so the Arabic/Kurdish switch reaches the tab bar too.
const LABELS = (): Record<string, string> => ({
  Browse: ar.tabs.browse,
  Search: ar.tabs.search,
  Sell: ar.tabs.sell,
  Chats: ar.tabs.chats,
  Profile: ar.tabs.profile,
});

const ICONS: Record<string, (p: { size?: number; color?: string; sw?: number; filled?: boolean }) => React.ReactElement> = {
  Browse: IconHome,
  Search: IconSearch,
  Sell: IconPlus,
  Chats: IconChat,
  Profile: IconPerson,
};

// Auth gates removed: every user has a guest session, so all tabs are
// reachable directly. (We'll re-introduce gating once real signup is
// required for sellers — see /auth/upgrade flow.)
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
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
      {state.routes.map((route, idx) => {
        const focused = state.index === idx;
        const isSell = route.name === 'Sell';
        const Icon = ICONS[route.name];
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (event.defaultPrevented) return;
          if (!focused) { navigation.navigate(route.name); return; }
          // Re-tapping the ACTIVE tab pops its stack to the root — the
          // standard bottom-nav behaviour, and previously a no-op. Without
          // it, a tab left on a nested page (a promo screen, a shop) had no
          // one-tap way home, and back would not pop it either.
          const tabState: any = state.routes[idx].state;
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
            <Icon size={22} color={focused ? theme.ink : theme.subtle} sw={1.7} />
            <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
              fontFamily: focused ? fonts.arBold : fonts.ar,
              fontSize: 10.5,
              fontWeight: focused ? '600' : '500',
              color: focused ? theme.ink : theme.subtle,
            }}>
              {LABELS()[route.name] || route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
