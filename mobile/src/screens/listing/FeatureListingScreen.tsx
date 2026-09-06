// "ميّز إعلانك" — feature-a-listing flow, paid by airtime (mobile balance)
// transfer. The seller: picks their carrier (Asiacell/Korek) → enters the
// number they'll transfer FROM → picks a tier → taps the CTA, which files the
// request AND opens the phone dialer prefilled with that carrier's USSD
// transfer code (e.g. Asiacell *133*5000*0773…#, Korek *123*0750…*5000#).
// The receiving numbers + USSD templates come from GET /features/tiers so the
// owner can swap SIMs server-side without an app release. An admin approves
// the request from the dashboard after the airtime lands.

import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Header, Btn, Input, FieldLabel, fmtIQD } from '../../components/ui';
import { IconSpark, IconCheck, IconPhoneIcon, IconQiCard } from '../../components/icons';
import { Features, Wallet, type FeatureCarrier, type FeaturePayMethod } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { timeAgoAr } from '../../lib/format';

const CARRIER_META: Record<FeatureCarrier, { label: string; color: string }> = {
  asiacell: { label: 'آسياسيل', color: '#ED1C24' },
  korek: { label: 'كورك', color: '#F7A800' },
  // Qi brand: yellow mark on a dark navy roundel (see IconQiCard).
  qicard: { label: 'كي كارد', color: '#141433' },
};

// Sender-number prefixes per airtime network — fallback if the server
// config predates carrier_prefixes. Qi Card has no phone prefix; its
// sender is identified by account name.
const FALLBACK_PREFIXES: Partial<Record<FeatureCarrier, string>> = { asiacell: '077', korek: '075' };

// What we SHOW when a number doesn't match the network. The check itself is
// three digits (077 / 075), which already accepts every number on the
// network; this is only the human-readable version of it. It used to be
// derived as `${pfx}0`, which named exactly one of the two ranges each
// carrier issues and read as a rejection of the other.
const PREFIX_LABEL: Partial<Record<FeatureCarrier, string>> = {
  asiacell: '0770 - 0771',
  korek: '0750 - 0751',
};

// Mirror of the server's normalizeIraqiPhone, for prefix checks only.
function normalizePhone(input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  if (d && !d.startsWith('0')) d = '0' + d;
  return d;
}

export default function FeatureListingScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const listingId: number = route.params?.id;
  const label: string | undefined = route.params?.label;

  const { data, isLoading } = useQuery({ queryKey: ['feature-tiers'], queryFn: () => Features.tiers() });
  const { data: mine } = useQuery({ queryKey: ['features-mine'], queryFn: () => Features.mine() });
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: () => Wallet.get() });
  const balance = wallet?.balance ?? 0;

  const [carrier, setCarrier] = useState<FeaturePayMethod | null>(null);
  const [sender, setSender] = useState(user?.phone || '');
  const [senderName, setSenderName] = useState('');
  const [tier, setTier] = useState<string | null>(null);

  // Existing request for THIS listing (so we show status instead of the form
  // when one is already in flight or the listing is currently featured).
  const existing = useMemo(
    () => (mine || []).find((f) => f.listing_id === listingId),
    [mine, listingId],
  );
  const hasPending = existing?.status === 'pending';
  // Past the point where the server has already asked "are you still
  // interested?" — same 24h threshold as featureNudge.js on the server.
  const waitingLong = !!existing && hasPending && Date.now() - existing.created_at > 24 * 3600 * 1000;
  // The number this request was supposed to be paid to, so a seller who
  // never completed the transfer can still do it from this screen.
  const transferNumber = existing
    ? data?.transfer_numbers?.[existing.carrier as FeatureCarrier] ?? null
    : null;

  const selectedAmount = useMemo(
    () => data?.tiers.find((x) => x.key === tier)?.amount ?? 0,
    [data, tier],
  );

  // The filled USSD dial code for the current carrier + tier selection.
  const ussdCode = useMemo(() => {
    if (!data || !carrier || carrier === 'balance' || !tier) return null;
    const t = data.tiers.find((x) => x.key === tier);
    const number = data.transfer_numbers?.[carrier];
    const template = data.ussd_templates?.[carrier];
    if (!t || !number || !template) return null;
    return template.replace('{amount}', String(t.amount)).replace('{number}', number);
  }, [data, carrier, tier]);

  // Open the dialer with the USSD code prefilled. encodeURIComponent keeps
  // '*' raw and turns '#' into %23 (a raw '#' would be parsed as a URL
  // fragment and the dialer would drop everything after it). iOS blocks
  // USSD codes in tel: links entirely — fall back to showing the code so
  // the user can dial it manually.
  function openDialer(code: string) {
    Linking.openURL('tel:' + encodeURIComponent(code)).catch(() => {
      Alert.alert('اطلب هذا الرمز من تطبيق الهاتف', code);
    });
  }

  const submit = useMutation({
    mutationFn: () => Features.request(listingId,
      carrier === 'balance' ? { tier: tier!, carrier: 'balance' }
        : carrier === 'qicard' ? { tier: tier!, carrier: carrier!, sender_name: senderName.trim() }
          : { tier: tier!, carrier: carrier!, sender_phone: sender.trim() }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['features-mine'] });
      // Paid from the wallet: the server already featured the listing, so
      // there is nothing to dial and nothing to wait for. Refresh the balance
      // and the listing so both show the new state immediately.
      if (res?.paid_from_balance) {
        qc.invalidateQueries({ queryKey: ['wallet'] });
        qc.invalidateQueries({ queryKey: ['listing', listingId] });
        Alert.alert('تم التمييز ✨', 'انخصم المبلغ من رصيدك وإعلانك هسه بأعلى القائمة.');
        return;
      }
      // Straight to the dialer — the pending card renders when they return.
      if (ussdCode) openDialer(ussdCode);
    },
    onError: (e: any) => {
      const code = e?.data?.error || e?.message;
      const map: Record<string, string> = {
        request_pending: 'لديك طلب قيد المراجعة لهذا الإعلان بالفعل.',
        bad_tier: 'اختر باقة صحيحة.',
        bad_carrier: 'اختر شركة الاتصال.',
        bad_sender_phone: 'أدخل رقم الهاتف الذي ستحوّل منه.',
        bad_sender_prefix: 'الرقم لا يطابق شركة الاتصال المختارة.',
        bad_sender_name: 'أدخل اسم صاحب حساب Qi الذي ستحوّل منه.',
        insufficient_balance: 'رصيدك ما يكفي لهذه الباقة.',
        listing_gone: 'الإعلان لم يعد موجوداً.',
        forbidden: 'هذا الإعلان ليس لك.',
        not_found: 'الإعلان غير موجود.',
      };
      Alert.alert('تعذّر الإرسال', map[code] || 'حدث خطأ، حاول مجدداً.');
    },
  });

  function onSubmit() {
    if (!carrier) { Alert.alert('اختر طريقة الدفع', 'حدّد رصيدك أو آسياسيل أو كورك أو كي كارد أولاً.'); return; }
    if (carrier === 'balance') {
      // Nothing to collect. The balance itself is checked below, once a tier
      // is picked, and again by the server inside its transaction.
    } else if (carrier === 'qicard') {
      if (senderName.trim().length < 2) {
        Alert.alert('اسم صاحب الحساب', 'اكتب اسم صاحب حساب Qi الذي ستحوّل منه الأموال.');
        return;
      }
    } else {
      const digits = normalizePhone(sender);
      if (digits.length < 10) { Alert.alert('رقم غير صحيح', 'أدخل الرقم الذي ستحوّل منه الرصيد.'); return; }
      // The transfer must come from a SIM of the chosen network —
      // Asiacell numbers start 077, Korek 075.
      const pfx = data?.carrier_prefixes?.[carrier] || FALLBACK_PREFIXES[carrier];
      if (pfx && !digits.startsWith(pfx)) {
        const meta = CARRIER_META[carrier];
        Alert.alert(
          'الرقم لا يطابق الشبكة',
          `رقم ${meta.label} يجب أن يبدأ بـ ${PREFIX_LABEL[carrier] || pfx}.`,
        );
        return;
      }
    }
    if (!tier) { Alert.alert('اختر الباقة', 'حدّد إحدى باقات التمييز.'); return; }
    if (carrier === 'balance' && selectedAmount > balance) {
      Alert.alert('الرصيد ما يكفي', `هذه الباقة ${fmtIQD(selectedAmount)} د.ع ورصيدك ${fmtIQD(balance)} د.ع.`);
      return;
    }
    submit.mutate();
  }

  // "لم أحوّل الرصيد بعد" — the user opened the dialer but never completed
  // the transfer. Cancels the pending request so the form (with their
  // previous selections still in state) comes back and they can retry.
  const cancelPending = useMutation({
    mutationFn: () => Features.cancelRequest(listingId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['features-mine'] }),
    onError: () => {
      // Stale state (request already approved/rejected/cancelled) — just
      // refetch; the screen re-renders to whatever is actually true.
      qc.invalidateQueries({ queryKey: ['features-mine'] });
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="ميّز إعلانك" badge="SHOP" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {label ? (
          <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right', marginBottom: 12 }}>{label}</Text>
        ) : null}

        {hasPending ? (
          <>
            <StatusCard
              tone="pending"
              title="طلبك قيد المراجعة"
              body={
                // A request older than a day is one we have already asked
                // about by notification, and by far the likeliest reason it
                // is still sitting here is that the balance never arrived.
                // Saying "we're reviewing it" to that seller is not just
                // unhelpful, it is wrong — so the copy names the real
                // condition instead of restating the status.
                waitingLong
                  ? `مضى ${timeAgoAr(existing!.created_at)} على الطلب ولم نستلم الرصيد بعد. إذا حوّلته فعلاً راسلنا، وإذا ما حوّلته تكدر تعيد المحاولة من الزر تحت.`
                  : 'استلمنا طلبك وسنفعّل التمييز بعد تأكيد وصول الرصيد.'
              }
            />
            {/* What they owe and where. Hidden behind the form until now,
                which left the one seller who needs it — the one who never
                transferred — with nothing to act on. */}
            {existing ? (
              <View style={{
                flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 14,
              }}>
                <FactChip label="الباقة" value={existing.tier} ltr />
                <FactChip label="المبلغ" value={`${existing.amount.toLocaleString('en-US')} د.ع`} />
                {transferNumber ? <FactChip label="حوّل إلى" value={transferNumber} ltr /> : null}
              </View>
            ) : null}
            {/* Escape hatch: opened the dialer but never sent the balance →
                cancel the pending request and bring the form back to retry. */}
            <Btn kind="ghost" full busy={cancelPending.isPending} onPress={() => cancelPending.mutate()}>
              لم أحوّل الرصيد بعد — أعد المحاولة
            </Btn>
            <View style={{ height: 16 }} />
          </>
        ) : existing?.status === 'approved' && existing.featured_until && existing.featured_until > Date.now() ? (
          <StatusCard
            tone="ok"
            title="إعلانك مميّز ✨"
            body={`سيظل في أعلى القائمة حتى ${new Date(existing.featured_until).toLocaleDateString('en-GB')}.`}
          />
        ) : null}

        {isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : hasPending ? null : (
          <>
            {/* 1 — carrier */}
            <FieldLabel>١ · اختر طريقة الدفع</FieldLabel>

            {/* Pay from the wallet. Offered only when there is a balance —
                an empty option would raise a question this screen cannot
                answer. It is deliberately not one of the carrier tiles: it
                is not a transfer, and it needs no sender and no approval. */}
            {balance > 0 ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setCarrier('balance')}
                style={{
                  flexDirection: 'row-reverse', alignItems: 'center', gap: 12, marginTop: 6,
                  backgroundColor: carrier === 'balance' ? theme.successSoft : theme.surface,
                  borderWidth: 1.5, borderColor: carrier === 'balance' ? theme.success : theme.line,
                  borderRadius: radius.xxl, paddingHorizontal: 14, paddingVertical: 14,
                }}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 999, backgroundColor: theme.success,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <IconSpark size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ink, textAlign: 'right' }}>
                    ادفع من رصيدي
                  </Text>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                    الرصيد: {fmtIQD(balance)} د.ع · يتفعّل فوراً بدون تحويل
                  </Text>
                </View>
                {carrier === 'balance' ? <IconCheck size={18} color={theme.success} /> : null}
              </TouchableOpacity>
            ) : null}

            {balance > 0 ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 12 }}>
                أو حوّل رصيد:
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: 6 }}>
              {(data?.carriers || (['asiacell', 'korek'] as FeatureCarrier[])).map((c) => {
                const meta = CARRIER_META[c as FeatureCarrier] || { label: c, color: theme.accent };
                const active = carrier === c;
                return (
                  <TouchableOpacity key={c} activeOpacity={0.85} onPress={() => setCarrier(c as FeatureCarrier)} style={{
                    flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14,
                    backgroundColor: active ? theme.accentSoft : theme.surface,
                    borderWidth: 1.5, borderColor: active ? theme.accent : theme.line,
                    borderRadius: radius.xxl,
                  }}>
                    <View style={{
                      width: 44, height: 44, borderRadius: 999, backgroundColor: meta.color,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {c === 'qicard' ? <IconQiCard size={26} /> : <IconPhoneIcon size={20} color="#fff" sw={1.8} />}
                    </View>
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink }}>{meta.label}</Text>
                    {active ? <IconCheck size={16} color={theme.accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 2 — sender identity: SIM number for airtime carriers, the
                Qi account-holder name for Qi Card (that's what shows on
                the incoming transfer). */}
            <View style={{ height: 16 }} />
            {carrier === 'balance' ? null : carrier === 'qicard' ? (
              <>
                <FieldLabel>٢ · اسم صاحب الحساب الذي ستحوّل منه</FieldLabel>
                <Input value={senderName} onChangeText={setSenderName} placeholder="الاسم الكامل كما في حساب Qi" />
              </>
            ) : (
              <>
                <FieldLabel>٢ · الرقم الذي ستحوّل منه</FieldLabel>
                <Input value={sender} onChangeText={setSender}
                  placeholder={carrier === 'korek' ? '0750 / 0751 …' : '0770 / 0771 …'} numeric ltr />
              </>
            )}

            {/* 3 — tier */}
            <View style={{ height: 16 }} />
            <FieldLabel>{carrier === 'balance' ? '٢' : '٣'} · اختر الباقة</FieldLabel>
            <View style={{ gap: 10, marginTop: 6 }}>
              {(data?.tiers || []).map((t) => {
                const active = tier === t.key;
                return (
                  <TouchableOpacity key={t.key} activeOpacity={0.85} onPress={() => setTier(t.key)} style={{
                    flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
                    backgroundColor: active ? theme.accentSoft : theme.surface,
                    borderWidth: 1.5, borderColor: active ? theme.accent : theme.line,
                    borderRadius: radius.xxl, padding: 14,
                  }}>
                    <View style={{
                      width: 40, height: 40, borderRadius: 12,
                      backgroundColor: active ? theme.accent : theme.chipBg,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <IconSpark size={20} color={active ? '#fff' : theme.subtle} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right' }}>
                        {t.label_ar}
                      </Text>
                      <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                        {t.days} أيام · يُرفع لأعلى القائمة {t.boosts_per_day} مرات يومياً
                      </Text>
                      {/* The gift is paid on an approved TRANSFER only —
                          crediting a wallet-funded purchase would let 5,000 of
                          credit buy 10,000 of credit, so the server refuses it.
                          Don't advertise it on the path that can't deliver. */}
                      {t.bonus && carrier !== 'balance' ? (
                        <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: theme.success, textAlign: 'right', marginTop: 3 }}>
                          + {fmtIQD(t.bonus)} د.ع رصيد هدية
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 16, color: theme.accentDeep }}>{fmtIQD(t.amount)}</Text>
                      <Text style={{ fontFamily: fonts.ar, fontSize: 10, color: theme.subtle }}>د.ع</Text>
                    </View>
                    {active ? <IconCheck size={18} color={theme.accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Dial-code preview — appears once carrier + tier are chosen. */}
            {ussdCode ? (
              <View style={{
                marginTop: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
                borderRadius: radius.xxl, padding: 16,
              }}>
                <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 21 }}>
                  عند الضغط على الزر أدناه سيفتح الاتصال برمز التحويل التالي — أكّد المكالمة لإتمام تحويل الرصيد:
                </Text>
                <View style={{
                  marginTop: 10, backgroundColor: theme.chipBg, borderRadius: radius.lg,
                  paddingVertical: 12, alignItems: 'center',
                }}>
                  <Text selectable style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 18, color: theme.ink, letterSpacing: 0.5, writingDirection: 'ltr' }}>
                    {ussdCode}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Qi Card destination — appears once Qi + tier are chosen. */}
            {carrier === 'qicard' && tier && data?.qi_card ? (
              <View style={{
                marginTop: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
                borderRadius: radius.xxl, padding: 16,
              }}>
                <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 21 }}>
                  حوّل مبلغ {fmtIQD(data.tiers.find((x) => x.key === tier)?.amount || 0)} د.ع من تطبيق Qi إلى الحساب التالي ثم اضغط «إرسال الطلب»:
                </Text>
                <View style={{
                  marginTop: 10, backgroundColor: theme.chipBg, borderRadius: radius.lg,
                  paddingVertical: 12, alignItems: 'center', gap: 4,
                }}>
                  <Text selectable style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 22, color: theme.ink, letterSpacing: 1, writingDirection: 'ltr' }}>
                    {data.qi_card.account}
                  </Text>
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.subtle }}>
                    باسم: {data.qi_card.name}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Wallet summary — what leaves the balance, and what is left. */}
            {carrier === 'balance' && tier ? (
              <View style={{
                marginTop: 18, backgroundColor: theme.successSoft, borderWidth: 1,
                borderColor: theme.success, borderRadius: radius.xxl, padding: 16,
              }}>
                <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.ink, textAlign: 'right', lineHeight: 22 }}>
                  ينخصم {fmtIQD(selectedAmount)} د.ع من رصيدك ويتفعّل التمييز فوراً — ماكو تحويل ولا انتظار موافقة.
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 6 }}>
                  الرصيد بعد الخصم: {fmtIQD(Math.max(0, balance - selectedAmount))} د.ع
                </Text>
                {data?.tiers.find((x) => x.key === tier)?.bonus ? (
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 6 }}>
                    الرصيد الهدية يجي وية التحويل بس — مو وية الدفع من الرصيد.
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={{ height: 22 }} />
            <Btn kind="accent" full busy={submit.isPending} onPress={onSubmit}>
              {carrier === 'balance' ? 'ادفع من رصيدي وميّز الإعلان'
                : carrier === 'qicard' ? 'حوّلت المبلغ — إرسال الطلب'
                  : 'تحويل الرصيد وإرسال الطلب'}
            </Btn>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, marginTop: 12, textAlign: 'center', lineHeight: 20 }}>
              {carrier === 'balance'
                ? 'يُفعَّل التمييز فوراً بعد الخصم من رصيدك.'
                : 'بعد وصول المبلغ وتأكيده، يُفعَّل التمييز ويظهر إعلانك في أعلى القائمة.'}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** Quiet label, loud value — the same pill the spec sheet uses. */
function FactChip({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
      paddingHorizontal: 11, paddingVertical: 7,
      borderRadius: radius.pill, backgroundColor: theme.chipBg,
    }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle }}>{label}</Text>
      <Text style={{
        fontFamily: ltr ? fonts.ltr : fonts.arBold, fontSize: 12.5, color: theme.chipInk,
        writingDirection: ltr ? 'ltr' : 'rtl',
      }}>
        {value}
      </Text>
    </View>
  );
}

function StatusCard({ tone, title, body }: { tone: 'pending' | 'ok'; title: string; body: string }) {
  const bg = tone === 'ok' ? theme.successSoft : theme.accentSoft;
  const border = tone === 'ok' ? theme.success : theme.accent;
  return (
    <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: radius.xxl, padding: 16, marginBottom: 16 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right' }}>{title}</Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', marginTop: 4, lineHeight: 21 }}>{body}</Text>
    </View>
  );
}
