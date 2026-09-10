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
import { IconArrowLeft, IconFlag } from '../../components/icons';
import { Chats, Deals, Reports, type Chat, type ChatMessage } from '../../api/endpoints';
import { sendChatImage, fullImageUrl } from '../../api/upload';
import { compressForChatBubble } from '../../lib/imageCompress';
import { parsePrice } from '../../lib/format';
import { ar } from '../../i18n/ar';
import { useKeyboardHeight, bottomBarPadding } from '../../lib/useKeyboard';
import { subscribeSSE } from '../../sse/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotificationPermission } from '../../push/permission';
import { NotificationGate } from '../../components/NotificationGate';
import { useOnline } from '../../components/OfflineBanner';
import {
  useOutbox, queueMessage, markSent, markFailed, markPending, drop, peekNext,
} from '../../lib/chatOutbox';
import { isAcknowledged, type OutboxEntry } from '../../lib/chatOutboxCore';

// Hide the propose-price / accept / counter / seller-confirm flow for v1.
// The phone numbers are now public on each listing, so we don't need the
// deal-confirmation gate to unlock them. The server endpoints stay live
// (they remain useful for record-keeping) — just don't render their
// buttons inside the chat. Flip this to `true` when re-enabling.
const DEAL_FLOW_ENABLED = false;

export default function ChatScreen({ route, navigation }: any) {
  const { id } = route.params as { id: number };
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [warning, setWarning] = useState<string | null>(null);

  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Obligatory notification gate.
  //
  // A chat nobody is told about is worse than no chat: the buyer asks "متوفر؟",
  // the seller never sees it, and both of them conclude the app is dead. So the
  // conversation does not open until notifications are on.
  //
  // Gating HERE rather than at each call site is deliberate — the screen is
  // reachable from the listing page, the inbox, a notification tap and a deep
  // link, and a gate on one of those is a gate on none. The hooks above stay
  // mounted (the queries keep the thread warm) and only the render is
  // swapped, so granting drops the user straight into a loaded conversation.
  const perm = useNotificationPermission();
  const online = useOnline();
  const outbox = useOutbox(id);

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
    // 3s while we can actually reach the server; nothing at all when we
    // cannot. On a dead connection this was 20 requests a minute, each
    // burning a full 20s deadline — pure battery for guaranteed failures.
    // Reachability re-dials SSE and refetches the moment it returns.
    refetchInterval: online ? 3000 : false,
  });
  const { data: quick } = useQuery({ queryKey: ['quickMessages'], queryFn: Chats.quickMessages });

  // Queued messages render after everything the server knows about — they
  // are, by definition, the newest thing in the conversation.
  const feed: any[] = [
    ...(messages || []),
    ...outbox.map((e) => ({ __outbox: e })),
  ];

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

  /**
   * Queue, then send. The input clears immediately and the message appears
   * as a pending bubble, because on a slow link the old flow gave twenty
   * seconds of nothing and people retyped.
   *
   * No Alert on failure any more: the bubble carries its own failed state
   * and its own retry, which survives leaving the screen. A modal cannot.
   */
  async function send() {
    const text = body.trim();
    if (!text || !user) return;
    const entry = queueMessage(id, text);
    setBody('');
    setWarning(null);
    deliver(entry.key, text);
  }

  async function deliver(key: string, text: string) {
    markPending(key);
    try {
      const r = await Chats.sendText(id, text);
      markSent(key);
      if (r.blocked) setWarning(ar.chat.blockedHint);
      refresh();
    } catch (e: any) {
      markFailed(key, e?.message || 'network_error');
    }
  }

  // Drain on reconnect: send the oldest queued message for this chat, one at
  // a time. Sequential rather than parallel because a conversation delivered
  // out of order is worse than one delivered late.
  useEffect(() => {
    if (!online) return;
    const next = peekNext(id);
    if (!next || next.state === 'pending') return;
    deliver(next.key, next.body);
  }, [online, outbox.length, outbox.map((e) => e.state).join(), id]);

  // A send whose RESPONSE was lost leaves an entry queued for a message that
  // really did arrive. Once the thread shows it, drop the duplicate rather
  // than offering the user a retry that would post it twice.
  useEffect(() => {
    if (!messages || !user) return;
    for (const e of outbox) {
      if (isAcknowledged(e, messages as any, user.id)) drop(e.key);
    }
  }, [messages, outbox.length, user?.id]);

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

  // The gate. Rendered instead of the conversation until the OS says yes.
  // `loading` renders blank rather than the gate so a granted user never sees
  // a flash of "turn on notifications" while we read the real state.
  if (perm.loading) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  if (!perm.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row-reverse', paddingHorizontal: 12, paddingVertical: 8 }}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
            </View>
          </TouchableOpacity>
        </View>
        <NotificationGate
          required
          compactReasons
          title="فعّل الإشعارات لبدء المحادثة"
          intro={`ستراسل ${counterpartyName}. من دون الإشعارات لن تعرف أنه ردّ عليك، والرد يصل عادةً بعد دقائق لا ثوانٍ.`}
        />
      </View>
    );
  }

  /**
   * Report this conversation.
   *
   * ChatScreen had no report button and no overflow menu at all — the ONE
   * report entry point in the whole app was on the listing page. So the place
   * where abuse actually happens was the one place you could not report it,
   * and `inappropriate_chat` + target_kind 'chat' were valid server-side and
   * unreachable from the app.
   *
   * Blocking is NOT offered here, deliberately. `chat_blocks` is shop-scoped
   * and directional — a shop blocks a buyer, from the merchant panel — so a
   * buyer cannot block a seller and an individual seller cannot block anyone.
   * Making that work is a schema change, not a button, and half-adding a
   * one-sided block would be worse than saying so. See docs/reporting.md.
   */
  function reportChat() {
    // A guest tapping this used to hit a bare `return` — the flag icon did
    // nothing at all, silently. Guests can open and hold conversations, so
    // the person most exposed to a scammer was the one person with no way to
    // report it. Route to sign-in the way ListingDetailScreen already does.
    if (!user || user.is_guest) {
      (navigation as any).getParent()?.getParent?.()?.navigate('AuthGate')
        ?? navigation.navigate('AuthGate' as never);
      return;
    }
    Alert.alert('إبلاغ عن المحادثة', 'ما نوع المشكلة؟', [
      { text: 'رسائل مسيئة', onPress: () => submitChatReport('inappropriate_chat') },
      { text: 'محاولة احتيال', onPress: () => submitChatReport('scam_attempt') },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  }

  async function submitChatReport(reason: string) {
    try {
      const r = await Reports.submit('chat', id, reason);
      Alert.alert(
        'شكراً',
        r.duplicate
          ? `سبق أن أرسلت هذا البلاغ (رقم ${r.id}). هو قيد المراجعة.`
          : `تم استلام البلاغ رقم ${r.id}. سنراجع المحادثة.`,
      );
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    }
  }

  function openListing() {
    if (!listingId) return;
    // Local stack has its own ListingDetail (registered in navigation/index.tsx
    // ChatsStackNav), so this resolves inside the Chats tab.
    navigation.navigate('ListingDetail', { id: listingId });
  }

  return (
    // Padding on BOTH platforms. The Android branch used to be `undefined`,
    // which makes KeyboardAvoidingView a no-op — fine back when adjustResize
    // resized the window for us, useless now the app is edge-to-edge and
    // Android draws the IME over the content instead. The composer sat under
    // the keys as a result.
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: theme.bg }}
      // iOS measures from the top of the screen and needs the header
      // discounted; Android's keyboard height is already relative to the
      // visible window, so any offset here double-counts.
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
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
        {/* The only way to report abuse from where abuse happens. */}
        <TouchableOpacity
          onPress={reportChat}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="إبلاغ عن المحادثة"
          hitSlop={8}
          style={{
            width: 38, height: 38, borderRadius: radius.lg,
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            alignItems: 'center', justifyContent: 'center', marginLeft: 6,
          }}
        >
          <IconFlag size={17} color={theme.subtle} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={{
          width: 38, height: 38, borderRadius: radius.lg,
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
        data={feed}
        keyExtractor={(it: any) => (it.__outbox ? `ob:${it.__outbox.key}` : String(it.id))}
        // contentContainerStyle uses flexGrow:1 so the empty-state View
        // can `flex:1` to center itself vertically inside the list area
        // (without it the empty state hugs the top because the
        // ListEmptyComponent only gets the minimum height it asks for).
        contentContainerStyle={{ padding: 12, paddingBottom: 16, gap: 6, flexGrow: 1 }}
        renderItem={({ item }: any) => (item.__outbox
          ? (
            <PendingBubble
              entry={item.__outbox}
              onRetry={() => deliver(item.__outbox.key, item.__outbox.body)}
              onDiscard={() => drop(item.__outbox.key)}
            />
          )
          : <MessageBubble m={item} mine={item.sender_id === user?.id} />)}
        // Empty state for a fresh chat — no messages yet. Sender opens
        // the chat from a listing detail (POST /listings/:id/chat
        // either reuses or creates), so the most useful prompt is "say
        // hi" rather than just blank space.
        ListEmptyComponent={
          messages === undefined || feed.length > 0 ? null : (
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
        flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 12, paddingTop: 6,
        // While the keyboard is up the safe-area inset is wrong: the keys
        // already cover that strip, and adding both leaves a dead gap
        // between the composer and the keyboard.
        paddingBottom: bottomBarPadding(kbHeight, insets.bottom),
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

/**
 * A message the user has sent that the server has not accepted yet.
 *
 * Shaped like their own bubble on purpose — it IS their message, and drawing
 * it differently would read as "this didn't send" for the ordinary second it
 * spends in flight. Only the footer changes: a clock while pending, and a
 * retry when it has actually failed.
 *
 * The retry is per message. A single "retry all" would re-send messages the
 * user may have given up on, and offers no way to abandon just one.
 */
function PendingBubble({
  entry, onRetry, onDiscard,
}: { entry: OutboxEntry; onRetry: () => void; onDiscard: () => void }) {
  const failed = entry.state === 'failed';
  return (
    <View style={{
      alignSelf: 'flex-start',
      maxWidth: '78%',
      backgroundColor: theme.ink,
      borderRadius: 16,
      borderBottomLeftRadius: 6,
      borderBottomRightRadius: 16,
      paddingHorizontal: 13, paddingVertical: 10,
      opacity: failed ? 1 : 0.6,
    }}>
      <Text style={{
        fontFamily: fonts.ar, fontSize: 14, color: theme.bg,
        lineHeight: 20, textAlign: 'right',
      }}>
        {entry.body}
      </Text>
      {failed ? (
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 10.5, color: theme.dangerInk }}>
            لم تُرسل
          </Text>
          <TouchableOpacity onPress={onRetry} accessibilityRole="button">
            <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.bg }}>
              إعادة الإرسال
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDiscard} accessibilityRole="button">
            <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: 'rgba(245,240,230,0.6)' }}>
              حذف
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={{
          marginTop: 4, fontFamily: fonts.mono, fontSize: 10,
          color: 'rgba(245,240,230,0.6)', textAlign: 'left', writingDirection: 'ltr',
        }}>
          ⏳
        </Text>
      )}
    </View>
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
