import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView,
  Platform, Alert, Modal,
} from 'react-native';
import { Img } from '../../components/Img';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Btn, fmtIQD } from '../../components/ui';
import { IconArrowLeft } from '../../components/icons';
import { Chats, Deals, type Chat, type ChatMessage } from '../../api/endpoints';
import { sendChatImage, fullImageUrl } from '../../api/upload';
import { compressForChatBubble } from '../../lib/imageCompress';
import { parsePrice } from '../../lib/format';
import { ar } from '../../i18n/ar';
import { subscribeSSE } from '../../sse/client';
import { useAuth } from '../../auth/AuthContext';

// Hide the propose-price / accept / counter / seller-confirm flow for v1.
// The phone numbers are now public on each listing, so we don't need the
// deal-confirmation gate to unlock them. The server endpoints stay live
// (they remain useful for record-keeping) — just don't render their
// buttons inside the chat. Flip this to `true` when re-enabling.
const DEAL_FLOW_ENABLED = false;

export default function ChatScreen({ route, navigation }: any) {
  const { id } = route.params as { id: number };
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [warning, setWarning] = useState<string | null>(null);

  const listRef = useRef<FlatList<ChatMessage>>(null);

  const { data: chat } = useQuery<Chat>({
    queryKey: ['chat', id],
    queryFn: () => Chats.get(id),
  });
  const { data: messages } = useQuery<ChatMessage[]>({
    queryKey: ['messages', id],
    queryFn: () => Chats.messages(id),
    // Belt-and-suspenders alongside SSE: a dropped event (mobile flake,
    // background tab, server emit racing with addClient) used to leave
    // the screen stale until manual refresh. Polling at 3s keeps live
    // updates working even when SSE silently fails; React Query dedupes
    // against the SSE-triggered invalidation. Stops automatically when
    // the screen unmounts (no observer = no fetch).
    refetchInterval: 3000,
  });
  const { data: quick } = useQuery({ queryKey: ['quickMessages'], queryFn: Chats.quickMessages });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['chat', id] });
    qc.invalidateQueries({ queryKey: ['messages', id] });
  }, [id, qc]);

  // SSE — refresh on any chat-related event for this chat.
  useEffect(() => {
    const unsub = subscribeSSE((ev, data) => {
      if (ev === 'chat.message' && data?.chat_id === id) refresh();
      if (ev.startsWith('deal.') || ev === 'phone.unlocked') {
        if (data?.deal?.chat_id === id) refresh();
      }
    });
    return () => { unsub(); };
  }, [id, refresh]);

  // Auto-scroll to the bottom when a new message arrives. Stash the
  // timeout id in a ref so we can clear it on unmount AND on each
  // subsequent re-fire — previously every message-list change queued a
  // new setTimeout that leaked on unmount or rapid arrivals.
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!messages || !listRef.current) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, [messages?.length]);

  async function send() {
    if (!body.trim() || sending) return;
    setSending(true); setWarning(null);
    try {
      const r = await Chats.sendText(id, body);
      setBody('');
      if (r.blocked) setWarning(ar.chat.blockedHint);
      refresh();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setSending(false); }
  }

  async function sendQuick(s: string) {
    // Early-return when already sending — rapid taps on a quick-reply chip
    // used to fire two parallel sends and clobber the typed draft.
    if (sending) return;
    // Don't replace the user's typed draft. Pass `s` directly so whatever
    // they were typing stays in the input.
    setSending(true);
    try {
      const r = await Chats.sendText(id, s);
      if (r.blocked) setWarning(ar.chat.blockedHint);
      refresh();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setSending(false); }
  }

  async function pickAndSendImage() {
    if (sending) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('الصور', 'فعّل إذن الصور من إعدادات الجهاز.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1,
    });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    setSending(true);
    try {
      // Wrap BOTH compress + send in the try — a corrupt HEIC or OOM
      // during compression used to throw outside the catch, leaving
      // `sending` stuck true and the user with no error message.
      const compressed = await compressForChatBubble(r.assets[0].uri);
      await sendChatImage(id, compressed);
      refresh();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setSending(false); }
  }

  async function proposePrice() {
    // `parsePrice` normalises Arabic-Indic digits and rejects non-positive
    // values — the previous `Number(priceInput)` returned NaN for ٥٠٠... and
    // 0 for blank, and either way the call silently no-op'd with no message.
    const p = parsePrice(priceInput);
    if (p == null) { Alert.alert('خطأ', (ar.errors as any).bad_price); return; }
    try {
      await Deals.proposePrice(id, p);
      setProposeOpen(false); setPriceInput(''); refresh();
    } catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e.message] || (ar.errors as any).network); }
  }

  async function counterOffer() {
    if (!chat?.active_deal) return;
    const p = parsePrice(priceInput);
    if (p == null) { Alert.alert('خطأ', (ar.errors as any).bad_price); return; }
    try {
      await Deals.counter(chat.active_deal.id, p);
      setCounterOpen(false); setPriceInput(''); refresh();
    } catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e.message] || (ar.errors as any).network); }
  }

  async function buyerAccept() {
    if (!chat?.active_deal) return;
    try { await Deals.buyerAccept(chat.active_deal.id); refresh(); }
    catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network); }
  }
  async function buyerReject() {
    if (!chat?.active_deal) return;
    try { await Deals.buyerReject(chat.active_deal.id); refresh(); }
    // Look up the server error code in the Arabic map before falling
    // back. Previously a `bad_state` reply (e.g. trying to reject a
    // buyer_accepted deal after the state-machine tightening) rendered
    // the literal English string in the Arabic UI.
    catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network); }
  }
  async function sellerConfirm() {
    if (!chat?.active_deal) return;
    Alert.alert('تأكيد الصفقة', `وافق المشتري على ${chat.active_deal.final_price.toLocaleString('en-US')} د.ع. أؤكد الصفقة؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'تأكيد', onPress: async () => { try { await Deals.sellerConfirm(chat.active_deal!.id); refresh(); } catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network); } } },
    ]);
  }

  if (!chat) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  const role = chat.role;
  const deal = chat.active_deal;
  // Counterparty is whichever party isn't the viewer. Server already
  // strips sensitive fields from each side; we just need the display
  // name + avatar shape here.
  const counterparty = role === 'buyer' ? chat.seller : chat.buyer;
  const counterpartyName = counterparty?.display_name || 'مستخدم';
  const listingId = chat.listing?.id;
  const listingLabel = chat.listing ? `${chat.listing.brand} ${chat.listing.model}` : null;

  function openListing() {
    if (!listingId) return;
    // Local stack has its own ListingDetail (registered in navigation/index.tsx
    // ChatsStackNav), so this resolves inside the Chats tab.
    navigation.navigate('ListingDetail', { id: listingId });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.bg }}
      keyboardVerticalOffset={insets.top}
    >
      {/* Custom chat header — counterparty name on top, listing brand+model
          on the subline as a TouchableOpacity that opens the listing
          detail. Replaces the previous device-only Header which gave no
          indication of who you were chatting with. */}
      <View style={{
        paddingTop: insets.top + 8,
        paddingBottom: 10,
        paddingHorizontal: 14,
        backgroundColor: theme.bg,
        borderBottomWidth: 1,
        borderColor: theme.line,
        flexDirection: 'row-reverse',
        alignItems: 'center',
        gap: 10,
      }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{
            fontFamily: fonts.arBold, fontSize: 16,
            color: theme.ink, textAlign: 'right' }}>
            {counterpartyName}
          </Text>
          {listingLabel ? (
            <TouchableOpacity onPress={openListing} activeOpacity={0.7}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <Text numberOfLines={1} style={{
                  fontFamily: fonts.ar, fontSize: 12.5,
                  color: theme.accent, textAlign: 'right',
                  textDecorationLine: 'underline',
                }}>
                  {listingLabel}
                </Text>
                {chat.listing ? (
                  <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: theme.subtle }}>
                    · {fmtIQD(chat.listing.asking_price)} د.ع
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={{
          width: 38, height: 38, borderRadius: 999,
          backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Visual back arrow points "back" in RTL — flip horizontally so
              the chevron points right (towards the previous screen). */}
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconArrowLeft size={20} color={theme.ink} sw={1.7} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Phone is now public on the listing itself — no unlock banner or
          deal-confirmation flow surfaced in chat for v1. The Deal data
          model is still maintained server-side for record-keeping. */}

      <FlatList
        ref={listRef}
        data={messages || []}
        keyExtractor={(it) => String(it.id)}
        // contentContainerStyle uses flexGrow:1 so the empty-state View
        // can `flex:1` to center itself vertically inside the list area
        // (without it the empty state hugs the top because the
        // ListEmptyComponent only gets the minimum height it asks for).
        contentContainerStyle={{ padding: 12, paddingBottom: 16, gap: 6, flexGrow: 1 }}
        renderItem={({ item }) => <MessageBubble m={item} mine={item.sender_id === user?.id} />}
        // Empty state for a fresh chat — no messages yet. Sender opens
        // the chat from a listing detail (POST /listings/:id/chat
        // either reuses or creates), so the most useful prompt is "say
        // hi" rather than just blank space.
        ListEmptyComponent={
          messages === undefined ? null : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'center', marginBottom: 6 }}>
                {ar.chat.noMessagesTitle}
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', lineHeight: 20 }}>
                {ar.chat.noMessagesDesc}
              </Text>
            </View>
          )
        }
      />

      {warning ? (
        <View style={{ marginHorizontal: 12, padding: 8, backgroundColor: theme.dangerSoft, borderRadius: radius.md, marginBottom: 4 }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.danger, textAlign: 'right' }}>{warning}</Text>
        </View>
      ) : null}

      {quick && quick.length > 0 ? (
        <View style={{ paddingHorizontal: 12, marginBottom: 6, flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
          {quick.map((q) => (
            <TouchableOpacity key={q} onPress={() => sendQuick(q)} disabled={sending} style={{
              paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.line,
            }}>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.ink }}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={{
        flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 + insets.bottom,
        backgroundColor: theme.surface, borderTopWidth: 1, borderColor: theme.line, alignItems: 'center',
      }}>
        {DEAL_FLOW_ENABLED && role === 'seller' && !deal ? (
          <TouchableOpacity onPress={() => setProposeOpen(true)} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, backgroundColor: theme.accentSoft }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.accentDeep }}>اقتراح سعر</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={pickAndSendImage} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, backgroundColor: theme.chipBg }}>
          <Text>📷</Text>
        </TouchableOpacity>
        <TextInput
          value={body} onChangeText={setBody} placeholder={ar.chat.type} placeholderTextColor={theme.subtle}
          style={{ flex: 1, backgroundColor: theme.bg, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.ar, color: theme.ink, textAlign: 'right' }}
          multiline
        />
        <Btn kind="primary" sm onPress={send} busy={sending}>إرسال</Btn>
      </View>

      <PriceModal
        visible={proposeOpen}
        title={ar.chat.proposePrice}
        value={priceInput} setValue={setPriceInput}
        onCancel={() => setProposeOpen(false)} onSubmit={proposePrice}
      />
      <PriceModal
        visible={counterOpen}
        title={ar.chat.counter}
        value={priceInput} setValue={setPriceInput}
        onCancel={() => setCounterOpen(false)} onSubmit={counterOffer}
      />
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ m, mine }: { m: ChatMessage; mine: boolean }) {
  // In RTL, "mine" sits at the visual start (left in the source order) so
  // the bubble corner is flipped. Same for the bottom corner radius.
  const time = new Date(m.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <View style={{
      alignSelf: mine ? 'flex-start' : 'flex-end',
      maxWidth: '78%',
      backgroundColor: mine ? theme.ink : theme.surface,
      borderRadius: 16,
      borderBottomLeftRadius: mine ? 6 : 16,
      borderBottomRightRadius: mine ? 16 : 6,
      paddingHorizontal: 13, paddingVertical: 10,
      borderWidth: mine ? 0 : 1, borderColor: theme.line,
    }}>
      {m.image_path ? (
        <Img source={{ uri: fullImageUrl(m.image_path) }} style={{ width: 200, height: 200, borderRadius: radius.md, backgroundColor: theme.bg, marginBottom: m.body ? 6 : 0 }} />
      ) : null}
      {m.body ? (
        <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: mine ? theme.bg : theme.ink, lineHeight: 20, textAlign: 'right' }}>
          {m.body}
        </Text>
      ) : null}
      {/* Mask warning retired — chat phones are public now. */}
      <Text style={{ marginTop: 4, fontFamily: fonts.mono, fontSize: 10, color: mine ? 'rgba(245,240,230,0.6)' : theme.subtle, textAlign: 'left', writingDirection: 'ltr' }}>
        {time}
      </Text>
    </View>
  );
}

function PriceModal({
  visible, title, value, setValue, onCancel, onSubmit,
}: { visible: boolean; title: string; value: string; setValue: (s: string) => void; onCancel: () => void; onSubmit: () => void }) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: theme.bg, borderRadius: radius.xl, padding: 18, width: '100%', maxWidth: 360 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, marginBottom: 10, textAlign: 'right' }}>{title}</Text>
          <TextInput
            value={value} onChangeText={setValue} keyboardType="number-pad"
            placeholder={ar.chat.enterPrice} placeholderTextColor={theme.subtle}
            style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, padding: 12, fontFamily: fonts.ltrBold, fontSize: 16, color: theme.ink, textAlign: 'left' }}
          />
          <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 14 }}>
            <Btn kind="ghost" full onPress={onCancel}>إلغاء</Btn>
            <Btn kind="primary" full onPress={onSubmit}>تأكيد</Btn>
          </View>
        </View>
      </View>
    </Modal>
  );
}
