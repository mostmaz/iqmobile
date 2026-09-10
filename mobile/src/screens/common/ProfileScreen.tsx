import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Img } from '../../components/Img';
import { CommonActions } from '@react-navigation/native';
import { navigationRef } from '../../navigation/ref';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { theme, fonts, radius, shadowAccent, FONT_SCALE_TIGHT } from '../../theme';
import { Header, Btn, fmtIQD } from '../../components/ui';
import { IconBell, IconPin, IconShield, IconID, IconClose, IconChevronLeft, IconTag, IconBookmark, IconStore, IconSpark, IconSearch, IconBox, IconChat, IconStar } from '../../components/icons';
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
  const [stats, setStats] = useState({ listings: 0, saved: null as number | null });

  useEffect(() => {
    if (!user) return;
    Listings.mine('all').then((rows) => setStats((s) => ({ ...s, listings: rows.length }))).catch(() => {});
    // The third tile is allowed to stay blank. A failed or slow count must
    // not hold up the two that already resolved, and «—» is a truthful
    // reading of "we do not know yet".
    Listings.saved().then((rows) => setStats((s) => ({ ...s, saved: rows.length }))).catch(() => {});
  }, [user]);

  // Balance sits on its own row with the number in place, so a seller who
  // was credited by the promotion sees it without having to go looking.
  //
  // Gated on SHOW_PROMOTE with the featuring flow it belongs to: balance is
  // earned by buying a promo tier and spent on featuring, so on a build where
  // featuring is hidden this row would advertise money with no way to earn it
  // and nowhere to spend it. Skip the fetch too — no point asking.
  //
  // MUST stay above the `if (!user)` return below. It used to sit further
  // down, next to the row it feeds, which meant logging out went from five
  // hooks to four in one render and React threw "Rendered fewer hooks than
  // expected" — a red screen on every logout. `enabled` does the gating a
  // conditional call cannot.
  const { data: wallet } = useQuery({
    queryKey: ['wallet'], queryFn: () => Wallet.get(), enabled: SHOW_PROMOTE && !!user,
  });

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

  /**
   * Three groups, not fourteen identical rows.
   *
   * The screen was a 26px title over a flat list where «إعلاناتي» and
   * «اللغة» carried exactly the same visual weight, so finding anything
   * meant reading all of it. Grouping by what the person came to DO — sell,
   * buy, or change the app — lets each group's first row be the one they
   * usually want, and that row is the only one in its group with an accent
   * icon tile.
   *
   * Every destination the flat list reached is still here. The handoff drew
   * nine rows across the three groups; the five it left out (wallet,
   * wishlist, shops, orders, notification settings) are live screens with
   * no other entry point, and dropping them would be a feature change
   * wearing a restyle's clothes.
   */
  interface Row { Icon: any; label: string; value?: string; dot?: boolean; onPress: () => void }
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: ar.profile.groupSell,
      rows: [
        { Icon: IconTag, label: ar.profile.listings, value: stats.listings ? String(stats.listings) : undefined, onPress: () => navigation.navigate('MyListings') },
        { Icon: IconStore, label: user.seller_type === 'shop' ? ar.profile.shopManage : ar.profile.shopRegister, onPress: () => navigation.navigate('ShopRegister') },
        { Icon: IconSpark, label: ar.profile.advertise, onPress: () => navigation.navigate('Advertise') },
        ...(SHOW_PROMOTE ? [{ Icon: IconSpark, label: ar.profile.wallet, value: `${fmtIQD(wallet?.balance ?? 0)} د.ع`, onPress: () => navigation.navigate('Wallet') }] : []),
      ],
    },
    {
      title: ar.profile.groupBuy,
      rows: [
        { Icon: IconBookmark, label: ar.profile.saved, value: stats.saved != null && stats.saved > 0 ? String(stats.saved) : undefined, onPress: () => navigation.navigate('Saved') },
        { Icon: IconBox, label: ar.profile.orders, onPress: () => navigation.navigate('MyOrders') },
        { Icon: IconSearch, label: ar.profile.savedSearches, onPress: () => navigation.navigate('SavedSearches') },
        { Icon: IconSpark, label: ar.profile.wishlist, onPress: () => navigation.navigate('Wishlist') },
        { Icon: IconStore, label: ar.profile.shops, onPress: () => navigation.navigate('Shops') },
      ],
    },
    {
      title: ar.profile.groupApp,
      rows: [
        { Icon: IconBell, label: ar.profile.notifications, onPress: () => navigation.navigate('Notifications') },
        { Icon: IconBell, label: 'إعدادات الإشعارات', onPress: () => navigation.navigate('NotificationSettings') },
        { Icon: IconID, label: ar.profile.edit, onPress: () => navigation.navigate('EditProfile') },
        { Icon: IconShield, label: ar.profile.how, onPress: () => navigation.navigate('HowItWorks') },
        { Icon: IconChat, label: 'اللغة / زمان', onPress: () => {
          Alert.alert('اللغة / زمان', undefined, [
            { text: 'العربية', onPress: () => { setLang('ar'); } },
            { text: 'کوردی', onPress: () => { setLang('ku'); } },
            { text: ar.chat.cancel, style: 'cancel' },
          ]);
        } },
      ],
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.title} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: tabClearance }}>
        {/* The whole card is the way into Edit Profile. The avatar keeps its
            own tap for the picker — a nested Touchable wins the gesture, so
            "change my photo" and "edit my details" stay one tap each. */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('EditProfile')}
          accessibilityRole="button"
          style={{
            backgroundColor: theme.surface, borderRadius: radius.xxxl, borderWidth: 1, borderColor: theme.line,
            padding: 16, marginBottom: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 13,
          }}
        >
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8} style={{
            width: 58, height: 58, borderRadius: radius.xxxl, backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...shadowAccent,
          }}>
            {user.profile_image_path ? (
              <Img source={{ uri: fullImageUrl(user.profile_image_path) }} style={{ width: 58, height: 58 }} />
            ) : (
              <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 22 }}>{initial}</Text>
            )}
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 7 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}>
                {user.display_name}
              </Text>
              {user.verified ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: radius.pill, backgroundColor: theme.successSoft, flexShrink: 0 }}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 10.5, color: theme.success }}>موثق</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontFamily: fonts.mono, fontSize: 11.5, color: theme.subtle, marginTop: 6, textAlign: 'right', writingDirection: 'ltr' }}>
              {user.phone}
            </Text>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <IconPin size={12} color={theme.subtle} />
              <Text style={{ fontFamily: fonts.arRegular, fontSize: 12, color: theme.subtle, textAlign: 'right' }}>
                {arOf(user.governorate)}{user.city ? ` · ${user.city}` : ''}
              </Text>
            </View>
          </View>
          <IconChevronLeft size={14} color={theme.subtle} sw={2} />
        </TouchableOpacity>

        <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: 16 }}>
          <StatTile value={String(stats.listings)} label={ar.profile.statListings} />
          <StatTile
            // Guard against legacy/malformed user rows where rating_count>0
            // but rating_avg is null — that combo previously crashed the
            // profile screen on `.toFixed`.
            value={user.rating_count > 0 && Number.isFinite(user.rating_avg as any)
              ? Number(user.rating_avg).toFixed(1)
              : '—'}
            label={`${user.rating_count} ${ar.profile.statRatings}`}
            star={user.rating_count > 0}
          />
          <StatTile value={stats.saved == null ? '—' : String(stats.saved)} label={ar.profile.saved} />
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

        {groups.map((g) => (
          <View key={g.title} style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: theme.subtle, textAlign: 'right', marginBottom: 7 }}>
              {g.title}
            </Text>
            {/* One card per group, `overflow:hidden` so the rows share its
                rounded corners instead of each carrying their own border.
                Fourteen separately-bordered rows was most of what made the
                old screen read as a wall. */}
            <View style={{
              backgroundColor: theme.surface, borderRadius: radius.xxl,
              borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
            }}>
              {g.rows.map((r, i) => (
                <TouchableOpacity
                  key={r.label}
                  activeOpacity={0.7}
                  onPress={r.onPress}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 13,
                    borderBottomWidth: i === g.rows.length - 1 ? 0 : 1,
                    borderBottomColor: theme.line,
                    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
                  }}
                >
                  {/* The first row of each group gets the accent tile. It is
                      the one a person opening that group usually wants, and
                      one accent per group is a pointer; accent on all of them
                      would be decoration. */}
                  <View style={{
                    width: 34, height: 34, borderRadius: 11,
                    backgroundColor: i === 0 ? theme.accentSoft : theme.chipBg,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <r.Icon size={17} color={i === 0 ? theme.accentDeep : theme.subtle} sw={1.7} />
                  </View>
                  <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right' }}>{r.label}</Text>
                  {r.value ? (
                    <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 12.5, color: theme.subtle, writingDirection: 'ltr' }}>
                      {r.value}
                    </Text>
                  ) : null}
                  {/* Drill-in, not back. In an RTL layout the forward
                      direction is leftward, so an unflipped left chevron
                      points the way the next screen arrives from. Back
                      buttons keep their scaleX flip — back really is
                      rightward here. */}
                  <IconChevronLeft size={14} color={theme.subtle} sw={2} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
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

function StatTile({ value, label, star }: { value: string; label: string; star?: boolean }) {
  return (
    <View style={{
      flex: 1, backgroundColor: theme.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: theme.line,
      paddingHorizontal: 8, paddingVertical: 12, alignItems: 'center',
    }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}>
        {star ? <IconStar size={13} filled color={theme.accent} /> : null}
        <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 18, color: theme.ink }}>{value}</Text>
      </View>
      <Text numberOfLines={1} style={{ fontFamily: fonts.arRegular, fontSize: 10.5, color: theme.subtle, marginTop: 2 }}>{label}</Text>
    </View>
  );
}
