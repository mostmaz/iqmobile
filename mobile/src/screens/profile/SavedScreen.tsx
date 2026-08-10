import React, { useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { theme, fonts } from '../../theme';
import { Btn, Header } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { EmptyState } from '../../components/EmptyState';
import { IconBookmark } from '../../components/icons';
import { ListingListSkeleton } from '../../components/Skeleton';
import { Listings } from '../../api/endpoints';
import { ar } from '../../i18n/ar';
import { useAuth } from '../../auth/AuthContext';

export default function SavedScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  // Saved listings are per-account. For a guest (no real account yet)
  // the server has nothing to return and would just 401 on every focus —
  // gate the query off so we don't log-spam and so the inline CTA below
  // can offer signup instead of an empty list.
  const isGuest = !user || !!user.is_guest;
  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['saved'],
    queryFn: () => Listings.saved(),
    enabled: !isGuest,
  });

  // Refresh on every tab focus so an unsave done from ListingDetail
  // doesn't leave a stale card sitting on this screen.
  useFocusEffect(useCallback(() => {
    if (!isGuest) qc.invalidateQueries({ queryKey: ['saved'] });
  }, [isGuest, qc]));

  async function unsave(id: number) {
    // Don't let a network/401 produce an unhandled rejection — toast the
    // failure so the user knows the action didn't take (the optimistic
    // refresh would otherwise quietly snap the card back).
    try {
      await Listings.unsave(id);
      qc.invalidateQueries({ queryKey: ['saved'] });
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    }
  }

  if (isGuest) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <Header title={ar.profile.saved} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, textAlign: 'center' }}>
            سجّل الدخول لحفظ الإعلانات
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'center', lineHeight: 22 }}>
            بعد التسجيل تظهر هنا كل الإعلانات التي حفظتها لمراجعتها لاحقاً.
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
      <Header title={ar.profile.saved} />
      <FlatList
        data={data || []}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            saved
            onPress={() => navigation.navigate('ListingDetail', { id: item.id })}
            onToggleSave={() => unsave(item.id)}
          />
        )}
        // Without the isLoading branch the "no favourites" copy flashed
        // during the first fetch — an outright wrong answer for a user
        // who does have saved listings.
        ListEmptyComponent={isLoading ? (
          <ListingListSkeleton count={4} />
        ) : (
          <EmptyState
            icon={<IconBookmark size={30} color={theme.subtle} sw={1.5} />}
            title="لا توجد مفضلات"
            body="اضغط علامة الحفظ على أي إعلان ليظهر هنا وتعود إليه لاحقاً."
            actionLabel="تصفّح الإعلانات"
            onAction={() => navigation.getParent()?.navigate('Browse')}
          />
        )}
      />
    </View>
  );
}
