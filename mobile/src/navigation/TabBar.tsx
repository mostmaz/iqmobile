// Bottom tab bar — matches the design: 5 icons, all SVG, with the
// center "Sell" button visually elevated (negative top margin + ink fill +
// rounded square) so it reads as the primary call to action without
// breaking the rhythm of the row.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { theme, fonts, radius } from '../theme';
import { IconHome, IconBookmark, IconPlus, IconPerson } from '../components/icons';

const LABELS: Record<string, string> = {
  Browse: 'تصفح',
  Saved: 'المفضلة',
  Sell: 'بيع',
  Profile: 'حسابي',
};

const ICONS: Record<string, (p: { size?: number; color?: string; sw?: number; filled?: boolean }) => React.ReactElement> = {
  Browse: IconHome,
  Saved: IconBookmark,
  Sell: IconPlus,
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
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
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
              <Text style={{ color: theme.buttonInk, fontFamily: fonts.arBold, fontSize: 10.5, fontWeight: '700' }}>
                {LABELS[route.name]}
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
            <Icon size={22} color={focused ? theme.ink : theme.subtle} sw={1.7} filled={focused && route.name === 'Saved'} />
            <Text style={{
              fontFamily: focused ? fonts.arBold : fonts.ar,
              fontSize: 10.5,
              fontWeight: focused ? '600' : '500',
              color: focused ? theme.ink : theme.subtle,
            }}>
              {LABELS[route.name] || route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
