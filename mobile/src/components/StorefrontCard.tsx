// Home-screen entry to the order-taking storefront.
//
// Three real products with prices, not a text link. That's the whole point:
// a pill saying "متجر" asks the reader to take it on faith, while three
// phones with prices and a delivery badge ARE the explanation. The two
// badges answer the first two questions any Iraqi buyer has — how do I pay,
// and what does delivery cost — before they commit to a tap.
//
// The card renders nothing unless the server sends a storefront WITH stock;
// three empty boxes would be worse than no card at all.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius } from '../theme';
import { Img } from './Img';
import { fmtIQD } from './ui';
import { IconStore, IconChevronLeft } from './icons';
import { fullImageUrl } from '../api/upload';

export interface StorefrontProduct {
  id: number;
  brand: string;
  model: string;
  storage?: string | null;
  asking_price: number;
  image_path?: string | null;
}
export type StorefrontCardMode = 'newest' | 'best_selling' | 'most_viewed' | 'custom';
export interface Storefront {
  shop_id: number;
  shop_name: string;
  shipping_fee: number;
  product_count: number;
  // Dashboard-controlled: what the card shows and how it's labelled.
  card_mode?: StorefrontCardMode;
  card_title?: string | null;
  // When set, a single image replaces the three product tiles entirely.
  banner_image?: string | null;
  products: StorefrontProduct[];
}

// The heading tells the shopper WHY these three are here. A "best sellers"
// strip that just says "new devices" wastes the only social proof the card
// has.
const MODE_TITLE: Record<string, string> = {
  newest: 'أجهزة جديدة',
  best_selling: 'الأكثر مبيعاً',
  most_viewed: 'الأكثر مشاهدة',
  custom: 'مختارات المتجر',
};

export function StorefrontCard({
  storefront, onOpenShop, onOpenProduct,
}: {
  storefront: Storefront;
  onOpenShop: () => void;
  // The product, not its listing id — the storefront's product page is keyed
  // on brand+model because one model can be several listings (one per
  // capacity), and tapping a tile should open all of them as options.
  onOpenProduct: (product: StorefrontProduct) => void;
}) {
  const { shop_name, shipping_fee, products, banner_image } = storefront;
  const heading = storefront.card_title
    || MODE_TITLE[storefront.card_mode || 'newest']
    || MODE_TITLE.newest;
  // Banner mode replaces the tiles; otherwise the card still needs products
  // to be worth rendering at all.
  if (!banner_image && !products?.length) return null;

  return (
    <View style={{
      marginTop: 10,
      backgroundColor: theme.surface,
      borderRadius: radius.xxl,
      borderWidth: 2,
      borderColor: theme.accent,
      padding: 12,
    }}>
      <TouchableOpacity
        onPress={onOpenShop}
        activeOpacity={0.85}
        style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}
      >
        <IconStore size={18} color={theme.accent} sw={1.8} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1, fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ink, textAlign: 'right' }}
        >
          {shop_name} · {heading}
        </Text>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <IconChevronLeft size={15} color={theme.subtle} sw={2} />
        </View>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 8, marginBottom: 10 }}>
        <Badge bg={theme.successSoft} fg={theme.success} label="الدفع عند الاستلام" />
        <Badge bg={theme.chipBg} fg={theme.chipInk} label={`توصيل ${fmtIQD(shipping_fee)}`} />
      </View>

      {/* A single banner instead of tiles, when the shop has art it would
          rather lead with than three products. */}
      {banner_image ? (
        <TouchableOpacity onPress={onOpenShop} activeOpacity={0.9} style={{
          borderRadius: radius.lg, overflow: 'hidden', backgroundColor: theme.bg,
        }}>
          <Img
            source={{ uri: banner_image }}
            contentFit="cover"
            style={{ width: '100%', aspectRatio: 16 / 9 }}
          />
        </TouchableOpacity>
      ) : (
      /* Tapping a product goes straight to it — a shopper who has already
         picked one shouldn't have to find it again inside the shop. */
      <View style={{ flexDirection: 'row-reverse', gap: 6 }}>
        {products.slice(0, 3).map((p) => (
          <TouchableOpacity
            key={p.id}
            onPress={() => onOpenProduct(p)}
            activeOpacity={0.85}
            style={{ flex: 1, backgroundColor: theme.bg, borderRadius: radius.lg, padding: 6 }}
          >
            <View style={{
              height: 62, borderRadius: 8, overflow: 'hidden',
              backgroundColor: theme.chipBg, marginBottom: 5,
            }}>
              {p.image_path ? (
                <Img source={{ uri: fullImageUrl(p.image_path) }} style={{ width: '100%', height: 62 }} />
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.ink, textAlign: 'right' }}
            >
              {p.model}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.ltrBold, fontSize: 11.5, color: theme.accentDeep, textAlign: 'right' }}
            >
              {fmtIQD(p.asking_price)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      )}

      <TouchableOpacity
        onPress={onOpenShop}
        activeOpacity={0.85}
        style={{
          marginTop: 10, backgroundColor: theme.accent, borderRadius: radius.lg,
          paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: '#fff' }}>
          اشترِ جهاز جديد
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Badge({ bg, fg, label }: { bg: string; fg: string; label: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 10.5, color: fg }}>{label}</Text>
    </View>
  );
}
