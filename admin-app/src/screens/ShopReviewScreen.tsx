// مراجعة المتاجر — approve or reject a shop registration, and talk to the owner.
//
// This workflow landed on the server while the app was being built, and it
// redefined what the queue's "متاجر جديدة" count means: it used to be shops
// registered in the last 7 days, and is now shops waiting on a decision.
// A count nobody can act on from the app is just a number, so this is the
// screen that resolves it.

import React, { useState } from 'react';
import {
  View, Text, FlatList, RefreshControl, Modal, TextInput,
  TouchableOpacity, ScrollView, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, ChipRow, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';

type ReviewShop = {
  id: number; shop_name: string | null; display_name?: string | null;
  phone?: string | null; shop_phone?: string | null;
  governorate?: string | null; city?: string | null;
  shop_bio?: string | null; shop_address?: string | null;
  shop_status: string; shop_review_note: string | null;
  shop_reviewed_at: number | null; shop_created_at: number | null;
  listing_count?: number;
};
type Message = { id: number; author: string; body: string; created_at: number };

const STATUSES = [
  { key: 'pending', label: 'بانتظار المراجعة' },
  { key: 'approved', label: 'مقبولة' },
  { key: 'rejected', label: 'مرفوضة' },
] as const;

export default function ShopReviewScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('pending');
  const [thread, setThread] = useState<ReviewShop | null>(null);

  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['shop-review', status],
    queryFn: () => api<{ status: string; shops: ReviewShop[]; counts: any }>(
      `/admin/shops/review?status=${status}`,
    ),
  });

  const decide = useMutation({
    mutationFn: ({ id, next, note }: { id: number; next: string; note?: string }) =>
      api(`/admin/shops/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, ...(note ? { note } : {}) }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop-review'] });
      qc.invalidateQueries({ queryKey: ['work-queue'] });
    },
    onError: () => Alert.alert('تعذّر التحديث', 'لم يتغيّر وضع المتجر.'),
  });

  const rows = data?.shops || [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title="مراجعة المتاجر"
        subtitle={rows.length ? `${rows.length}` : undefined}
        onBack={() => navigation.goBack()}
      />
      <ChipRow options={STATUSES as any} value={status} onChange={setStatus} />

      <FlatList
        data={rows}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError ? error : false}
            empty={!isLoading && !isError}
            emptyText={status === 'pending' ? 'لا متاجر بانتظار المراجعة.' : 'لا متاجر في هذه الحالة.'}
            onRetry={refetch} />
        }
        renderItem={({ item: s }) => {
          const phone = s.shop_phone || s.phone;
          return (
            <Card>
              <Title>{s.shop_name || s.display_name || '—'}</Title>
              <Meta>{[s.governorate, s.city].filter(Boolean).join(' · ') || '—'}</Meta>
              <Meta>{phone || 'بدون رقم'}{s.listing_count != null ? ` · ${s.listing_count} إعلان` : ''}</Meta>
              {s.shop_address ? <Meta>{s.shop_address}</Meta> : null}
              {s.shop_bio ? (
                <Text numberOfLines={3} style={{
                  fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
                  textAlign: 'right', marginTop: 6, lineHeight: 19,
                }}>
                  {s.shop_bio}
                </Text>
              ) : null}
              {s.shop_review_note ? (
                <Text style={{
                  fontFamily: fonts.ar, fontSize: 12, color: theme.warn,
                  textAlign: 'right', marginTop: 6, lineHeight: 18,
                }}>
                  ملاحظة سابقة: {s.shop_review_note}
                </Text>
              ) : null}

              <ActionRow>
                {phone ? (
                  <Action label="اتصال" tone="ok" onPress={() => Linking.openURL(`tel:${phone}`).catch(() => {})} />
                ) : null}
                <Action label="مراسلة" onPress={() => setThread(s)} />
              </ActionRow>

              {s.shop_status !== 'approved' || s.shop_status === 'approved' ? (
                <ActionRow>
                  {s.shop_status !== 'approved' ? (
                    <Action
                      label="قبول"
                      tone="primary"
                      busy={decide.isPending}
                      confirm={{ title: 'قبول المتجر؟', body: s.shop_name || '' }}
                      onPress={() => decide.mutate({ id: s.id, next: 'approved' })}
                    />
                  ) : null}
                  {s.shop_status !== 'rejected' ? (
                    <Action
                      label="رفض"
                      tone="danger"
                      busy={decide.isPending}
                      confirm={{ title: 'رفض المتجر؟', body: 'يمكن إعادته للمراجعة لاحقاً.' }}
                      onPress={() => decide.mutate({ id: s.id, next: 'rejected' })}
                    />
                  ) : null}
                  {s.shop_status !== 'pending' ? (
                    <Action
                      label="إعادة للمراجعة"
                      busy={decide.isPending}
                      onPress={() => decide.mutate({ id: s.id, next: 'pending' })}
                    />
                  ) : null}
                </ActionRow>
              ) : null}
            </Card>
          );
        }}
      />

      <Thread shop={thread} onClose={() => setThread(null)} />
    </View>
  );
}

// ─── the conversation with the shop owner ────────────────────────────
function Thread({ shop, onClose }: { shop: ReviewShop | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['shop-review-thread', shop?.id],
    queryFn: () => api<{ shop: ReviewShop; messages: Message[] }>(`/admin/shops/${shop!.id}/review`),
    enabled: !!shop,
  });

  const send = useMutation({
    mutationFn: (text: string) =>
      api(`/admin/shops/${shop!.id}/review/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      }),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['shop-review-thread', shop?.id] });
    },
    onError: () => Alert.alert('تعذّر الإرسال', 'لم تُرسل الرسالة.'),
  });

  const messages = data?.messages || [];

  return (
    <Modal visible={!!shop} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
          paddingHorizontal: 16, paddingVertical: 12,
          borderBottomWidth: 1, borderBottomColor: theme.line,
        }}>
          <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'right' }}>
            {shop?.shop_name || '—'}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="إغلاق"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 22, color: theme.subtle }}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {isLoading ? (
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', paddingVertical: 30 }}>
              …
            </Text>
          ) : messages.length === 0 ? (
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', paddingVertical: 30 }}>
              لا رسائل بعد. اكتب للمالك ما ينقص طلبه.
            </Text>
          ) : messages.map((m) => {
            const mine = m.author === 'admin';
            return (
              <View
                key={m.id}
                style={{
                  alignSelf: mine ? 'flex-start' : 'flex-end',
                  maxWidth: '85%', marginBottom: 8,
                  backgroundColor: mine ? theme.accentSoft : theme.surface,
                  borderRadius: radius.lg, borderWidth: 1,
                  borderColor: mine ? theme.accent : theme.line,
                  paddingHorizontal: 13, paddingVertical: 10,
                }}
              >
                <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right', lineHeight: 20 }}>
                  {m.body}
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 10, color: theme.faint, textAlign: 'right', marginTop: 4 }}>
                  {mine ? 'الإدارة' : 'المتجر'}
                </Text>
              </View>
            );
          })}
        </ScrollView>

        <View style={{
          flexDirection: 'row-reverse', gap: 8,
          paddingHorizontal: 16, paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 12),
          borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.surface,
        }}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="اكتب رسالة للمالك…"
            placeholderTextColor={theme.faint}
            multiline
            style={{
              flex: 1, backgroundColor: theme.bg, borderRadius: radius.lg,
              borderWidth: 1, borderColor: theme.line,
              paddingHorizontal: 13, paddingVertical: 10, maxHeight: 110,
              fontSize: 14.5, color: theme.ink, textAlign: 'right',
            }}
          />
          <TouchableOpacity
            disabled={!body.trim() || send.isPending}
            onPress={() => send.mutate(body.trim())}
            style={{
              paddingHorizontal: 18, borderRadius: radius.lg, justifyContent: 'center',
              backgroundColor: theme.accent, opacity: body.trim() && !send.isPending ? 1 : 0.45,
            }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: '#fff' }}>إرسال</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
