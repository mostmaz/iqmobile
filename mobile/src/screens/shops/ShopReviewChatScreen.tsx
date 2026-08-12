// The shop owner's conversation with the admins about his own shop.
//
// Deliberately shaped like a normal chat thread rather than a form: the
// operator writes "the shopfront photo is unreadable, send a clearer one",
// and the owner needs to answer that in the place he already answers
// messages. It is reached from المحادثات, pinned above the buyer threads.
//
// It is NOT a row in `chats`. That table requires a listing_id and is keyed
// UNIQUE(listing_id, buyer_id), so an admin talking to a shop about the shop
// itself has nowhere to sit — the messages live in shop_review_messages.

import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { IconChevronLeft } from '../../components/icons';
import { Shops, type ShopReviewMessage } from '../../api/endpoints';
import { timeAgoAr } from '../../lib/format';
import { useKeyboardHeight, bottomBarPadding } from '../../lib/useKeyboard';

const STATUS: Record<string, { label: string; body: string; tone: string }> = {
  pending: {
    label: 'متجرك قيد المراجعة',
    body: 'إعلاناتك منشورة وتبيع بشكل طبيعي. ما ينتظر الموافقة هو ظهور المتجر في دليل المتاجر.',
    tone: theme.accent,
  },
  rejected: {
    label: 'لم يتم قبول المتجر',
    body: 'راجع ملاحظات الإدارة أدناه، عدّل ما يلزم، ثم ردّ هنا لإعادة المراجعة.',
    tone: theme.danger,
  },
  approved: {
    label: 'متجرك مقبول ✅',
    body: 'متجرك ظاهر الآن في دليل المتاجر.',
    tone: theme.success,
  },
};

export default function ShopReviewChatScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['shop-review'],
    queryFn: () => Shops.myReview(),
    retry: false,
  });

  // Opening the thread marks the admin side read, so refetch on focus to
  // clear the unread pip on the chat list behind us.
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const send = useMutation({
    mutationFn: (text: string) => Shops.sendReviewMessage(text),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['shop-review'] });
    },
  });

  const status = data?.status || 'pending';
  const meta = STATUS[status] || STATUS.pending;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: theme.bg }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 10,
        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
        borderBottomWidth: 1, borderBottomColor: theme.line, backgroundColor: theme.surface,
      }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}
        >
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconChevronLeft size={20} color={theme.ink} sw={2} />
          </View>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'right' }}>
            إدارة iQ Mobile
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right' }}>
            مراجعة المتجر
          </Text>
        </View>
      </View>

      {/* Status first: the answer to "where am I" should not require reading
          a conversation. */}
      <View style={{
        marginHorizontal: 14, marginTop: 12, padding: 12, borderRadius: radius.lg,
        borderWidth: 1.5, borderColor: meta.tone, backgroundColor: theme.surface,
      }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: meta.tone, textAlign: 'right' }}>
          {meta.label}
        </Text>
        <Text style={{
          fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
          textAlign: 'right', marginTop: 5, lineHeight: 20,
        }}>
          {meta.body}
        </Text>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlatList
          data={data?.messages || []}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 14, gap: 8, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={(
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 }}>
              <Text style={{
                fontFamily: fonts.ar, fontSize: 13, color: theme.subtle,
                textAlign: 'center', lineHeight: 21,
              }}>
                لا توجد رسائل بعد. إذا احتاج متجرك تعديلاً ستصلك ملاحظة هنا.
              </Text>
            </View>
          )}
          renderItem={({ item }: { item: ShopReviewMessage }) => {
            const mine = item.author === 'shop';
            return (
              <View style={{
                alignSelf: mine ? 'flex-start' : 'flex-end',
                maxWidth: '86%',
                backgroundColor: mine ? theme.chipBg : theme.accentSoft,
                borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 9,
              }}>
                <Text style={{
                  fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink,
                  textAlign: 'right', lineHeight: 21,
                }}>
                  {item.body}
                </Text>
                <Text style={{
                  fontFamily: fonts.ar, fontSize: 10, color: theme.subtle,
                  textAlign: 'right', marginTop: 4,
                }}>
                  {mine ? 'أنت' : 'الإدارة'} · {timeAgoAr(item.created_at)}
                </Text>
              </View>
            );
          }}
        />
      )}

      <View style={{
        flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 12, paddingTop: 8,
        paddingBottom: bottomBarPadding(kbHeight, insets.bottom),
        backgroundColor: theme.surface, borderTopWidth: 1, borderColor: theme.line,
        alignItems: 'center',
      }}>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="اكتب ردك للإدارة…"
          placeholderTextColor={theme.subtle}
          multiline
          style={{
            flex: 1, backgroundColor: theme.bg, borderRadius: radius.lg,
            paddingHorizontal: 12, paddingVertical: 10, maxHeight: 110,
            fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right',
          }}
        />
        <TouchableOpacity
          onPress={() => body.trim() && send.mutate(body.trim())}
          disabled={!body.trim() || send.isPending}
          activeOpacity={0.85}
          style={{
            paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.lg,
            backgroundColor: body.trim() ? theme.ink : theme.chipBg,
          }}
        >
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 13.5,
            color: body.trim() ? theme.buttonInk : theme.subtle,
          }}>
            إرسال
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
