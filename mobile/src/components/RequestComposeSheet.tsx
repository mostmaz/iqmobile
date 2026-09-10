// The «اطلب جهازاً» sheet — brand, catalogue device, stepped budget,
// condition, governorate, note.
//
// Lifted out of RequestsScreen so the request funnel can open the same sheet
// pre-filled with whatever the buyer was browsing. Behaviour is unchanged;
// the only addition is the two initial* props.
//
// Mirrors WishlistScreen's add panel deliberately: a buyer who has used one
// should recognise the other instantly.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Modal, KeyboardAvoidingView } from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { theme, fonts, radius } from '../theme';
import { Btn, Pill, Input, fmtIQD } from './ui';
import { IconPlus, IconMinus, IconChevronDown, IconClose } from './icons';
import { DevicePickerModal } from './DevicePickerModal';
import { GovPicker } from './GovPicker';
import { PhoneRequests, DeviceCatalog, Listings, Brands, type PhoneRequest } from '../api/endpoints';
import { foldModelKey, orderComposeBrands } from '../lib/requestFunnel';
import { GOV_AR_TO_EN } from '../lib/governorates';
import { SELLABLE_CONDITIONS } from '../lib/conditions';
import { ar } from '../i18n/ar';

const PRICE_STEP = 25_000;
const PRICE_MIN = 50_000;
const PRICE_MAX = 10_000_000;
const clampPrice = (v: number) => Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(v / PRICE_STEP) * PRICE_STEP));

// A third literal copy of the taxonomy used to live here, with its own
// labels. It is derived now — a buyer asking for a condition nobody may post
// would be waiting for offers that cannot come, so this follows the SELL
// list, not the filter list.
export const CONDITIONS: { key: string | null; label: string }[] = [
  { key: null, label: 'أي حالة' },
  ...SELLABLE_CONDITIONS.map((c) => ({ key: c as string, label: (ar.listing as any)[c] as string })),
];
export const conditionLabel = (k?: string | null) => CONDITIONS.find((c) => c.key === k)?.label || 'أي حالة';

export function RequestComposeSheet({
  visible, onClose, defaultGovAr, onCreated, initialBrand, initialModel, onSeeAvailable,
}: {
  visible: boolean;
  onClose: () => void;
  defaultGovAr: string;
  onCreated: (r: PhoneRequest) => void;
  /**
   * Called when the buyer taps through to the devices that already exist.
   * Optional: where a host cannot show them, the availability line still
   * renders as information — it just is not a link.
   */
  onSeeAvailable?: (brand: string, model: string) => void;
  /**
   * What the sheet opens with. The request funnel passes the brand and model
   * the buyer was just looking at, so «اطلب جهاز آخر» after an empty list is
   * one budget away from posting rather than three taps of re-choosing.
   * Both are still editable once open.
   */
  initialBrand?: string | null;
  initialModel?: string;
}) {
  const [brand, setBrand] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [maxPrice, setMaxPrice] = useState(500_000);
  const [condition, setCondition] = useState<string | null>(null);
  const [govAr, setGovAr] = useState(defaultGovAr);
  const [note, setNote] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // The sheet keeps its state while mounted; reset on each open so a
  // cancelled draft doesn't reappear in the next request. Seeded from the
  // initial* props when the caller has them, blank otherwise.
  React.useEffect(() => {
    if (visible) {
      setBrand(initialBrand ?? null); setModel(initialModel ?? ''); setMaxPrice(500_000);
      setCondition(null); setGovAr(defaultGovAr); setNote('');
    }
  }, [visible, defaultGovAr, initialBrand, initialModel]);

  const brandRailRef = React.useRef<ScrollView>(null);
  const condRailRef = React.useRef<ScrollView>(null);

  const { data: catalogBrands } = useQuery({
    queryKey: ['device-catalog-brands'],
    queryFn: () => DeviceCatalog.brands('phone'),
    staleTime: 5 * 60 * 1000,
    enabled: visible,
  });
  // Same query key the funnel and browse use, so this is a cache read
  // rather than a third request when the sheet opens.
  const { data: brandSupply } = useQuery({
    queryKey: ['brands'],
    queryFn: () => Brands.list(),
    staleTime: 5 * 60 * 1000,
    enabled: visible,
  });
  // The rail's names come from the catalogue (the model picker queries it
  // with whatever is tapped here); its ORDER comes from real listings.
  const railBrands = React.useMemo(
    () => orderComposeBrands(catalogBrands, brandSupply as any),
    [catalogBrands, brandSupply],
  );

  // A THIRD trigger for the RTL rail, on top of the two callbacks on the
  // ScrollView itself.
  //
  // Both callbacks are edge-triggered, and the brand list arrives in two
  // steps (the catalogue, then the reorder by real supply) AFTER the sheet is
  // already up — its queries are `enabled: visible`. Whichever of layout and
  // content-size fires last can fire while the other side is still zero, and
  // a scrollToEnd against a zero-width viewport, or against no content, is a
  // silent no-op. The rail then opens on Google/Itel/POCO instead of Apple,
  // which is exactly what it did once the sheet moved up to the tab level.
  //
  // Keyed on the LENGTH, not the array: a reorder that keeps the count must
  // not yank the rail back under a buyer who has already scrolled it.
  const railCount = railBrands.length;
  React.useEffect(() => {
    if (!visible || railCount === 0) return;
    const t = setTimeout(() => brandRailRef.current?.scrollToEnd({ animated: false }), 0);
    return () => clearTimeout(t);
  }, [visible, railCount]);

  // Is the thing they are about to ask for already on sale? Reuses the
  // funnel's top-models endpoint rather than adding a count route: it is one
  // request per brand and already returns exactly this number.
  const avail = useQuery({
    queryKey: ['top-models', brand, 60],
    queryFn: () => Listings.topModels(brand!, 60),
    enabled: visible && !!brand,
    staleTime: 60_000,
  });
  const availableCount = React.useMemo(() => {
    if (!model || !avail.data) return 0;
    const want = foldModelKey(model);
    return avail.data.find((m) => foldModelKey(m.model) === want)?.count ?? 0;
  }, [avail.data, model]);

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
      {/* Padding on BOTH platforms. The app is edge-to-edge, so Android's
          adjustResize no longer resizes the window and the IME is drawn over
          the sheet — «الحالة», the governorate and the note sat under the
          keys. ChatScreen carries the same fix and the same comment; no
          offset here because the sheet is not under a header. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}
      >
        {/* 26, not the shared scale's 20 — a sheet rounds harder than the
            cards inside it, or its corners read as another card. */}
        <View style={{
          backgroundColor: theme.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26,
          maxHeight: '92%', paddingBottom: 20,
        }}>
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: theme.line,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink }}>اطلب جهازاً</Text>
            {/* A bare glyph on a sheet has no edge to aim at. The tile gives
                the close button a body, which is what makes it read as a
                control rather than as decoration in the corner. */}
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                width: 32, height: 32, borderRadius: 11, backgroundColor: theme.chipBg,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <IconClose size={17} color={theme.subtle} sw={1.8} />
            </TouchableOpacity>
          </View>

          {/* automaticallyAdjustKeyboardInsets, or the keyboard opens straight
              over «الحالة», the governorate and the note — the fields at the
              bottom of the sheet — and the buyer types blind. The sell form
              carries the same prop for the same reason. */}
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
          >
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', lineHeight: 20, marginBottom: 14 }}>
              يصل طلبك إلى من عنده الجهاز — متاجر وأشخاص باعوا نفس الماركة — فيردون عليك بعروضهم.
            </Text>

            <Label>الماركة</Label>
            {/* row-reverse lays the first brand at the far RIGHT of the
                content, but a horizontal ScrollView opens at offset 0 — the
                LEFT edge — so the rail opened on the tail of the list and the
                buyer saw the rarest brands first. Scrolling to the end on
                layout puts it back at the RTL start. Browse and Search carry
                the same fix. */}
            <ScrollView
              ref={brandRailRef}
              horizontal showsHorizontalScrollIndicator={false}
              // BOTH callbacks, not just onContentSizeChange. Inside a Modal
              // the content can be measured before the scroller knows its own
              // width, and a scrollToEnd against a zero-width viewport is a
              // no-op — so the rail opened on the tail anyway. onLayout fires
              // once the width is real and puts it back at the RTL start.
              onContentSizeChange={() => brandRailRef.current?.scrollToEnd({ animated: false })}
              onLayout={() => brandRailRef.current?.scrollToEnd({ animated: false })}
              contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}>
              {railBrands.map((b) => (
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
              backgroundColor: theme.inset, borderRadius: radius.lg, padding: 9,
            }}>
              {/* The buttons are white ON the track rather than tinted
                  against a white field — it is the track that has to read as
                  one control, and two grey circles on a white row read as two
                  buttons with a number between them. */}
              <TouchableOpacity onPress={() => setMaxPrice((v) => clampPrice(v - PRICE_STEP))} activeOpacity={0.7}
                accessibilityRole="button" accessibilityLabel="أنقص الميزانية"
                style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
                <IconMinus size={14} color={theme.ink} sw={2.4} />
              </TouchableOpacity>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{
                flex: 1, textAlign: 'center', fontFamily: fonts.ltrBold, fontSize: 18,
                fontWeight: '700', color: theme.ink, writingDirection: 'ltr',
              }}>
                {fmtIQD(maxPrice)}
              </Text>
              <TouchableOpacity onPress={() => setMaxPrice((v) => clampPrice(v + PRICE_STEP))} activeOpacity={0.7}
                accessibilityRole="button" accessibilityLabel="زد الميزانية"
                style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
                <IconPlus size={14} color={theme.ink} sw={2.4} />
              </TouchableOpacity>
            </View>

            <Label style={{ marginTop: 14 }}>الحالة</Label>
            <ScrollView
              ref={condRailRef}
              horizontal showsHorizontalScrollIndicator={false}
              onContentSizeChange={() => condRailRef.current?.scrollToEnd({ animated: false })}
              onLayout={() => condRailRef.current?.scrollToEnd({ animated: false })}
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

            {/* Posting a request for a phone that is already on sale wastes
                the buyer's wait and every shop's reply. Say so before the
                button, not after — and never block it: their budget or
                governorate may rule all of these out. */}
            {availableCount > 0 ? (
              <View style={{
                marginTop: 16, padding: 12, borderRadius: radius.lg,
                backgroundColor: theme.successSoft, borderWidth: 1, borderColor: theme.success, gap: 8,
              }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.success, textAlign: 'right' }}>
                  {availableCount === 1
                    ? `يوجد جهاز ${model} معروض الآن`
                    : `يوجد ${availableCount} من ${model} معروضة الآن`}
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', lineHeight: 19 }}>
                  تقدر تشوفها فوراً بدل ما تنتظر عروض المتاجر.
                </Text>
                {onSeeAvailable ? (
                  <TouchableOpacity
                    onPress={() => { onClose(); onSeeAvailable(brand!, model); }}
                    accessibilityRole="button"
                    style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
                  >
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accent }}>
                      شوف المعروض الآن
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

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
      </KeyboardAvoidingView>

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
