import React from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Header } from '../../components/ui';
import { Notifications } from '../../api/endpoints';
import { ar } from '../../i18n/ar';

const KIND_LABEL: Record<string, string> = {
  'chat.message': 'رسالة جديدة',
  'deal.proposed': 'سعر نهائي مقترح',
  'deal.buyer_accepted': 'وافق المشتري على السعر',
  'deal.seller_confirmed': 'صفقة مؤكدة',
  'deal.counter_offer': 'عرض مضاد',
  'deal.cancelled': 'تم إلغاء الصفقة',
  'deal.rejected': 'تم رفض السعر',
  'phone.unlocked': 'تم فتح رقم البائع',
  'rating.received': 'وصلك تقييم جديد',
  'listing.expired': 'انتهى إعلانك',
};

export default function NotificationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => Notifications.list(),
  });

  async function readAll() {
    await Notifications.readAll();
    qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.notifications} onBack={() => navigation.goBack()} right={
        <TouchableOpacity onPress={readAll}><Text style={{ fontFamily: fonts.ar, color: theme.accent }}>قراءة الكل</Text></TouchableOpacity>
      } />
      <FlatList
        data={data || []}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => {
            Notifications.read(item.id);
            if (item.payload?.chat_id) navigation.navigate('Chat', { id: item.payload.chat_id });
          }} style={{ padding: 12, marginBottom: 8, borderRadius: radius.lg, backgroundColor: item.read ? theme.surface : theme.accentSoft, borderWidth: 1, borderColor: item.read ? theme.line : theme.accent }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, fontWeight: '600', textAlign: 'right' }}>
              {KIND_LABEL[item.kind] || item.kind}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, marginTop: 2, textAlign: 'right' }}>
              {new Date(item.created_at).toLocaleString('ar')}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar }}>لا توجد إشعارات</Text>}
      />
    </View>
  );
}
