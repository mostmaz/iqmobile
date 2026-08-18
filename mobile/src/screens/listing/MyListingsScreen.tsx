import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { theme, fonts } from '../../theme';
import { Btn, Header, Pill } from '../../components/ui';
import { IconSpark, IconTag } from '../../components/icons';
import { ListingCard } from '../../components/ListingCard';
import { EmptyState } from '../../components/EmptyState';
import { ListingListSkeleton } from '../../components/Skeleton';
import { SHOW_PROMOTE } from '../../config/flags';
import { Listings, type ListingStatus } from '../../api/endpoints';
import { ar } from '../../i18n/ar';
import { useAuth } from '../../auth/AuthContext';

const TABS: Array<{ key: 'all' | ListingStatus; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'active', label: ar.listing.active },
  { key: 'reserved', label: ar.listing.reserved },
  { key: 'sold', label: ar.listing.sold },
  { key: 'expired', label: ar.listing.expired },
];

export default function MyListingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<'all' | ListingStatus>('all');
  // "My listings" is per-account — for a guest there's nothing to list
  // and the server would just 401 on every focus. Gate the query off
  // so we don't spam logs and so we can show a sign-in CTA below.
  const isGuest = !user || !!user.is_guest;
  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['mine', tab],
    queryFn: () => Listings.mine(tab),
    enabled: !isGuest,
  });

  // Refresh on every focus so marking a listing as sold/reserved from
  // ListingDetail reflects here without forcing a pull-to-refresh.
  useFocusEffect(useCallback(() => {
    if (!isGuest) qc.invalidateQueries({ queryKey: ['mine'] });
  }, [isGuest, qc]));

  if (isGuest) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <Header title={ar.profile.listings} onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, textAlign: 'center' }}>
            سجّل الدخول لرؤية إعلاناتك
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'center', lineHeight: 22 }}>
            بعد التسجيل تظهر هنا كل إعلاناتك ويمكنك تعديلها أو تحديدها كمباع.
          </Text>
          <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
            <Btn kind="accent" full onPress={() => (navigation as any).getParent()?.getParent?.()?.navigate('AuthGate')}>
              تسجيل الدخول
            </Btn>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.listings} onBack={() => navigation.goBack()} />
      <View style={{ paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => <Pill key={t.key} active={tab === t.key} onPress={() => setTab(t.key)}>{t.label}</Pill>)}
      </View>
      <FlatList
        data={data || []}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => {
          const featured = !!(item.featured_until && item.featured_until > Date.now());
          const canFeature = SHOW_PROMOTE && (item.status === 'active' || item.status === 'reserved');
          return (
            <View>
              <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
              {/* Engagement at a glance — views lead (the headline metric),
                  then contacts and saves. Only shown once the server has
                  attached stats (GET /listings/mine). */}
              {item.stats ? (
                <View style={{
                  marginTop: -6, marginBottom: 12, flexDirection: 'row-reverse',
                  alignItems: 'center', gap: 14, paddingHorizontal: 6,
                }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                    👁 {item.stats.views.toLocaleString('en-US')} مشاهدة
                  </Text>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                    📞 {item.stats.contacts.toLocaleString('en-US')} تواصل
                  </Text>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                    🔖 {item.stats.saves.toLocaleString('en-US')} حفظ
                  </Text>
                </View>
              ) : null}
              {SHOW_PROMOTE && featured ? (
                <View style={{ marginTop: -4, marginBottom: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
                  <IconSpark size={12} color={theme.accent} />
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.accent }}>
                    إعلان مميّز حتى {new Date(item.featured_until as number).toLocaleDateString('en-GB')}
                  </Text>
                </View>
              ) : canFeature ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('FeatureListing', { id: item.id, label: `${item.brand} ${item.model}` })}
                  style={{
                    marginTop: -4, marginBottom: 12, alignSelf: 'flex-end',
                    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
                    backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: theme.accent,
                    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
                  }}
                >
                  <IconSpark size={13} color={theme.accent} />
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.accentDeep }}>ميّز إعلانك</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        }}
        // Each status tab is its own query key, so switching tabs is a
        // cold fetch — skeletons here also cover the tab switch instead
        // of flashing "no listings" at a seller who has plenty.
        ListEmptyComponent={isLoading ? (
          <ListingListSkeleton count={4} />
        ) : (
          <EmptyState
            icon={<IconTag size={30} color={theme.subtle} sw={1.5} />}
            title="لا توجد إعلانات بعد"
            body="انشر جهازك خلال دقيقة — صور، سعر، ورقم للتواصل."
            actionLabel="أضف إعلاناً"
            onAction={() => navigation.getParent()?.navigate('Sell')}
          />
        )}
      />
    </View>
  );
}
