// Shops directory — businesses filterable by governorate and defaulting to
// the shopper's own, featured shops floated to the top (the server orders
// them). Tapping a shop opens its page (listings + contact). A "register my
// shop" CTA sits up top — free for now (self-serve), with a WhatsApp-contact
// alternative on the register screen.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Img } from '../../components/Img';
import { IconStore, IconStar, IconPin, IconSpark, IconPlus, IconChevronLeft } from '../../components/icons';
import { GovPicker } from '../../components/GovPicker';
import { ShopListSkeleton } from '../../components/Skeleton';
import { Shops, type ShopCard } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';

export default function ShopsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  // Open on the user's own governorate rather than the whole country — a
  // buyer in Mosul scrolling past Baghdad shops they can't reach is noise.
  // Read through GOV_EN_TO_AR rather than arOf(): arOf falls back to echoing
  // its input, and an unmapped value would set a filter the picker can't
  // round-trip back to English, silently emptying the list.
  const homeGovAr = (user?.governorate && GOV_EN_TO_AR[user.governorate]) || '';
  const [govAr, setGovAr] = useState(homeGovAr);
  // The default applies once. `user` may hydrate a frame or two after first
  // render, so it can't just be the initial state — but once the shopper has
  // touched the picker (or we've already applied it) we must never reach in
  // and change their filter underneath them.
  const govPinned = useRef(!!homeGovAr);
  useEffect(() => {
    if (govPinned.current || !homeGovAr) return;
    govPinned.current = true;
    setGovAr(homeGovAr);
  }, [homeGovAr]);
  const govEn = govAr ? GOV_AR_TO_EN[govAr] : undefined;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['shops', govEn ?? '__all__'],
    queryFn: () => Shops.list(govEn),
  });
  useFocusEffect(React.useCallback(() => { refetch(); }, [refetch]));
  const shops = useMemo(() => data ?? [], [data]);

  const isShop = user?.seller_type === 'shop';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
            <IconStore size={17} color="#fff" sw={1.8} />
          </View>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, fontWeight: '700', color: theme.ink, flex: 1, textAlign: 'right' }}>
            المتاجر
          </Text>
        </View>

        {/* Register / manage shop CTA */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('ShopRegister')}
          style={{
            flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
            backgroundColor: isShop ? theme.surface : theme.ink,
            borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg,
            paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
          }}
        >
          <IconPlus size={18} color={isShop ? theme.ink : theme.buttonInk} sw={2} />
          <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 14, fontWeight: '700', color: isShop ? theme.ink : theme.buttonInk, textAlign: 'right' }}>
            {isShop ? 'إدارة متجري' : 'سجّل متجرك مجاناً'}
          </Text>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconChevronLeft size={14} color={isShop ? theme.subtle : theme.buttonInk} sw={2} />
          </View>
        </TouchableOpacity>

        <GovPicker
          valueAr={govAr}
          onChangeAr={(v) => { govPinned.current = true; setGovAr(v); }}
          allowAll
          allLabel="كل المحافظات"
        />
      </View>

      <FlatList
        data={shops}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, paddingTop: 6 }}
        renderItem={({ item }) => (
          <ShopRow shop={item} onPress={() => navigation.navigate('ShopDetail', { id: item.id })} />
        )}
        ListEmptyComponent={!isLoading ? (
          <View style={{ padding: 48, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 14, textAlign: 'center' }}>
              لا توجد متاجر {govAr ? `في ${govAr}` : 'بعد'}.
            </Text>
            {/* Landing on an empty screen because the default filter happens
                to be a governorate with no shops yet is a dead end — offer the
                way out explicitly rather than widening the filter silently. */}
            {govAr ? (
              <TouchableOpacity
                onPress={() => { govPinned.current = true; setGovAr(''); }}
                activeOpacity={0.85}
                style={{
                  marginTop: 14, paddingHorizontal: 16, paddingVertical: 10,
                  borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
                  backgroundColor: theme.surface,
                }}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, fontWeight: '700', color: theme.ink }}>
                  عرض متاجر كل المحافظات
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <ShopListSkeleton count={5} />
        )}
      />
    </View>
  );
}

function ShopRow({ shop, onPress }: { shop: ShopCard; onPress: () => void }) {
  const logo = shop.shop_image_path || shop.profile_image_path;
  const initial = (shop.shop_name || shop.display_name || '?').trim()[0] || '?';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
      borderColor: shop.is_featured ? theme.accent : theme.line, ...shadowSoft,
      padding: 12, marginBottom: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
    }}>
      <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {logo ? (
          <Img source={{ uri: fullImageUrl(logo) }} style={{ width: 56, height: 56 }} />
        ) : (
          <Text style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 22, color: theme.subtle }}>{initial}</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 15, color: theme.ink, textAlign: 'right', flexShrink: 1 }}>
            {shop.shop_name}
          </Text>
          {shop.is_featured ? (
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 2, backgroundColor: theme.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
              <IconSpark size={9} color="#fff" />
              <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 9, fontWeight: '700' }}>مميّز</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <IconPin size={11} color={theme.subtle} />
          <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
            {arOf(shop.governorate)}{shop.city ? ` · ${shop.city}` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 5 }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>{shop.listing_count} إعلان</Text>
          {shop.rating_count > 0 && Number.isFinite(shop.rating_avg as any) ? (
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}>
              <IconStar size={11} filled color={theme.accent} />
              <Text style={{ fontFamily: fonts.ltr, fontSize: 11.5, color: theme.subtle }}>{Number(shop.rating_avg).toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ transform: [{ scaleX: -1 }] }}>
        <IconChevronLeft size={16} color={theme.subtle} sw={2} />
      </View>
    </TouchableOpacity>
  );
}
