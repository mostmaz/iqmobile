// ضمان iQ Mobile — the buy-with-guarantee sheet.
//
// One sheet carries the whole buyer-side flow: how the service works, the
// transparent money math, a phone number to reach them on, and — after the
// tap — the success state with the order code. Keeping success inside the
// sheet means no new navigation screen, which matters because ListingDetail
// lives in five different stacks and every screen reachable from it would
// need registering in all of them.

import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity, TextInput, ActivityIndicator,
  Keyboard, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../theme';
import { Guarantee, type GuaranteeQuote } from '../api/endpoints';

const STEPS = [
  'نتصل بك لتأكيد الطلب',
  'نتفق مع البائع ونستلم الجهاز',
  'نفحصه ونرسل لك تقرير الفحص',
  'تدفع عربوناً بعد اطلاعك على التقرير',
  'نوصّل الجهاز والباقي يُدفع عند الاستلام',
];

const ERRORS: Record<string, string> = {
  already_requested: 'لديك طلب ضمان قائم لهذا الإعلان بالفعل.',
  listing_unavailable: 'هذا الإعلان لم يعد متاحاً.',
  not_eligible: 'هذا الإعلان لم يعد مشمولاً بخدمة الضمان.',
  bad_phone: 'رقم الهاتف غير صالح.',
  own_listing: 'لا يمكنك شراء إعلانك.',
};

const fmt = (n: number) => Number(n || 0).toLocaleString('en-US');

export function GuaranteeSheet({
  visible, listingId, deviceTitle: title, price, quote, initialPhone, onClose, onViewOrders,
}: {
  visible: boolean;
  listingId: number;
  deviceTitle: string;
  price: number;
  quote: GuaranteeQuote;
  initialPhone?: string | null;
  onClose: () => void;
  onViewOrders: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState(initialPhone || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [code, setCode] = useState<string | null>(null); // set = success state

  // The phone input sits at the very bottom of the sheet — exactly where
  // the keyboard lands. adjustResize does not apply inside a transparent
  // Modal and KeyboardAvoidingView is unreliable there (see
  // DevicePickerModal for the long version), so measure the keyboard and
  // lift the whole sheet by its height.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e: any) => setKbHeight(e?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const order = await Guarantee.create({ listing_id: listingId, buyer_phone: phone });
      setCode(order.code);
    } catch (e: any) {
      setErr(ERRORS[e?.message] || 'تعذّر إرسال الطلب. حاول مجدداً.');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    // Reset the transient bits so reopening starts clean; keep the phone,
    // retyping it is pure friction.
    setErr('');
    setCode(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        onPress={close}
        style={{ flex: 1, backgroundColor: 'rgba(20,19,17,0.45)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: theme.bg,
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            paddingHorizontal: 20, paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
            // Rides above the keyboard; 0 when it's closed.
            marginBottom: kbHeight,
          }}
        >
          <View style={{
            alignSelf: 'center', width: 38, height: 4, borderRadius: 999,
            backgroundColor: theme.line, marginBottom: 16,
          }} />

          {code ? (
            // ── success ────────────────────────────────────────────────
            <View>
              <Text style={{ fontSize: 40, textAlign: 'center' }}>🛡️</Text>
              <Text style={{
                fontFamily: fonts.arBold, fontSize: 17, color: theme.ink,
                textAlign: 'center', marginTop: 8,
              }}>
                استلمنا طلبك
              </Text>
              <Text style={{
                fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
                textAlign: 'center', lineHeight: 21, marginTop: 6,
              }}>
                رقم الطلب <Text style={{ fontFamily: fonts.ltrBold, color: theme.ink }}>{code}</Text>
                {'\n'}سنتصل بك قريباً لتأكيد الطلب والبدء بالإجراءات.
              </Text>
              <TouchableOpacity
                onPress={() => { close(); onViewOrders(); }}
                activeOpacity={0.85}
                style={{
                  marginTop: 18, borderRadius: radius.lg, paddingVertical: 15,
                  backgroundColor: theme.accent, alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: '#fff' }}>
                  متابعة طلباتي
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={close}
                activeOpacity={0.7}
                style={{ marginTop: 6, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.subtle }}>إغلاق</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // ── how it works + confirm ─────────────────────────────────
            <View>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}>
                اشترِ بضمان iQ Mobile
              </Text>
              <Text style={{
                fontFamily: fonts.ar, fontSize: 13, color: theme.subtle,
                textAlign: 'right', marginTop: 4,
              }}>
                {title}
              </Text>

              <View style={{ marginTop: 12, gap: 8 }}>
                {STEPS.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 9 }}>
                    <View style={{
                      width: 22, height: 22, borderRadius: 999,
                      backgroundColor: theme.successSoft ?? 'rgba(16,185,129,0.14)',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: theme.success }}>{i + 1}</Text>
                    </View>
                    <Text style={{
                      flex: 1, fontFamily: fonts.ar, fontSize: 13, color: theme.ink,
                      textAlign: 'right', lineHeight: 19,
                    }}>
                      {s}
                    </Text>
                  </View>
                ))}
              </View>

              {/* The money, with nothing hidden. */}
              <View style={{
                marginTop: 14, padding: 12, borderRadius: radius.lg,
                backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.line,
              }}>
                <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
                  سعر الجهاز <Text style={{ fontFamily: fonts.ltr }}>{fmt(price)}</Text>
                  {' + '}رسوم الفحص والضمان {quote.pct}٪ <Text style={{ fontFamily: fonts.ltr }}>({fmt(quote.fee)})</Text>
                </Text>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.accentDeep, textAlign: 'right', marginTop: 4 }}>
                  المجموع <Text style={{ fontFamily: fonts.ltrBold }}>{fmt(quote.total)}</Text> د.ع
                </Text>
              </View>

              <Text style={{
                fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
                textAlign: 'right', marginTop: 12, marginBottom: 6,
              }}>
                رقم هاتفك للتواصل
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="07xxxxxxxxx"
                placeholderTextColor={theme.subtle}
                style={{
                  backgroundColor: theme.surface, borderRadius: radius.lg,
                  borderWidth: 1, borderColor: theme.line,
                  paddingHorizontal: 14, paddingVertical: 12,
                  fontSize: 15, color: theme.ink, textAlign: 'left', fontFamily: fonts.ltr,
                }}
              />

              {err ? (
                <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.danger, textAlign: 'right', marginTop: 8 }}>
                  {err}
                </Text>
              ) : null}

              <TouchableOpacity
                onPress={submit}
                disabled={busy || phone.trim().length < 10}
                activeOpacity={0.85}
                style={{
                  marginTop: 14, borderRadius: radius.lg, paddingVertical: 15,
                  backgroundColor: theme.accent, alignItems: 'center',
                  opacity: busy || phone.trim().length < 10 ? 0.55 : 1,
                }}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: '#fff' }}>
                    اطلب الشراء بالضمان
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={close}
                activeOpacity={0.7}
                style={{ marginTop: 6, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.subtle }}>ليس الآن</Text>
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
