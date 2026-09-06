// إعدادات الإشعارات — a settings screen, reached from حسابي.
//
// The preferences panel used to sit as the header of the notifications
// INBOX, which put a wall of switches between the user and the thing he
// opened the bell to read. Settings belong in settings: the inbox is for
// messages, this screen is for deciding which ones arrive.

import React from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../theme';
import { Header } from '../../components/ui';
import { useTabBarClearance } from '../../lib/tabBarClearance';
import { NotificationPreferencesPanel } from '../../components/NotificationPreferences';

export default function NotificationSettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const tabClearance = useTabBarClearance();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title="إعدادات الإشعارات" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: tabClearance }}>
        <NotificationPreferencesPanel />
      </ScrollView>
    </View>
  );
}
