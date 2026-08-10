import React from 'react';
import { View, Text, SectionList, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarClearance } from '../../lib/tabBarClearance';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Header } from '../../components/ui';
import { RowListSkeleton } from '../../components/Skeleton';
import { Notifications, type NotificationRow } from '../../api/endpoints';
import { timeAgoAr, dayBucketAr, deviceTitle } from '../../lib/format';
import { navigationRef } from '../../navigation/ref';
import { toLatinDigits } from '../../lib/format';
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
  'saved_search.match': 'إعلان جديد يطابق بحثك المحفوظ',
  'wishlist.match': 'جهاز من قائمة رغباتك متوفر 🎯',
  'price.drop': 'انخفض سعر إعلان تراقبه 🔻',
  // Storefront orders. Without these the inbox rendered the raw kind
  // ("order.confirmed") — the notifications were firing all along, they just
  // arrived looking like a bug.
  'order.placed': 'طلب جديد 🛒',
  'order.confirmed': 'تم تأكيد طلبك ✅',
  'order.shipped': 'طلبك في الطريق 🚚',
  'order.delivered': 'تم تسليم طلبك 🎉',
  'order.cancelled': 'أُلغي طلبك',
  'order.returned': 'تم تسجيل إرجاع طلبك',
};

// Compose the secondary line under the kind label: "<sender> · <listing>".
// Falls back gracefully when the server enrichment came back empty
// (chat deleted, listing removed, …) so the row never looks broken.
function subline(item: NotificationRow): string | null {
  // Order notifications carry their code in the payload but never showed it,
  // so "تم توصيل طلبك" never said WHICH order — useless to anyone with more
  // than one in flight.
  if (item.kind.startsWith('order.')) {
    const p = item.payload || {};
    const bits: string[] = [];
    if (p.code) bits.push(String(p.code));
    if (p.total) bits.push(`${Number(p.total).toLocaleString('en-US')} د.ع`);
    if (bits.length) return bits.join(' · ');
  }
  const cs = item.chat_summary;
  if (cs && (cs.other_name || cs.listing_label)) {
    const parts: string[] = [];
    if (cs.other_name) parts.push(cs.other_name);
    if (cs.listing_label) parts.push(cs.listing_label);
    return parts.join(' · ');
  }
  const ls = item.listing_summary;
  if (ls) return deviceTitle(ls.brand, ls.model);
  return null;
}

/** Rows split into "اليوم" / "أمس" / older, in the order the list arrives. */
function groupByDay(rows: NotificationRow[]) {
  const out: { day: string; rows: NotificationRow[] }[] = [];
  for (const r of rows) {
    const day = dayBucketAr(r.created_at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

export default function NotificationsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const tabClearance = useTabBarClearance();
  const qc = useQueryClient();
  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => Notifications.list(),
  });

  async function readAll() {
    await Notifications.readAll();
    qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  // Route the tap to the most useful destination:
  //   - chat.message (with chat_summary.chat_id) → open the Chat screen
  //     inside the Chats tab using the global navigation ref. The
  //     Chats tab is now visible (see navigation/index.tsx) — the
  //     previous version of this screen used ListingDetail as a
  //     fallback because the tab was hidden.
  //   - anything else with a listing_id → ListingDetail in the local stack
  //   - otherwise → just mark-read silently
  function onTap(item: NotificationRow) {
    Notifications.read(item.id);
    const chatId = item.chat_summary?.chat_id || item.payload?.chat_id;
    if (chatId) {
      if (navigationRef.isReady()) {
        navigationRef.navigate('Main', {
          screen: 'Chats',
          params: { screen: 'Chat', params: { id: chatId } },
        });
      }
      return;
    }
    // An order notification carries an order_id, not a listing — send the
    // customer to their orders list, which is the only screen that can
    // actually answer "where is my order".
    if (item.payload?.order_id || String(item.kind).startsWith('order.')) {
      navigation.navigate('MyOrders');
      return;
    }
    if (item.payload?.listing_id) {
      navigation.navigate('ListingDetail', { id: item.payload.listing_id });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title={ar.profile.notifications} onBack={() => navigation.goBack()} right={
        <TouchableOpacity onPress={readAll}><Text style={{ fontFamily: fonts.ar, color: theme.accent }}>قراءة الكل</Text></TouchableOpacity>
      } />
      <SectionList
        sections={groupByDay(data || []).map((g) => ({ title: g.day, data: g.rows }))}
        keyExtractor={(it) => String(it.id)}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 12, color: theme.subtle,
            textAlign: 'right', marginTop: 10, marginBottom: 6,
          }}>
            {section.title}
          </Text>
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: tabClearance }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        renderItem={({ item }) => {
          const sub = subline(item);
          return (
            <TouchableOpacity
              onPress={() => onTap(item)}
              activeOpacity={0.85}
              style={{
                padding: 12, marginBottom: 8, borderRadius: radius.lg,
                backgroundColor: item.read ? theme.surface : theme.accentSoft,
                borderWidth: 1, borderColor: item.read ? theme.line : theme.accent,
              }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
                {KIND_LABEL[item.kind] || item.kind}
              </Text>
              {sub ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.ink, marginTop: 3, textAlign: 'right' }}>
                  {sub}
                </Text>
              ) : null}
              {/* Was a raw absolute datetime with second precision —
                  "10/8/2026، 4:41:36 م" — while every other surface in the
                  app speaks in relative time. */}
              <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, marginTop: 4, textAlign: 'right' }}>
                {timeAgoAr(item.created_at)}
              </Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={isLoading ? (
          <RowListSkeleton count={5} avatar={38} />
        ) : (
          <Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar }}>لا توجد إشعارات</Text>
        )}
      />
    </View>
  );
}
