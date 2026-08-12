// Store chats — buyer conversations with the storefront and the price book,
// answered from here.
//
// Neither shop's own login is ever signed in, so until this screen existed
// their chats were only reachable through the manager's personal account in
// the customer app. Replies sent from here are written AS the shop account:
// the buyer sees "IQ Mobile" answering, not whichever operator picked it up.
//
// List and thread in one screen, like ShopReview: an operator answering
// twenty leads doesn't want a navigation stack between them.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd } from '../theme';
import { api } from '../api/client';
import { ScreenHeader } from '../components/kit';

// Local rather than shared: the admin app has no relative-time helper yet,
// and one call site doesn't justify inventing a module for it.
function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.floor(h / 24);
  if (d < 30) return `قبل ${d} يوم`;
  return new Date(ts).toLocaleDateString('ar-IQ');
}

type ChatRow = {
  id: number; listing_id: number | null; buyer_id: number;
  last_message_at: number; created_at: number;
  buyer_name: string | null; buyer_phone: string | null;
  brand: string | null; model: string | null; asking_price: number | null;
  last_body: string | null; last_is_image: boolean;
  unread: number; seller_id: number; shop_name: string | null;
};
type Msg = {
  id: number; sender_id: number; body: string | null;
  image_path: string | null; created_at: number; sender_name: string;
};
type Thread = {
  chat: { id: number; created_at: number };
  buyer: { id: number; display_name: string; phone: string | null; governorate: string | null };
  listing: { id: number; brand: string; model: string; asking_price: number; status: string } | null;
  messages: Msg[];
};

export default function ChatsScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  // Deep-linked from the store.chat push with a chat_id; opens straight in.
  const [openId, setOpenId] = useState<number | null>(route?.params?.chat_id ?? null);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList>(null);

  const { data, refetch, isRefetching, isLoading } = useQuery({
    queryKey: ['store-chats'],
    queryFn: () => api<{ chats: ChatRow[]; unread_total: number }>('/admin/store/chats'),
    // Leads go stale in minutes, not hours — poll while the screen is up.
    refetchInterval: 20000,
  });

  const thread = useQuery({
    queryKey: ['store-chat', openId],
    queryFn: () => api<Thread>(`/admin/store/chats/${openId}`),
    enabled: openId !== null,
    refetchInterval: openId !== null ? 8000 : false,
  });

  // Opening a thread clears its unread count server-side; reflect that in
  // the list without waiting for the next poll.
  useEffect(() => {
    if (openId !== null && thread.data) void qc.invalidateQueries({ queryKey: ['store-chats'] });
  }, [openId, thread.data != null]);

  const send = useMutation({
    mutationFn: (body: string) =>
      api(`/admin/store/chats/${openId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: () => {
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['store-chat', openId] });
      void qc.invalidateQueries({ queryKey: ['store-chats'] });
    },
  });

  // ── thread view ──────────────────────────────────────────────────────
  if (openId !== null) {
    const t = thread.data;
    const shopId = data?.chats.find((c) => c.id === openId)?.seller_id;
    return (
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, backgroundColor: theme.bg }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <ScreenHeader
          title={t?.buyer?.display_name || '…'}
          subtitle={t?.listing
            ? `${t.listing.brand} ${t.listing.model} · ${iqd(t.listing.asking_price)} د.ع`
            : 'محادثة المتجر'}
          onBack={() => { setOpenId(null); setDraft(''); }}
        />
        {t?.buyer?.phone ? (
          <Text style={{
            fontFamily: fonts.mono, fontSize: 12, color: theme.subtle,
            textAlign: 'center', paddingVertical: 4, writingDirection: 'ltr',
          }}>
            {t.buyer.phone}{t.buyer.governorate ? `  ·  ${t.buyer.governorate}` : ''}
          </Text>
        ) : null}

        {thread.isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={t?.messages || []}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={{ padding: 12, gap: 6, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              // The shop's messages are "ours" here, whoever typed them.
              const mine = item.sender_id === shopId;
              return (
                <View style={{
                  alignSelf: mine ? 'flex-start' : 'flex-end',
                  maxWidth: '86%',
                  backgroundColor: mine ? theme.accentSoft : theme.surface,
                  borderWidth: mine ? 0 : 1, borderColor: theme.line,
                  borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8,
                }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right', lineHeight: 21 }}>
                    {item.body || (item.image_path ? '📷 صورة' : '')}
                  </Text>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 9.5, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
                    {mine ? 'المتجر' : item.sender_name} · {timeAgo(item.created_at)}
                  </Text>
                </View>
              );
            }}
          />
        )}

        <View style={{
          flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 12, paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: theme.surface, borderTopWidth: 1, borderColor: theme.line,
          alignItems: 'center',
        }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="الرد يظهر للزبون باسم المتجر…"
            placeholderTextColor={theme.subtle}
            multiline
            style={{
              flex: 1, backgroundColor: theme.bg, borderRadius: radius.lg,
              paddingHorizontal: 12, paddingVertical: 9, maxHeight: 100,
              fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right',
            }}
          />
          <TouchableOpacity
            onPress={() => draft.trim() && send.mutate(draft.trim())}
            disabled={!draft.trim() || send.isPending}
            style={{
              paddingHorizontal: 15, paddingVertical: 10, borderRadius: radius.lg,
              backgroundColor: draft.trim() ? theme.ink : theme.surfaceAlt,
            }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: draft.trim() ? theme.bg : theme.subtle }}>
              إرسال
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── list view ────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title="محادثات المتجر"
        subtitle={data ? `${data.chats.length} محادثة · ${data.unread_total} غير مقروءة` : undefined}
        onBack={() => navigation.goBack()}
      />
      <FlatList
        data={data?.chats || []}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 20 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : (
          <Text style={{ textAlign: 'center', padding: 30, color: theme.subtle, fontFamily: fonts.ar, fontSize: 13 }}>
            لا محادثات بعد. عندما يكتب زبون للمتجر أو يسأل عن سعر، تظهر هنا.
          </Text>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => setOpenId(item.id)}
            activeOpacity={0.8}
            style={{
              padding: 12, marginBottom: 8, borderRadius: radius.lg,
              backgroundColor: theme.surface,
              borderWidth: item.unread > 0 ? 1.5 : 1,
              borderColor: item.unread > 0 ? theme.accent : theme.line,
            }}
          >
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right' }}>
                {item.buyer_name || 'زبون'}
              </Text>
              {item.unread > 0 ? (
                <View style={{
                  minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 999,
                  backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: '#fff' }}>{item.unread}</Text>
                </View>
              ) : null}
              <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle }}>
                {timeAgo(item.last_message_at)}
              </Text>
            </View>
            <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, marginTop: 3, textAlign: 'right' }}>
              {item.brand ? `${item.brand} ${item.model} · ${iqd(item.asking_price || 0)} د.ع` : '—'}
              {item.shop_name ? `  ·  ${item.shop_name}` : ''}
            </Text>
            <Text numberOfLines={1} style={{
              fontFamily: item.unread > 0 ? fonts.arBold : fonts.ar,
              fontSize: 12.5, color: item.unread > 0 ? theme.ink : theme.subtle,
              marginTop: 4, textAlign: 'right',
            }}>
              {item.last_is_image ? '📷 صورة' : (item.last_body || 'لا رسائل بعد')}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
