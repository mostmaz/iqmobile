// Add-to-cart control that sits under a listing card in a storefront shop.
//
// Two states: "add" before the item is in the basket, and a stepper after,
// so the customer can adjust quantity without opening the cart. Switching
// in place (rather than pushing a screen) keeps browsing uninterrupted.

import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { theme, fonts, radius } from '../theme';
import { IconPlus, IconMinus } from './icons';
import { useCart } from '../lib/cart';
import type { Listing } from '../api/endpoints';

export function AddToCartRow({
  listing, shop,
}: {
  listing: Listing;
  shop: { id: number; name: string; shipping_fee: number };
}) {
  const cart = useCart();
  const qty = cart.qtyOf(listing.id);

  const line = {
    listing_id: listing.id,
    brand: listing.brand,
    model: listing.model,
    storage: (listing as any).storage ?? null,
    color: (listing as any).color ?? null,
    image_path: listing.images?.[0]?.image_path ?? null,
    unit_price: listing.asking_price,
  };

  function add() {
    const ok = cart.add(shop, line, 1);
    // A cart is one shop's delivery with one shipping fee, so an item from a
    // different shop can't just be appended. Ask before discarding.
    if (!ok) {
      Alert.alert(
        'سلة من متجر آخر',
        `سلتك تحتوي أجهزة من "${cart.shop_name}". تريد إفراغها والبدء بطلب من "${shop.name}"؟`,
        [
          { text: 'رجوع', style: 'cancel' },
          { text: 'ابدأ سلة جديدة', style: 'destructive', onPress: () => cart.replaceWith(shop, line, 1) },
        ],
      );
    }
  }

  if (!qty) {
    return (
      <TouchableOpacity
        onPress={add}
        activeOpacity={0.85}
        style={{
          marginTop: -4, marginBottom: 4, paddingVertical: 9,
          borderRadius: radius.lg, backgroundColor: theme.ink,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk }}>
          إضافة للسلة
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{
      marginTop: -4, marginBottom: 4, paddingVertical: 6, paddingHorizontal: 10,
      borderRadius: radius.lg, backgroundColor: theme.accentSoft,
      borderWidth: 1, borderColor: theme.accent,
      flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accentDeep }}>
        في السلة
      </Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12 }}>
        <TouchableOpacity onPress={() => cart.setQty(listing.id, qty + 1)} style={btn}>
          <IconPlus size={13} color={theme.accentDeep} sw={2.2} />
        </TouchableOpacity>
        <Text style={{ fontFamily: fonts.ltrBold, fontSize: 14, color: theme.accentDeep, minWidth: 14, textAlign: 'center' }}>
          {qty}
        </Text>
        <TouchableOpacity onPress={() => cart.setQty(listing.id, qty - 1)} style={btn}>
          <IconMinus size={13} color={theme.accentDeep} sw={2.2} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const btn = {
  width: 26, height: 26, borderRadius: 999,
  alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: theme.surface,
};
