import { deviceTitle } from '../../lib/format';
// Cart + cash-on-delivery checkout, in one screen.
//
// Deliberately not a multi-step wizard: the basket is short (a shop selling
// phones, not a supermarket) and every extra screen is a place to drop out.
// Review, address, and confirm all live here.
//
// The totals shown are the CLIENT's arithmetic for display only. The server
// re-prices the whole order from listing ids at checkout, so a stale cached
// price shows a wrong preview at worst — never a wrong charge.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../../theme';
import { Img } from '../../components/Img';
import { Btn, fmtIQD } from '../../components/ui';
import { IconChevronLeft, IconPlus, IconMinus, IconClose } from '../../components/icons';
import { GovPicker } from '../../components/GovPicker';
import { Orders } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { useCart } from '../../lib/cart';
import { useAuth } from '../../auth/AuthContext';
import { GOV_AR_TO_EN, GOV_EN_TO_AR } from '../../lib/governorates';

const ERRORS: Record<string, string> = {
  empty_cart: 'السلة فارغة.',
  name_required: 'اكتب الاسم الكامل.',
  bad_phone: 'رقم الهاتف غير صحيح.',
  address_required: 'اكتب العنوان بالتفصيل.',
  bad_governorate: 'اختر المحافظة.',
  item_unavailable: 'أحد الأجهزة لم يعد متوفراً — احذفه من السلة.',
  mixed_shops: 'السلة تحتوي أجهزة من أكثر من متجر.',
  orders_not_enabled: 'هذا المتجر لا يستقبل طلبات حالياً.',
  bad_qty: 'الكمية غير صالحة.',
  price_on_request: 'أحد الأجهزة سعره عند الطلب — اتصل بالمتجر لإتمام الشراء.',
  out_of_stock: 'الكمية المطلوبة غير متوفرة — عدّل الكمية أو احذف الجهاز.',
  too_many_items: 'عدد الأجهزة كبير جداً.',
};

export default function CartScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [govAr, setGovAr] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Prefill from the account so a returning customer types as little as
  // possible. Only fills BLANK fields — never overwrites what they typed.
  useEffect(() => {
    if (user?.display_name) setName((v) => v || user.display_name);
    if ((user as any)?.phone) setPhone((v) => v || (user as any).phone);
    if (user?.governorate) setGovAr((v) => v || GOV_EN_TO_AR[user.governorate] || '');
  }, [user]);

  const govEn = govAr ? GOV_AR_TO_EN[govAr] : '';
  const canSubmit = cart.lines.length > 0 && name.trim().length >= 2
    && phone.trim().length >= 10 && !!govEn && address.trim().length >= 5 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr('');
    try {
      const order = await Orders.create({
        items: cart.lines.map((l) => ({ listing_id: l.listing_id, qty: l.qty })),
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        governorate: govEn,
        address: address.trim(),
        note: note.trim() || undefined,
      });
      // Only clear once the server has the order — a network failure must
      // never lose the basket the customer just built.
      cart.clear();
      navigation.replace('OrderConfirmed', { id: order.id });
    } catch (e: any) {
      setErr(ERRORS[e?.message] || 'تعذّر إرسال الطلب، حاول مرة أخرى.');
    } finally { setBusy(false); }
  }

  const shippingShown = cart.lines.length ? cart.shipping_fee : 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 10,
        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
        borderBottomWidth: 1, borderBottomColor: theme.line,
      }}>
        <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}>
          السلة
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }}>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconChevronLeft size={20} color={theme.ink} sw={2} />
          </View>
        </TouchableOpacity>
      </View>

      {!cart.lines.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, marginBottom: 6 }}>
            السلة فارغة
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'center' }}>
            تصفّح أجهزة المتجر وأضف ما يعجبك للسلة.
          </Text>
          {/* A dead end here is a lost sale — the last thing an emptied cart
              should do is strand the shopper on a blank screen. */}
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
            style={{
              marginTop: 16, paddingHorizontal: 20, paddingVertical: 11,
              borderRadius: radius.pill, backgroundColor: theme.ink,
            }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk }}>
              متابعة التسوّق
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {cart.shop_name ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginBottom: 8 }}>
                الطلب من: {cart.shop_name}
              </Text>
            ) : null}

            {cart.lines.map((l) => (
              <View key={l.listing_id} style={{
                flexDirection: 'row-reverse', gap: 10, alignItems: 'center',
                backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1,
                borderColor: theme.line, padding: 10, marginBottom: 8,
              }}>
                <View style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.chipBg }}>
                  {l.image_path ? <Img source={{ uri: fullImageUrl(l.image_path) }} style={{ width: 56, height: 56 }} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={2} style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right' }}>
                    {deviceTitle(l.brand, l.model)}
                  </Text>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right' }}>
                    {[l.storage, l.color].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={{ fontFamily: fonts.ltrBold, fontSize: 14, color: theme.accentDeep, textAlign: 'right', marginTop: 2 }}>
                    {fmtIQD(l.unit_price * l.qty)} <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle }}>د.ع</Text>
                  </Text>
                </View>
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                    <TouchableOpacity onPress={() => cart.setQty(l.listing_id, l.qty + 1)} style={qtyBtn}>
                      <IconPlus size={13} color={theme.ink} sw={2} />
                    </TouchableOpacity>
                    <Text style={{ fontFamily: fonts.ltrBold, fontSize: 14, color: theme.ink, minWidth: 16, textAlign: 'center' }}>{l.qty}</Text>
                    <TouchableOpacity onPress={() => cart.setQty(l.listing_id, l.qty - 1)} style={qtyBtn}>
                      <IconMinus size={13} color={theme.ink} sw={2} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => cart.remove(l.listing_id)} style={{ padding: 4 }}>
                    <IconClose size={14} color={theme.subtle} sw={2} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <View style={{
              backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1,
              borderColor: theme.line, padding: 12, marginTop: 4, marginBottom: 16,
            }}>
              <Row label="سعر الأجهزة" value={`${fmtIQD(cart.subtotal)} د.ع`} />
              <Row label="أجور التوصيل" value={`${fmtIQD(shippingShown)} د.ع`} />
              <View style={{ height: 1, backgroundColor: theme.line, marginVertical: 8 }} />
              <Row label="المجموع" value={`${fmtIQD(cart.subtotal + shippingShown)} د.ع`} bold />
              <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 6 }}>
                الدفع عند الاستلام
              </Text>
            </View>

            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right', marginBottom: 8 }}>
              معلومات التوصيل
            </Text>

            <Field label="الاسم الكامل" value={name} onChangeText={setName} placeholder="مثال: أحمد علي" />
            <Field label="رقم الهاتف" value={phone} onChangeText={setPhone} placeholder="07XXXXXXXXX" keyboardType="phone-pad" ltr />

            <Text style={labelStyle}>المحافظة</Text>
            <View style={{ marginBottom: 10 }}>
              <GovPicker valueAr={govAr} onChangeAr={setGovAr} />
            </View>

            <Field
              label="العنوان بالتفصيل"
              value={address}
              onChangeText={setAddress}
              placeholder="المنطقة، الشارع، أقرب نقطة دالة"
              multiline
            />
            <Field label="ملاحظة (اختياري)" value={note} onChangeText={setNote} placeholder="أي تفاصيل تساعد المندوب" multiline />

            {err ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.danger, textAlign: 'right', marginBottom: 10 }}>
                {err}
              </Text>
            ) : null}

            <Btn kind="primary" full disabled={!canSubmit} onPress={submit}>
              {busy ? <ActivityIndicator color={theme.buttonInk} /> : (
                <Text style={{ fontFamily: fonts.arBold, fontSize: 15.5, color: theme.buttonInk }}>
                  تأكيد الطلب · {fmtIQD(cart.subtotal + shippingShown)} د.ع
                </Text>
              )}
            </Btn>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const qtyBtn = {
  width: 26, height: 26, borderRadius: 999, alignItems: 'center' as const,
  justifyContent: 'center' as const, backgroundColor: theme.chipBg,
};
const labelStyle = {
  fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
  textAlign: 'right' as const, marginBottom: 4,
};

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 4 }}>
      <Text style={{ fontFamily: bold ? fonts.arBold : fonts.ar, fontSize: bold ? 15 : 13.5, color: theme.ink }}>{label}</Text>
      <Text style={{ fontFamily: bold ? fonts.ltrBold : fonts.ltr, fontSize: bold ? 15 : 13.5, color: bold ? theme.accentDeep : theme.ink }}>{value}</Text>
    </View>
  );
}

function Field({ label, ltr, multiline, ...rest }: any) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={labelStyle}>{label}</Text>
      <TextInput
        {...rest}
        multiline={multiline}
        placeholderTextColor={theme.subtle}
        style={{
          backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
          borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: multiline ? 10 : 11,
          minHeight: multiline ? 64 : undefined, textAlignVertical: multiline ? 'top' : 'center',
          fontFamily: ltr ? fonts.ltr : fonts.ar, fontSize: 14.5, color: theme.ink,
          textAlign: ltr ? 'left' : 'right',
        }}
      />
    </View>
  );
}
