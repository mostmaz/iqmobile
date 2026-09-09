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
import { View, Text, TouchableOpacity, ScrollView, Alert, Modal } from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { theme, fonts, radius } from '../theme';
import { Btn, Pill, Input, fmtIQD } from './ui';
import { IconPlus, IconMinus, IconChevronDown, IconClose } from './icons';
import { DevicePickerModal } from './DevicePickerModal';
import { GovPicker } from './GovPicker';
import { PhoneRequests, DeviceCatalog, Listings, type PhoneRequest } from '../api/endpoints';
import { foldModelKey } from '../lib/requestFunnel';
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

  const { data: catalogBrands } = useQuery({
    queryKey: ['device-catalog-brands'],
    queryFn: () => DeviceCatalog.brands('phone'),
    staleTime: 5 * 60 * 1000,
    enabled: visible,
  });

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
