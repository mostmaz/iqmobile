// Home-hub card — the top-of-feed segmented entry (design_handoff_shops §A,
// option 2b). One card, two segments: the order-taking IQ Mobile storefront
// (three product tiles + buy CTA) and "كل المتاجر" (three dashboard-picked
// shops + directory CTA). Replaces the old stacked pair — a ~240px store
// card plus a separate shops row ate the whole first screen; this keeps one
// card height for both worlds and swapping segments never changes the card's
// height, so the feed below doesn't jump.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, FONT_SCALE_TIGHT } from '../theme';
import { Img } from './Img';
import { fmtIQD } from './ui';
import { fullImageUrl } from '../api/upload';
import type { Storefront, StorefrontProduct } from './StorefrontCard';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

export interface HomeShop {
  id: number;
  name: string;
  city?: string | null;
  governorate?: string | null;
  logo?: string | null;
}

export function HomeHubCard({
  storefront, shops, shopsTotal, onOpenProduct, onOpenStore, onOpenDirectory, onOpenShopPage,
}: {
  storefront: Storefront | null;
  shops: HomeShop[];
  shopsTotal: number;
  onOpenProduct: (p: StorefrontProduct) => void;
  onOpenStore: () => void;
  onOpenDirectory: () => void;
  onOpenShopPage: (id: number) => void;
}) {
  const [seg, setSeg] = useState<'store' | 'shops'>('store');
  // No storefront (server sends null when the store has no stock) → the
  // card still earns its place as the shops entry, minus the toggle.
  const hasStore = !!storefront && storefront.products.length > 0;
  const active = hasStore ? seg : 'shops';

  return (
    <View style={{
      backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1,
      borderColor: theme.line, padding: 10, marginBottom: 12,
    }}>
      {/* Segmented control */}
      {hasStore ? (
        <View style={{
          flexDirection: 'row-reverse', backgroundColor: theme.chipBg,
          borderRadius: 999, padding: 3, marginBottom: 10,
        }}>
          <Segment label="متجر IQ Mobile" on={active === 'store'} onPress={() => setSeg('store')} />
          <Segment label="كل المتاجر" on={active === 'shops'} onPress={() => setSeg('shops')} />
        </View>
      ) : null}

      {active === 'store' && storefront ? (
        <>
          <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
            {storefront.products.slice(0, 3).map((p) => (
              <TouchableOpacity
                key={p.id}
                activeOpacity={0.85}
                onPress={() => onOpenProduct(p)}
                style={{ flex: 1, backgroundColor: theme.bg, borderRadius: 12, padding: 6, alignItems: 'center' }}
              >
                <View style={{ width: 52, height: 52, borderRadius: 8, backgroundColor: theme.chipBg, overflow: 'hidden' }}>
                  {p.image_path ? (
                    <Img source={{ uri: fullImageUrl(p.image_path) }} contentFit="cover" style={{ width: 52, height: 52 }} />
                  ) : null}
                </View>
                <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_TIGHT}
                  style={{ marginTop: 5, fontFamily: fonts.arBold, fontSize: 11, color: theme.ink, textAlign: 'center' }}>
                  {p.model}
                </Text>
                <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_TIGHT}
                  style={{ marginTop: 1, fontFamily: fonts.ltrBold, fontSize: 10.5, color: theme.accentDeep }}>
                  {p.price_on_request ? 'اتصل للسعر' : fmtIQD(p.asking_price)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={onOpenStore}
            style={{ marginTop: 10, backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 10, alignItems: 'center' }}
          >
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: '#fff' }}>
              اشترِ جهاز جديد
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
            {shops.slice(0, 3).map((s) => (
              <TouchableOpacity
                key={s.id}
                activeOpacity={0.85}
                onPress={() => onOpenShopPage(s.id)}
                style={{ flex: 1, backgroundColor: theme.bg, borderRadius: 12, padding: 6, alignItems: 'center' }}
              >
                <View style={{ width: 52, height: 52, borderRadius: 8, backgroundColor: theme.chipBg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                  {s.logo ? (
                    <Img source={{ uri: fullImageUrl(s.logo) }} contentFit="cover" style={{ width: 52, height: 52 }} />
                  ) : (
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.subtle }}>
                      {(s.name || '؟').trim()[0]}
                    </Text>
                  )}
                </View>
                <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_TIGHT}
                  style={{ marginTop: 5, fontFamily: fonts.arBold, fontSize: 11, color: theme.ink, textAlign: 'center' }}>
                  {s.name}
                </Text>
                <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_TIGHT}
                  style={{ marginTop: 1, fontFamily: fonts.ar, fontSize: 10, color: theme.subtle }}>
                  {s.city || ' '}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={onOpenDirectory}
            style={{ marginTop: 10, backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 10, alignItems: 'center' }}
          >
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: '#fff' }}>
              تصفّح المتاجر{shopsTotal ? ` (${arNum(shopsTotal)})` : ''}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function Segment({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center',
        backgroundColor: on ? theme.ink : 'transparent',
      }}
    >
      <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_TIGHT}
        style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: on ? theme.surface : theme.chipInk }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}
