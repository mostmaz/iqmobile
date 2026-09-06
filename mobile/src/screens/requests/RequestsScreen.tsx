// طلبات الأجهزة — the request board.
//
// This tab is the active half of the marketplace: instead of a buyer
// hunting through listings, he publishes «اطلب جهازاً» and the sellers come
// to him. Three views behind one segmented control, because the same board
// serves two very different people:
//
//   كل الطلبات — every open request (what a SELLER opens the tab for)
//   طلباتي     — the buyer's own requests + the offers they collected
//   عروضي      — what this seller has already quoted, so he doesn't re-walk
//                the board wondering which ones he answered
//
// The create sheet mirrors WishlistScreen's add panel deliberately: a buyer
// who has used one should recognise the other instantly — brand pills, the
// catalog device picker, a stepped budget.

import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, Header, Pill, Input, fmtIQD } from '../../components/ui';
import {
  IconRequest, IconPlus, IconMinus, IconChevronDown, IconClose, IconPin,
  IconChat, IconTag, IconCheck,
} from '../../components/icons';
import { DevicePickerModal } from '../../components/DevicePickerModal';
import { GovPicker } from '../../components/GovPicker';
import { TextRowListSkeleton } from '../../components/Skeleton';
import { PhoneRequests, DeviceCatalog, type PhoneRequest, type SentOffer } from '../../api/endpoints';
import { deviceTitle, timeAgoAr } from '../../lib/format';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';

const PRICE_STEP = 25_000;
const PRICE_MIN = 50_000;
const PRICE_MAX = 10_000_000;
const clampPrice = (v: number) => Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(v / PRICE_STEP) * PRICE_STEP));

const CONDITIONS: { key: string | null; label: string }[] = [
  { key: null, label: 'أي حالة' },
  { key: 'new', label: 'جديد' },
  { key: 'used', label: 'مستعمل' },
  { key: 'refurbished', label: 'مجدّد' },
  { key: 'repaired', label: 'مصلّح' },
];
const conditionLabel = (k?: string | null) => CONDITIONS.find((c) => c.key === k)?.label || 'أي حالة';

type Tab = 'board' | 'mine' | 'offers';

export default function RequestsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isReal = !!user && !(user as any).is_guest;

  const [tab, setTab] = useState<Tab>('board');
  const [govAr, setGovAr] = useState('');           // '' = كل المحافظات
  const [mineToAnswer, setMineToAnswer] = useState(false);
  const [composing, setComposing] = useState(false);

  const board = useQuery({
    queryKey: ['requests-board', govAr, mineToAnswer],
    queryFn: () => PhoneRequests.board({
      governorate: govAr ? GOV_AR_TO_EN[govAr] : undefined,
      mineToAnswer: mineToAnswer || undefined,
    }),
  });
  const mine = useQuery({ queryKey: ['requests-mine'], queryFn: () => PhoneRequests.mine(), enabled: isReal });
  const sent = useQuery({ queryKey: ['requests-sent'], queryFn: () => PhoneRequests.sentOffers(), enabled: isReal });

  // Coming back from a detail screen must not show a stale offer count.
  useFocusEffect(React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['requests-board'] });
    qc.invalidateQueries({ queryKey: ['requests-mine'] });
    qc.invalidateQueries({ queryKey: ['requests-sent'] });
  }, [qc]));

  const active = tab === 'board' ? board : tab === 'mine' ? mine : sent;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header
        title="طلبات الأجهزة"
        eyebrow="اطلب الجهاز الذي تبحث عنه"
        right={(
          <TouchableOpacity
            onPress={() => (isReal ? setComposing(true) : navigation.getParent()?.getParent?.()?.navigate('AuthGate'))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <IconPlus size={20} color={theme.accent} sw={2.2} />
          </TouchableOpacity>
        )}
      />

      {/* Segmented control */}
      <View style={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 16, marginBottom: 10 }}>
        {([['board', 'كل الطلبات'], ['mine', 'طلباتي'], ['offers', 'عروضي']] as [Tab, string][]).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => setTab(key)}
            activeOpacity={0.8}
            style={{
              flex: 1, paddingVertical: 9, borderRadius: radius.lg, alignItems: 'center',
              backgroundColor: tab === key ? theme.ink : theme.surface,
              borderWidth: 1, borderColor: tab === key ? theme.ink : theme.line,
            }}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={FONT_SCALE_TIGHT}
              style={{
                fontFamily: tab === key ? fonts.arBold : fonts.ar, fontSize: 12.5,
                color: tab === key ? theme.buttonInk : theme.subtle,
              }}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Board filters */}
      {tab === 'board' ? (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <GovPicker valueAr={govAr} onChangeAr={setGovAr} allowAll compact />
            </View>
            {isReal ? (
              <TouchableOpacity
                onPress={() => setMineToAnswer((v) => !v)}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
                  paddingHorizontal: 11, paddingVertical: 9, borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: mineToAnswer ? theme.accent : theme.line,
                  backgroundColor: mineToAnswer ? theme.accentSoft : theme.surface,
                }}
              >
                {mineToAnswer ? <IconCheck size={12} color={theme.accent} sw={2.4} /> : null}
                <Text style={{
                  fontFamily: mineToAnswer ? fonts.arBold : fonts.ar, fontSize: 12,
                  color: mineToAnswer ? theme.accent : theme.subtle,
                }}>
                  أقدر أجهزها
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {!isReal && tab !== 'board' ? (
        <SignedOut navigation={navigation} />
      ) : active.isLoading ? (
        <TextRowListSkeleton count={4} />
      ) : (
        <FlatList
          data={(active.data as any[]) || []}
          keyExtractor={(it: any) => String(it.id)}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 96 }}
          refreshing={active.isFetching}
          onRefresh={() => active.refetch()}
          renderItem={({ item }) => (tab === 'offers'
            ? <SentOfferRow offer={item as SentOffer} onPress={() => navigation.navigate('RequestDetail', { id: (item as SentOffer).request.id })} />
            : <RequestRow
                request={item as PhoneRequest}
                showOffers={tab === 'mine'}
                onPress={() => navigation.navigate('RequestDetail', { id: item.id })}
              />
          )}
          ListEmptyComponent={<Empty tab={tab} onCompose={() => (isReal ? setComposing(true) : navigation.getParent()?.getParent?.()?.navigate('AuthGate'))} />}
        />
      )}

      {/* Primary CTA — always reachable, even mid-scroll. */}
      {tab !== 'offers' ? (
        // `bottom: 16` alone. The screen already ends above the tab bar, so
        // adding insets.bottom on top of that double-counted the home
        // indicator and left the button floating ~50pt clear of the bar,
        // reading as a stray element rather than the screen's action.
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
          <Btn kind="primary" full onPress={() => (isReal ? setComposing(true) : navigation.getParent()?.getParent?.()?.navigate('AuthGate'))}>
            اطلب جهازاً
          </Btn>
        </View>
      ) : null}

      <ComposeSheet
        visible={composing}
        onClose={() => setComposing(false)}
        defaultGovAr={arOf((user as any)?.governorate) || ''}
        onCreated={(created) => {
          setComposing(false);
          setTab('mine');
          qc.invalidateQueries({ queryKey: ['requests-mine'] });
          qc.invalidateQueries({ queryKey: ['requests-board'] });
          navigation.navigate('RequestDetail', { id: created.id });
        }}
      />
    </View>
  );
}

// ─── rows ──────────────────────────────────────────────────────────────

function RequestRow({ request, showOffers, onPress }: { request: PhoneRequest; showOffers?: boolean; onPress: () => void }) {
  const closed = request.status !== 'open';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
      borderColor: request.offer_count > 0 && showOffers ? theme.accent : theme.line,
      ...shadowSoft, padding: 14, marginBottom: 10, opacity: closed ? 0.6 : 1,
    }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 }}>
        <View style={{
          width: 38, height: 38, borderRadius: 12, backgroundColor: theme.chipBg,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <IconRequest size={19} color={theme.ink} sw={1.6} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{
            fontFamily: fonts.arBold, fontSize: 14, color: theme.ink,
            textAlign: 'right', writingDirection: 'ltr',
          }}>
            {deviceTitle(request.brand, request.model)}
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
            حتى {fmtIQD(request.max_price)} د.ع · {conditionLabel(request.condition)}
          </Text>
        </View>
        {closed ? (
          <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: theme.chipBg }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 10.5, color: theme.subtle }}>
              {request.status === 'fulfilled' ? 'تم' : request.status === 'expired' ? 'منتهي' : 'مغلق'}
            </Text>
          </View>
        ) : null}
      </View>

      {request.note ? (
        <Text numberOfLines={2} style={{
          fontFamily: fonts.ar, fontSize: 12.5, color: theme.ink, textAlign: 'right',
          marginTop: 8, lineHeight: 20,
        }}>
          {request.note}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
          <IconPin size={12} color={theme.subtle} sw={1.7} />
          <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>{arOf(request.governorate)}</Text>
        </View>
        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>{timeAgoAr(request.created_at)}</Text>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
          <IconChat size={12} color={request.offer_count > 0 ? theme.accent : theme.subtle} sw={1.7} />
          <Text style={{
            fontFamily: request.offer_count > 0 ? fonts.arBold : fonts.ar, fontSize: 11.5,
            color: request.offer_count > 0 ? theme.accent : theme.subtle,
          }}>
            {request.offer_count > 0 ? `${request.offer_count} عرض` : 'لا عروض بعد'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function SentOfferRow({ offer, onPress }: { offer: SentOffer; onPress: () => void }) {
  const dead = offer.request.status !== 'open';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
      ...shadowSoft, padding: 14, marginBottom: 10, opacity: dead ? 0.6 : 1,
    }}>
      <Text numberOfLines={1} style={{
        fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right', writingDirection: 'ltr',
      }}>
        {deviceTitle(offer.request.brand, offer.request.model)}
      </Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 7 }}>
        <IconTag size={13} color={theme.accent} sw={1.8} />
        <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accent }}>
          عرضك: {fmtIQD(offer.price)} د.ع
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>
          {dead ? (offer.request.status === 'fulfilled' ? 'الطلب انتهى' : 'الطلب مغلق') : timeAgoAr(offer.created_at)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function Empty({ tab, onCompose }: { tab: Tab; onCompose: () => void }) {
  const copy = tab === 'board'
    ? { title: 'ما في طلبات مفتوحة', body: 'كن أول من ينشر طلباً — تراه المتاجر وترد عليك بعروضها.' }
    : tab === 'mine'
      ? { title: 'ما عندك طلبات', body: 'انشر الجهاز الذي تبحث عنه وميزانيتك، ودع البائعين يأتون إليك.' }
      : { title: 'ما قدّمت أي عرض', body: 'افتح «كل الطلبات» واطّلع على المشترين الذين يبحثون عن أجهزة لديك.' };
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <IconRequest size={30} color={theme.subtle} sw={1.5} />
      <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, marginTop: 12, textAlign: 'center' }}>
        {copy.title}
      </Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
        {copy.body}
      </Text>
      {tab !== 'offers' ? (
        <View style={{ marginTop: 16 }}>
          <Btn kind="accent" onPress={onCompose}>اطلب جهازاً</Btn>
        </View>
      ) : null}
    </View>
  );
}

function SignedOut({ navigation }: any) {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.subtle, textAlign: 'center', lineHeight: 22, marginBottom: 16 }}>
        سجّل الدخول لتنشر طلبك — يراه البائعون ويرسلون إليك عروضهم مباشرة.
      </Text>
      <Btn kind="accent" onPress={() => navigation.getParent()?.getParent?.()?.navigate('AuthGate') ?? navigation.navigate('AuthGate')}>
        تسجيل الدخول
      </Btn>
    </View>
  );
}

// ─── compose ───────────────────────────────────────────────────────────

function ComposeSheet({ visible, onClose, defaultGovAr, onCreated }: {
  visible: boolean;
  onClose: () => void;
  defaultGovAr: string;
  onCreated: (r: PhoneRequest) => void;
}) {
  const [brand, setBrand] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [maxPrice, setMaxPrice] = useState(500_000);
  const [condition, setCondition] = useState<string | null>(null);
  const [govAr, setGovAr] = useState(defaultGovAr);
  const [note, setNote] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // The sheet keeps its state while mounted; reset on each open so a
  // cancelled draft doesn't reappear in the next request.
  React.useEffect(() => {
    if (visible) {
      setBrand(null); setModel(''); setMaxPrice(500_000);
      setCondition(null); setGovAr(defaultGovAr); setNote('');
    }
  }, [visible, defaultGovAr]);

  const { data: catalogBrands } = useQuery({
    queryKey: ['device-catalog-brands'],
    queryFn: () => DeviceCatalog.brands('phone'),
    staleTime: 5 * 60 * 1000,
    enabled: visible,
  });

  const create = useMutation({
    mutationFn: () => PhoneRequests.create({
      brand: brand!, model, max_price: maxPrice, condition,
      governorate: govAr ? GOV_AR_TO_EN[govAr] : undefined,
      note: note.trim() || null,
    }),
    onSuccess: (r) => onCreated(r),
    onError: (e: any) => {
      const code = String(e?.message || '');
      // already_open is not a failure — the buyer already has this request
      // live, and re-broadcasting it to the same shops is exactly what the
      // server refused to do.
      if (code.includes('already_open')) {
        Alert.alert('لديك طلب مفتوح للجهاز نفسه', 'افتح «طلباتي» لترى العروض التي وصلتك.');
        onClose();
        return;
      }
      Alert.alert('تعذّر نشر الطلب', code.includes('too_many_open')
        ? 'لديك 5 طلبات مفتوحة. أغلق واحداً قبل نشر طلب جديد.'
        : code.includes('too_many_today')
          ? 'نشرت طلبات كثيرة اليوم. حاول غداً.'
          : code.includes('guest_not_allowed')
            ? 'سجّل الدخول برقم هاتفك ليتمكن البائعون من الوصول إليك.'
            : 'حاول مرة أخرى.');
    },
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: theme.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '92%', paddingBottom: 20,
        }}>
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: theme.line,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>اطلب جهازاً</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <IconClose size={18} color={theme.subtle} sw={1.8} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', lineHeight: 20, marginBottom: 14 }}>
              يصل طلبك إلى المتاجر التي لديها الجهاز أو تبيع الماركة نفسها في محافظتك — فترد عليك بعروضها.
            </Text>

            <Label>الماركة</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}>
              {(catalogBrands || []).map((b) => (
                <Pill key={b.brand} active={brand === b.brand} onPress={() => { setBrand(b.brand); setModel(''); }}>
                  {b.brand}
                </Pill>
              ))}
            </ScrollView>

            <Label style={{ marginTop: 14 }}>الجهاز</Label>
            <TouchableOpacity
              onPress={() => brand && setPickerOpen(true)}
              disabled={!brand}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.lg,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
                opacity: brand ? 1 : 0.5,
              }}
            >
              <Text numberOfLines={1} style={{
                flex: 1, textAlign: 'right', writingDirection: model ? 'ltr' : 'rtl',
                fontFamily: model ? fonts.arBold : fonts.ar, fontSize: 14,
                color: model ? theme.ink : theme.subtle,
              }}>
                {model || (brand ? 'اختر الجهاز…' : 'اختر الماركة أولاً')}
              </Text>
              <IconChevronDown size={16} color={theme.subtle} sw={2} />
            </TouchableOpacity>

            <Label style={{ marginTop: 14 }}>ميزانيتي (د.ع) أو أقل</Label>
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, padding: 10,
            }}>
              <TouchableOpacity onPress={() => setMaxPrice((v) => clampPrice(v - PRICE_STEP))} activeOpacity={0.7}
                style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center' }}>
                <IconMinus size={14} color={theme.ink} sw={2.4} />
              </TouchableOpacity>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{
                flex: 1, textAlign: 'center', fontFamily: fonts.ltrBold, fontSize: 16,
                fontWeight: '700', color: theme.ink, writingDirection: 'ltr',
              }}>
                {fmtIQD(maxPrice)}
              </Text>
              <TouchableOpacity onPress={() => setMaxPrice((v) => clampPrice(v + PRICE_STEP))} activeOpacity={0.7}
                style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center' }}>
                <IconPlus size={14} color={theme.ink} sw={2.4} />
              </TouchableOpacity>
            </View>

            <Label style={{ marginTop: 14 }}>الحالة</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}>
              {CONDITIONS.map((c) => (
                <Pill key={c.key ?? 'any'} active={condition === c.key} onPress={() => setCondition(c.key)}>
                  {c.label}
                </Pill>
              ))}
            </ScrollView>

            <Label style={{ marginTop: 14 }}>المحافظة</Label>
            <GovPicker valueAr={govAr} onChangeAr={setGovAr} />

            <Label style={{ marginTop: 14 }}>ملاحظة (اختياري)</Label>
            <Input
              value={note}
              onChangeText={setNote}
              placeholder="مثلاً: أفضّل اللون الأزرق، ذاكرة 256"
              multiline
            />

            <View style={{ marginTop: 18 }}>
              <Btn kind="primary" full busy={create.isPending} onPress={() => {
                if (!brand || !model) { Alert.alert('أكمل الاختيار', 'اختر الماركة والجهاز أولاً.'); return; }
                if (!govAr) { Alert.alert('اختر المحافظة', 'حتى نوصل طلبك للمتاجر القريبة منك.'); return; }
                create.mutate();
              }}>
                انشر الطلب
              </Btn>
            </View>
          </ScrollView>
        </View>
      </View>

      {brand ? (
        <DevicePickerModal
          visible={pickerOpen}
          brand={brand}
          value={model}
          onClose={() => setPickerOpen(false)}
          onSelect={(m) => { setModel(m); setPickerOpen(false); }}
        />
      ) : null}
    </Modal>
  );
}

function Label({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <Text style={[{
      fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle,
      marginBottom: 6, textAlign: 'right',
    }, style]}>
      {children}
    </Text>
  );
}
