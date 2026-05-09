import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView,
  Platform, Alert, Linking, Image, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Btn, fmtIQD, Header } from '../../components/ui';
import { Chats, Deals, type Chat, type ChatMessage, type Deal } from '../../api/endpoints';
import { sendChatImage, fullImageUrl } from '../../api/upload';
import { compressForChat } from '../../lib/imageCompress';
import { ar } from '../../i18n/ar';
import { subscribeSSE } from '../../sse/client';
import { useAuth } from '../../auth/AuthContext';

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

  useEffect(() => {
    if (messages && listRef.current) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages?.length]);

  async function send() {
    if (!body.trim()) return;
    setSending(true); setWarning(null);
    try {
      const r = await Chats.sendText(id, body);
      setBody('');
      if (r.blocked) setWarning(ar.chat.blockedHint);
      refresh();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message);
    } finally { setSending(false); }
  }

  async function sendQuick(s: string) {
    setBody(s);
    setSending(true);
    try {
      const r = await Chats.sendText(id, s);
      setBody('');
      if (r.blocked) setWarning(ar.chat.blockedHint);
      refresh();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message);
    } finally { setSending(false); }
  }

  async function pickAndSendImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1,
    });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    const compressed = await compressForChat(r.assets[0].uri);
    setSending(true);
    try { await sendChatImage(id, compressed); refresh(); }
    catch (e: any) { Alert.alert('خطأ', e.message); }
    finally { setSending(false); }
  }

  async function proposePrice() {
    const p = Number(priceInput);
    if (!p) return;
    try {
      await Deals.proposePrice(id, p);
      setProposeOpen(false); setPriceInput(''); refresh();
    } catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message); }
  }

  async function counterOffer() {
    if (!chat?.active_deal) return;
    const p = Number(priceInput);
    if (!p) return;
    try {
      await Deals.counter(chat.active_deal.id, p);
      setCounterOpen(false); setPriceInput(''); refresh();
    } catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message); }
  }

  async function buyerAccept() {
    if (!chat?.active_deal) return;
    try { await Deals.buyerAccept(chat.active_deal.id); refresh(); }
    catch (e: any) { Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message); }
  }
  async function buyerReject() {
    if (!chat?.active_deal) return;
    try { await Deals.buyerReject(chat.active_deal.id); refresh(); }
    catch (e: any) { Alert.alert('خطأ', e.message); }
  }
  async function sellerConfirm() {
    if (!chat?.active_deal) return;
    Alert.alert('تأكيد الصفقة', `وافق المشتري على ${chat.active_deal.final_price.toLocaleString()} د.ع. أؤكد الصفقة؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'تأكيد', onPress: async () => { try { await Deals.sellerConfirm(chat.active_deal!.id); refresh(); } catch (e: any) { Alert.alert('خطأ', e.message); } } },
    ]);
  }

  if (!chat) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  const role = chat.role;
  const deal = chat.active_deal;
  const phoneVisible = chat.phone_visible;
  const sellerPhone = chat.seller?.phone;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.bg }}
      keyboardVerticalOffset={insets.top}
    >
      <Header
        title={chat.listing ? `${chat.listing.brand} ${chat.listing.model}` : 'محادثة'}
        eyebrow={`${ar.chat.listingHeader} · ${chat.listing ? fmtIQD(chat.listing.asking_price) + ' د.ع' : ''}`}
        onBack={() => navigation.goBack()}
      />

      {/* Phone is now public on the listing itself — no unlock banner or
          deal-confirmation flow surfaced in chat. The Deal data model is
          still maintained server-side for record-keeping. */}

      <FlatList
        ref={listRef}
        data={messages || []}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ padding: 12, paddingBottom: 16, gap: 6 }}
        renderItem={({ item }) => <MessageBubble m={item} mine={item.sender_id === user?.id} />}
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
        {role === 'seller' && !deal ? (
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
        <Image source={{ uri: fullImageUrl(m.image_path) }} style={{ width: 200, height: 200, borderRadius: radius.md, backgroundColor: theme.bg, marginBottom: m.body ? 6 : 0 }} resizeMode="cover" />
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
