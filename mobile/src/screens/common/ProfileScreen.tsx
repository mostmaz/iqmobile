import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Img } from '../../components/Img';
import { CommonActions } from '@react-navigation/native';
import { navigationRef } from '../../navigation/ref';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { theme, fonts, radius } from '../../theme';
import { Header, FieldLabel, Btn, fmtIQD } from '../../components/ui';
import { IconBell, IconPin, IconShield, IconID, IconClose, IconChevronLeft, IconTag, IconBookmark, IconStore, IconSpark, IconSearch, IconBox, IconChat } from '../../components/icons';
import { Auth, Listings, Wallet } from '../../api/endpoints';
import { uploadProfileImage, fullImageUrl } from '../../api/upload';
import { compressForAvatar } from '../../lib/imageCompress';
import { useTabBarClearance } from '../../lib/tabBarClearance';
import { arOf } from '../../lib/governorates';
import { SHOW_PROMOTE } from '../../config/flags';
import { ar, setLang, getLang } from '../../i18n/ar';

export default function ProfileScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const tabClearance = useTabBarClearance();
  const { user, logout, refresh } = useAuth();
  const [stats, setStats] = useState({ listings: 0 });

  useEffect(() => {
    if (!user) return;
    Listings.mine('all').then((rows) => setStats({ listings: rows.length })).catch(() => {});
  }, [user]);

  // Logged-out state. Happens after explicit logout if the user cancels the
  // AuthGate modal without entering a phone. Show a clear CTA back to the
  // sign-in screen instead of leaving a blank tab.
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <Header title={ar.profile.title} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, textAlign: 'center' }}>
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
      const compressed = await compressForAvatar(r.assets[0].uri);
      await uploadProfileImage(compressed);
      await refresh();
    } catch (e: any) { Alert.alert('خطأ', e.message); }
  }

  // Balance sits on its own row with the number in place, so a seller who
  // was credited by the promotion sees it without having to go looking.
  //
  // Gated on SHOW_PROMOTE with the featuring flow it belongs to: balance is
  // earned by buying a promo tier and spent on featuring, so on a build where
  // featuring is hidden this row would advertise money with no way to earn it
  // and nowhere to spend it. Skip the fetch too — no point asking.
  const { data: wallet } = useQuery({
    queryKey: ['wallet'], queryFn: () => Wallet.get(), enabled: SHOW_PROMOTE,
  });

  const items: { Icon: any; label: string; value?: string; onPress: () => void }[] = [
    ...(SHOW_PROMOTE ? [{ Icon: IconSpark, label: ar.profile.wallet, value: `${fmtIQD(wallet?.balance ?? 0)} د.ع`, onPress: () => navigation.navigate('Wallet') }] : []),
    { Icon: IconTag, label: ar.profile.listings, onPress: () => navigation.navigate('MyListings') },
    { Icon: IconBox, label: ar.profile.orders, onPress: () => navigation.navigate('MyOrders') },
    { Icon: IconBookmark, label: ar.profile.saved, onPress: () => navigation.navigate('Saved') },
    { Icon: IconSearch, label: ar.profile.savedSearches, onPress: () => navigation.navigate('SavedSearches') },
    { Icon: IconSpark, label: ar.profile.wishlist, onPress: () => navigation.navigate('Wishlist') },
    { Icon: IconStore, label: ar.profile.shops, onPress: () => navigation.navigate('Shops') },
    { Icon: IconStore, label: user.seller_type === 'shop' ? ar.profile.shopManage : ar.profile.shopRegister, onPress: () => navigation.navigate('ShopRegister') },
    { Icon: IconSpark, label: ar.profile.advertise, onPress: () => navigation.navigate('Advertise') },
    { Icon: IconBell, label: ar.profile.notifications, onPress: () => navigation.navigate('Notifications') },
    { Icon: IconID, label: ar.profile.edit, onPress: () => navigation.navigate('EditProfile') },
    { Icon: IconShield, label: ar.profile.how, onPress: () => navigation.navigate('HowItWorks') },
    { Icon: IconChat, label: 'اللغة / زمان', onPress: () => {
      Alert.alert('اللغة / زمان', undefined, [
        { text: 'العربية', onPress: () => { setLang('ar'); } },
        { text: 'کوردی', onPress: () => { setLang('ku'); } },
        { text: ar.chat.cancel, style: 'cancel' },
      ]);
    } },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.title} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: tabClearance }}>
        <View style={{
          backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
          padding: 16, marginBottom: 14, flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
        }}>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8} style={{ width: 56, height: 56, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {user.profile_image_path ? (
              <Img source={{ uri: fullImageUrl(user.profile_image_path) }} style={{ width: 56, height: 56 }} />
            ) : (
              <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 22 }}>{initial}</Text>
            )}
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}>
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
          <StatTile value={String(stats.listings)} label={ar.profile.statListings} />
          <StatTile
            // Guard against legacy/malformed user rows where rating_count>0
            // but rating_avg is null — that combo previously crashed the
            // profile screen on `.toFixed`.
            value={user.rating_count > 0 && Number.isFinite(user.rating_avg as any)
              ? Number(user.rating_avg).toFixed(1)
              : '—'}
            label={`${user.rating_count} ${ar.profile.statRatings}`}
          />
        </View>

        {/* Guest banner — guests see a prominent "sign in" CTA so they
            can upgrade their auto-provisioned session to a real account
            without hunting for it. Hidden for real users (they already
            see the logout/delete row below). Navigates via Root nav
            since AuthGate lives at the root (Main / AuthGate) level. */}
        {user.is_guest ? (
          <TouchableOpacity
            onPress={() => navigation.getParent()?.getParent()?.navigate('AuthGate')}
            activeOpacity={0.85}
            style={{
              backgroundColor: theme.accent, borderRadius: radius.lg,
              paddingHorizontal: 14, paddingVertical: 14, marginBottom: 14,
              flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
            }}
          >
            <IconID size={20} color="#fff" sw={1.8} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: '#fff', textAlign: 'right' }}>
                {ar.auth.login}
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 2, textAlign: 'right' }}>
                سجّل دخولك للاحتفاظ بإعلاناتك ومحادثاتك.
              </Text>
            </View>
            <IconChevronLeft size={14} color="#fff" sw={2} />
          </TouchableOpacity>
        ) : null}

        <FieldLabel>{ar.profile.lists}</FieldLabel>
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
            <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right' }}>{s.label}</Text>
            {s.value ? (
              <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 13.5, color: theme.accentDeep, writingDirection: 'ltr' }}>
                {s.value}
              </Text>
            ) : null}
{/* Drill-in, not back. In an RTL layout the forward direction is
                leftward, so an unflipped left chevron points the way the next
                screen arrives from. Back buttons keep their scaleX flip —
                back really is rightward here. */}
            <IconChevronLeft size={14} color={theme.subtle} sw={2} />
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
          <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.danger }}>{ar.auth.logout}</Text>
        </TouchableOpacity>

        {/* Account deletion — required by Play Store + App Store policy.
            Double confirmation (two-stage Alert) because it's irreversible:
            the first confirms intent, the second is the actual destructive
            tap. Modeled after how WhatsApp / Telegram handle it. */}
        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              'حذف الحساب',
              'سيتم حذف حسابك وجميع إعلاناتك وصورك نهائياً. لا يمكن التراجع عن هذا الإجراء.',
              [
                { text: 'إلغاء', style: 'cancel' },
                {
                  text: 'متابعة الحذف',
                  style: 'destructive',
                  onPress: () => {
                    // Second confirmation — last chance to abort.
                    Alert.alert(
                      'هل أنت متأكد تماماً؟',
                      'سنحذف بياناتك من خوادمنا الآن. اضغط "حذف" للتأكيد.',
                      [
                        { text: 'إلغاء', style: 'cancel' },
                        {
                          text: 'حذف',
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await Auth.deleteMe();
                              // Server is done. Clear local session +
                              // bounce to the AuthGate, same flow as logout.
                              await logout();
                            } catch (e: any) {
                              Alert.alert('خطأ', e?.message || 'فشل الحذف');
                            }
                          },
                        },
                      ],
                    );
                  },
                },
              ],
            );
          }}
          activeOpacity={0.7}
          style={{
            marginTop: 8, paddingHorizontal: 14, paddingVertical: 14,
            backgroundColor: 'rgba(180,58,46,0.06)',
            borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(180,58,46,0.25)',
            flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
          }}
        >
          <IconClose size={18} color={theme.danger} sw={1.7} />
          <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.danger }}>
            {ar.profile.deleteAccount}
          </Text>
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
