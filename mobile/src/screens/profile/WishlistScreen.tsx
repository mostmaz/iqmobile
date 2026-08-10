import { deviceTitle } from '../../lib/format';
// Wish list — "I want THIS device at THIS price or less". The user keeps a
// list of wanted devices (exact catalog models) with a price ceiling each;
// the server pushes a notification when a matching listing appears (newly
// posted, or an existing listing whose price drops through the ceiling).
//
// Route params (all optional) prefill the add panel — the listing detail
// screen navigates here with { brand, model, price } for one-tap "I want
// this device cheaper".

import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Btn, Header, Pill, fmtIQD } from '../../components/ui';
import { IconBell, IconClose, IconMinus, IconPlus, IconChevronDown } from '../../components/icons';
import { Wishlist, DeviceCatalog, type WishItem } from '../../api/endpoints';
import { DevicePickerModal } from '../../components/DevicePickerModal';
import { TextRowListSkeleton } from '../../components/Skeleton';
import { useAuth } from '../../auth/AuthContext';

const PRICE_STEP = 25_000;
const PRICE_MIN = 50_000;
const PRICE_MAX = 10_000_000;
const clampPrice = (v: number) => Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(v / PRICE_STEP) * PRICE_STEP));

export default function WishlistScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isReal = !!user && !(user as any).is_guest;

  const prefill = route?.params || {};
  const [adding, setAdding] = useState(!!(prefill.brand && prefill.model));
  const [brand, setBrand] = useState<string | null>(prefill.brand || null);
  const [model, setModel] = useState<string>(prefill.model || '');
  const [maxPrice, setMaxPrice] = useState<number>(prefill.price ? clampPrice(Number(prefill.price)) : 500_000);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => Wishlist.list(),
    enabled: isReal,
  });

  // Brands that actually have catalog devices — same source the picker uses.
  const { data: catalogBrands } = useQuery({
    queryKey: ['device-catalog-brands'],
    queryFn: () => DeviceCatalog.brands('phone'),
    staleTime: 5 * 60 * 1000,
    enabled: adding,
  });

  const addWish = useMutation({
    mutationFn: () => Wishlist.add(brand!, model, maxPrice),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wishlist'] });
      setAdding(false); setBrand(null); setModel('');
      Alert.alert('أُضيف إلى قائمة الرغبات ✅', 'سنرسل لك تنبيهاً فور توفّر هذا الجهاز ضمن ميزانيتك.');
    },
    onError: (e: any) => {
      const code = String(e?.message || '');
      Alert.alert('تعذّرت الإضافة', code.includes('too_many')
        ? 'بلغت الحد الأقصى لقائمة الرغبات (20). احذف عنصراً أولاً.'
        : 'حاول مرة أخرى.');
    },
  });

  const removeWish = useMutation({
    mutationFn: (id: number) => Wishlist.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  });

  function confirmDelete(item: WishItem) {
    Alert.alert('حذف من قائمة الرغبات', `${item.brand} ${item.model} — أقل من ${fmtIQD(item.max_price)} د.ع`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => removeWish.mutate(item.id) },
    ]);
  }

  if (!isReal) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <Header title="قائمة الرغبات" onBack={() => navigation.goBack()} />
        <View style={{ padding: 32, alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.subtle, textAlign: 'center', lineHeight: 22, marginBottom: 16 }}>
            سجّل الدخول لإنشاء قائمة رغباتك وتلقّي تنبيه عند توفّر الجهاز الذي تريده بالسعر الذي يناسبك.
          </Text>
          <Btn kind="accent" onPress={() => navigation.getParent()?.getParent?.()?.navigate('AuthGate') ?? navigation.navigate('AuthGate')}>
            تسجيل الدخول
          </Btn>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title="قائمة الرغبات" onBack={() => navigation.goBack()} />

      {/* Add panel */}
      <View style={{ paddingHorizontal: 16 }}>
        {!adding ? (
          <TouchableOpacity
            onPress={() => setAdding(true)}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
              paddingVertical: 12, borderRadius: radius.lg, marginBottom: 12,
              borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.accentSoft,
            }}
          >
            <IconPlus size={15} color={theme.accent} sw={2.2} />
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.accent }}>
              أضف جهازاً أريده
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{
            padding: 14, marginBottom: 12, borderRadius: radius.xxl,
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
          }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6, textAlign: 'right' }}>
              الماركة
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}>
              {(catalogBrands || []).map((b) => (
                <Pill key={b.brand} active={brand === b.brand}
                  onPress={() => { setBrand(b.brand); setModel(''); }}>
                  {b.brand}
                </Pill>
              ))}
            </ScrollView>

            <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 12, marginBottom: 6, textAlign: 'right' }}>
              الجهاز
            </Text>
            <TouchableOpacity
              onPress={() => brand && setPickerOpen(true)}
              disabled={!brand}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.lg,
                backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line,
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

            <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 12, marginBottom: 6, textAlign: 'right' }}>
              أريده بسعر (د.ع) أو أقل
            </Text>
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg, padding: 10,
            }}>
              <TouchableOpacity onPress={() => setMaxPrice((v) => clampPrice(v - PRICE_STEP))} activeOpacity={0.7}
                style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center' }}>
                <IconMinus size={14} color={theme.ink} sw={2.4} />
              </TouchableOpacity>
              <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.ltrBold, fontSize: 16, fontWeight: '700', color: theme.ink, writingDirection: 'ltr' }}
                numberOfLines={1} adjustsFontSizeToFit>
                {fmtIQD(maxPrice)}
              </Text>
              <TouchableOpacity onPress={() => setMaxPrice((v) => clampPrice(v + PRICE_STEP))} activeOpacity={0.7}
                style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center' }}>
                <IconPlus size={14} color={theme.ink} sw={2.4} />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 14 }}>
              <Btn kind="ghost" full onPress={() => { setAdding(false); setBrand(null); setModel(''); }}>إلغاء</Btn>
              <Btn kind="primary" full busy={addWish.isPending}
                onPress={() => {
                  if (!brand || !model) { Alert.alert('أكمل الاختيار', 'اختر الماركة والجهاز أولاً.'); return; }
                  addWish.mutate();
                }}>
                أضف ونبّهني
              </Btn>
            </View>
          </View>
        )}
      </View>

      {isLoading ? (
        <TextRowListSkeleton count={4} />
      ) : (
        <FlatList
          data={data || []}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 100 }}
          refreshing={isLoading}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
              padding: 14, marginBottom: 10, borderRadius: radius.lg,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, textAlign: 'right', writingDirection: 'ltr' }}>
                  {deviceTitle(item.brand, item.model)}
                </Text>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <IconBell size={13} color={theme.accent} sw={1.7} />
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                    نبّهني بسعر {fmtIQD(item.max_price)} د.ع أو أقل
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => confirmDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
                <IconClose size={16} color={theme.subtle} sw={1.7} />
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={!adding ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <IconBell size={30} color={theme.subtle} sw={1.5} />
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, marginTop: 12, textAlign: 'center' }}>
                قائمة رغباتك فارغة
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
                أضف الجهاز الذي تبحث عنه وحدّد ميزانيتك — وسنخبرك فور توفّره.
              </Text>
            </View>
          ) : null}
        />
      )}

      {brand ? (
        <DevicePickerModal
          visible={pickerOpen}
          brand={brand}
          value={model}
          onClose={() => setPickerOpen(false)}
          onSelect={(m) => { setModel(m); setPickerOpen(false); }}
        />
      ) : null}
    </View>
  );
}
