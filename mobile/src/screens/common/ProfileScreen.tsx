import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, Alert } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { navigationRef } from '../../navigation/ref';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { theme, fonts, radius } from '../../theme';
import { Header, FieldLabel, Btn } from '../../components/ui';
import { IconBell, IconPin, IconShield, IconID, IconClose, IconChevronLeft, IconStar, IconTag } from '../../components/icons';
import { Listings, Deals } from '../../api/endpoints';
import { uploadProfileImage, fullImageUrl } from '../../api/upload';
import { compressForChat } from '../../lib/imageCompress';
import { arOf } from '../../lib/governorates';
import { ar } from '../../i18n/ar';

export default function ProfileScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user, logout, refresh } = useAuth();
  const [stats, setStats] = useState({ listings: 0, deals: 0 });

  useEffect(() => {
    if (!user) return;
    Promise.all([
      Listings.mine('all').then((rows) => rows.length).catch(() => 0),
      Deals.mine(undefined, 'seller_confirmed').then((rows) => rows.length).catch(() => 0),
    ]).then(([listings, deals]) => setStats({ listings, deals }));
  }, [user]);

  // Logged-out state. Happens after explicit logout if the user cancels the
  // AuthGate modal without entering a phone. Show a clear CTA back to the
  // sign-in screen instead of leaving a blank tab.
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <Header title={ar.profile.title} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, textAlign: 'center', fontWeight: '700' }}>
            لم تسجّل الدخول
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', lineHeight: 21 }}>
            سجّل الدخول برقم هاتفك للوصول إلى حسابك وإعلاناتك.
          </Text>
          <View style={{ marginTop: 12, alignSelf: 'stretch' }}>
            <Btn kind="accent" full onPress={() => navigation.getParent()?.getParent()?.navigate('AuthGate')}>
              تسجيل الدخول
            </Btn>
          </View>
        </View>
      </View>
    );
  }
  const initial = user.display_name?.[0] || '?';

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1, allowsEditing: true,
    });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    try {
      const compressed = await compressForChat(r.assets[0].uri);
      await uploadProfileImage(compressed);
      await refresh();
    } catch (e: any) { Alert.alert('خطأ', e.message); }
  }

  const items: { Icon: any; label: string; onPress: () => void }[] = [
    { Icon: IconTag, label: ar.profile.listings, onPress: () => navigation.navigate('MyListings') },
    { Icon: IconStar, label: ar.profile.deals, onPress: () => navigation.navigate('Deals') },
    { Icon: IconBell, label: ar.profile.notifications, onPress: () => navigation.navigate('Notifications') },
    { Icon: IconID, label: ar.profile.edit, onPress: () => navigation.navigate('EditProfile') },
    { Icon: IconShield, label: 'كيف يعمل التطبيق', onPress: () => navigation.navigate('HowItWorks') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.title} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}>
        <View style={{
          backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
          padding: 16, marginBottom: 14, flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
        }}>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8} style={{ width: 56, height: 56, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {user.profile_image_path ? (
              <Image source={{ uri: fullImageUrl(user.profile_image_path) }} style={{ width: 56, height: 56 }} />
            ) : (
              <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontWeight: '700', fontSize: 22 }}>{initial}</Text>
            )}
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 17, color: theme.ink, textAlign: 'right' }}>
              {user.display_name}
            </Text>
            <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: theme.subtle, marginTop: 6, textAlign: 'right', writingDirection: 'ltr' }}>
              {user.phone}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, marginTop: 2, textAlign: 'right' }}>
              {arOf(user.governorate)}{user.city ? ` · ${user.city}` : ''}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: 14 }}>
          <StatTile value={String(stats.listings)} label="إعلان" />
          <StatTile value={String(stats.deals)} label="صفقة" />
          <StatTile value={user.rating_count > 0 ? user.rating_avg.toFixed(1) : '—'} label={`${user.rating_count} تقييم`} />
        </View>

        <FieldLabel>القوائم</FieldLabel>
        {items.map((s, i) => (
          <TouchableOpacity
            key={i}
            activeOpacity={0.7}
            onPress={s.onPress}
            style={{
              backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
              paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
              flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
            }}
          >
            <s.Icon size={18} color={theme.subtle} sw={1.7} />
            <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 14, color: theme.ink, fontWeight: '500', textAlign: 'right' }}>{s.label}</Text>
            <View style={{ transform: [{ scaleX: -1 }] }}><IconChevronLeft size={14} color={theme.subtle} sw={2} /></View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          onPress={async () => {
            // Clear the session first.
            await logout();
            // Navigate to the AuthGate modal at the Root navigator level.
            // We try three paths in order, because depending on the React
            // Navigation version + nesting depth, one of these reliably
            // works while the others may silently no-op:
            //   1. Local nav prop, walk up two parents (ProfileStack →
            //      MainTabs → Root) and dispatch a CommonActions.navigate.
            //   2. Same walk but using .navigate() directly.
            //   3. Global navigationRef as a last resort.
            const root = navigation.getParent()?.getParent?.();
            if (root) {
              root.dispatch(CommonActions.navigate({ name: 'AuthGate' }));
            } else if (navigationRef.isReady()) {
              navigationRef.dispatch(CommonActions.navigate({ name: 'AuthGate' }));
            }
          }}
          activeOpacity={0.7}
          style={{
            marginTop: 14, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: theme.surface,
            borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
            flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
          }}
        >
          <IconClose size={18} color={theme.danger} sw={1.7} />
          <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.danger, fontWeight: '500' }}>{ar.auth.logout}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={{
      flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
      paddingHorizontal: 8, paddingVertical: 12, alignItems: 'center',
    }}>
      <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 17, color: theme.ink }}>{value}</Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle, marginTop: 2 }}>{label}</Text>
    </View>
  );
}
