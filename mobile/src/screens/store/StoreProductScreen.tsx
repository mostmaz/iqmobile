// Storefront product page — one model, its options, and a buy button.
//
// The marketplace's ListingDetail sells a specific second-hand unit: photos,
// condition, seller trust, chat. A storefront product sells a CHOICE. So this
// screen leads with the gallery, then the option pickers, and the price
// re-renders as the shopper picks — because the price IS the consequence of
// the choice, and hiding that until the cart is how carts get abandoned.
//
// Each option combination is a real listing behind the scenes, so adding to
// the cart stores that listing's id and checkout is unchanged.

import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, Dimensions, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Img } from '../../components/Img';
import { fmtIQD } from '../../components/ui';
import { FullScreenGallery } from '../../components/FullScreenGallery';
import { SkBlock } from '../../components/Skeleton';
import {
  IconArrowLeft, IconMsgCall, IconBox, IconPlus, IconMinus, IconCheck, IconShield,
} from '../../components/icons';
import { Storefront, type StoreVariant } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { useCart } from '../../lib/cart';
import { callPhone } from '../../lib/contact';

const SCREEN_W = Dimensions.get('window').width;
// Buy bar: 10 top + 48 button + 10 bottom + 1 border. The ScrollView pads by
// exactly this so the last card clears it instead of being sliced in half.
const BUY_BAR_H = 69;

export default function StoreProductScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const shopId: number = route.params?.shopId;
  const brand: string = route.params?.brand;
  const model: string = route.params?.model;
  const cart = useCart();

  const { data: product, isLoading } = useQuery({
    queryKey: ['storefront-product', shopId, brand, model],
    queryFn: () => Storefront.product(shopId, brand, model),
  });

  const [storage, setStorage] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);

  const variants = product?.variants || [];

  // Default to the cheapest variant (the server returns them price-ascending)
  // so the headline price is the one the grid tile promised.
  const defaults = useMemo(() => {
    const v = variants[0];
    return { storage: v?.storage ?? null, color: v?.color ?? null };
  }, [variants]);
  const selStorage = storage ?? defaults.storage;
  const selColor = color ?? defaults.color;

  const selected: StoreVariant | undefined = useMemo(() => {
    if (!variants.length) return undefined;
    return (
      variants.find((v) => v.storage === selStorage && v.color === selColor)
      || variants.find((v) => v.storage === selStorage)
      || variants[0]
    );
  }, [variants, selStorage, selColor]);

  // A capacity that only exists in one colour must not look pickable in
  // another — grey it out rather than silently switching the colour.
  const storageAvailable = (s: string) =>
    variants.some((v) => v.storage === s && (!selColor || v.color === selColor));
  const colorAvailable = (c: string) =>
    variants.some((v) => v.color === c && (!selStorage || v.storage === selStorage));

  function pickStorage(s: string) {
    setStorage(s);
    // Keep the colour if this capacity comes in it; otherwise fall to the
    // first colour that does, so the selection is always a real variant.
    if (selColor && !variants.some((v) => v.storage === s && v.color === selColor)) {
      setColor(variants.find((v) => v.storage === s)?.color ?? null);
    }
  }
  function pickColor(c: string) {
    setColor(c);
    if (selStorage && !variants.some((v) => v.color === c && v.storage === selStorage)) {
      setStorage(variants.find((v) => v.color === c)?.storage ?? null);
    }
  }

  // Colour-specific shots when the shop uploaded them, pooled shots otherwise
  // — picking "Blue" shouldn't blank a gallery that only ever had one photo.
  const gallery = selected?.images?.length ? selected.images : (product?.images || []);
  const inCart = selected ? cart.qtyOf(selected.id) : 0;
  // The supplier hasn't priced this one. Checkout refuses it server-side, so
  // the buy bar has to become a phone call rather than a button that 409s.
  const onRequest = !!selected?.price_on_request;

  function addToCart(thenCheckout = false) {
    if (!product || !selected) return;
    const shop = { id: product.shop.id, name: product.shop.name, shipping_fee: product.shop.shipping_fee };
    const line = {
      listing_id: selected.id,
      brand: selected.brand,
      model: selected.model,
      storage: selected.storage,
      color: selected.color,
      image_path: gallery[0]?.image_path ?? null,
      unit_price: selected.asking_price,
    };
    const go = () => { if (thenCheckout) navigation.navigate('Cart'); };
    if (cart.add(shop, line, qty)) { go(); return; }
    // A cart is one shop's delivery with one shipping fee — the server
    // rejects mixed shops outright, so ask before discarding the old one.
    Alert.alert(
      'سلة من متجر آخر',
      `سلتك تحتوي أجهزة من "${cart.shop_name}". تريد إفراغها والبدء بطلب من "${shop.name}"؟`,
      [
        { text: 'رجوع', style: 'cancel' },
        {
          text: 'ابدأ سلة جديدة',
          style: 'destructive',
          onPress: () => { cart.replaceWith(shop, line, qty); go(); },
        },
      ],
    );
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <BackBar insets={insets} onBack={() => navigation.goBack()} />
        <SkBlock w="100%" h={SCREEN_W * 0.8} r={0} />
        <View style={{ padding: 16, gap: 10 }}>
          <SkBlock w={70} h={11} />
          <SkBlock w="70%" h={18} />
          <SkBlock w={130} h={22} />
          <SkBlock w="100%" h={44} r={12} />
        </View>
      </View>
    );
  }

  // The last unit can sell between the grid render and this fetch, and the
  // server drops sold listings — so "gone" is a normal outcome, not an error.
  if (!product || !selected) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <BackBar insets={insets} onBack={() => navigation.goBack()} />
        <View style={{ alignItems: 'center', paddingTop: 70, paddingHorizontal: 40, gap: 10 }}>
          <IconBox size={30} color={theme.subtle} sw={1.5} />
          <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>
            الجهاز غير متوفر
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center' }}>
            نفد هذا الجهاز من المتجر. تصفّح بقية الأجهزة.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
            style={{
              marginTop: 6, paddingHorizontal: 18, paddingVertical: 10,
              borderRadius: radius.pill, backgroundColor: theme.ink,
            }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.buttonInk }}>
              رجوع للمتجر
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: BUY_BAR_H + 16 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        {/* ── Gallery ─────────────────────────────────────────────── */}
        <View>
          {gallery.length ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) =>
                setImgIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
            >
              {gallery.map((im, i) => (
                <TouchableOpacity key={im.id} activeOpacity={0.95} onPress={() => setViewer(i)}>
                  <Img
                    source={{ uri: fullImageUrl(im.image_path) }}
                    contentFit="cover"
                    style={{ width: SCREEN_W, height: SCREEN_W }}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={{
              width: SCREEN_W, height: SCREEN_W * 0.7, backgroundColor: theme.chipBg,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <IconBox size={38} color={theme.subtle} sw={1.3} />
            </View>
          )}

          {gallery.length > 1 ? (
            <View style={{
              position: 'absolute', bottom: 12, left: 0, right: 0,
              flexDirection: 'row', justifyContent: 'center', gap: 5,
            }}>
              {gallery.map((im, i) => (
                <View
                  key={im.id}
                  style={{
                    width: i === imgIdx ? 16 : 6, height: 6, borderRadius: 3,
                    backgroundColor: i === imgIdx ? theme.accent : 'rgba(255,255,255,0.75)',
                  }}
                />
              ))}
            </View>
          ) : null}

        </View>

        {/* ── Title + price ───────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right' }}>
            {product.brand} · جديد
          </Text>
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 21,
            color: theme.ink, textAlign: 'right', marginTop: 3, lineHeight: 28,
          }}>
            {product.model}
          </Text>
          {onRequest ? (
            <Text style={{
              fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, textAlign: 'right', marginTop: 8,
            }}>
              السعر عند الطلب — اتصل بنا
            </Text>
          ) : (
            <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
              <Text style={{ fontFamily: fonts.ltrBold, fontSize: 24, color: theme.accentDeep }}>
                {fmtIQD(selected.asking_price)}
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}>د.ع</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <Tag bg={theme.successSoft} fg={theme.success} label="الدفع عند الاستلام" />
            <Tag
              bg={theme.chipBg}
              fg={theme.chipInk}
              label={product.shop.shipping_fee > 0
                ? `التوصيل ${fmtIQD(product.shop.shipping_fee)} د.ع`
                : 'توصيل مجاني'}
            />
          </View>
        </View>

        {/* ── Options ─────────────────────────────────────────────────
            A dimension with one value isn't a choice — it's a spec, so it
            renders as a tag instead of a lone chip pretending to be pickable. */}
        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          {product.storages.length > 1 ? (
            <OptionRow
              label="الذاكرة"
              options={product.storages}
              value={selStorage}
              available={storageAvailable}
              onPick={pickStorage}
              priceOf={(s) => {
                const m = variants.filter((v) => v.storage === s);
                return m.length ? Math.min(...m.map((v) => v.asking_price)) : null;
              }}
            />
          ) : null}
          {product.colors.length > 1 ? (
            <OptionRow
              label="اللون"
              options={product.colors}
              value={selColor}
              available={colorAvailable}
              onPick={pickColor}
            />
          ) : null}
          {(product.storages.length === 1 && selected.storage) || (product.colors.length === 1 && selected.color) ? (
            <View style={{ flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' }}>
              {product.storages.length === 1 && selected.storage
                ? <Tag bg={theme.chipBg} fg={theme.chipInk} label={selected.storage} /> : null}
              {product.colors.length === 1 && selected.color
                ? <Tag bg={theme.chipBg} fg={theme.chipInk} label={selected.color} /> : null}
            </View>
          ) : null}
        </View>

        {/* ── Quantity ────────────────────────────────────────────── */}
        <View style={{
          marginHorizontal: 16, marginTop: 18, paddingVertical: 10, paddingHorizontal: 14,
          backgroundColor: theme.surface, borderRadius: radius.xl,
          borderWidth: 1, borderColor: theme.line,
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink }}>
            الكمية
          </Text>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 16 }}>
            <TouchableOpacity onPress={() => setQty((n) => Math.min(10, n + 1))} style={stepBtn} activeOpacity={0.7}>
              <IconPlus size={14} color={theme.ink} sw={2.2} />
            </TouchableOpacity>
            <Text style={{ fontFamily: fonts.ltrBold, fontSize: 16, color: theme.ink, minWidth: 18, textAlign: 'center' }}>
              {qty}
            </Text>
            <TouchableOpacity
              onPress={() => setQty((n) => Math.max(1, n - 1))}
              style={[stepBtn, { opacity: qty <= 1 ? 0.4 : 1 }]}
              activeOpacity={0.7}
            >
              <IconMinus size={14} color={theme.ink} sw={2.2} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Description ─────────────────────────────────────────────
            The selected variant's own text wins: shop descriptions often
            name the capacity, and the pooled fallback would describe the
            256GB while the shopper is looking at the 64GB. */}
        {(selected.description || product.description) ? (
          <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
            <Text style={{
              fontFamily: fonts.arBold, fontSize: 14,
              color: theme.ink, textAlign: 'right', marginBottom: 6,
            }}>
              التفاصيل
            </Text>
            <Text style={{
              fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
              textAlign: 'right', lineHeight: 22,
            }}>
              {selected.description || product.description}
            </Text>
          </View>
        ) : null}

        {/* ── Key specs ───────────────────────────────────────────────
            Sits above the reassurance block and below the description,
            because by this point the shopper has picked their option and
            the next question is "is this actually the phone I want". */}
        {product.specs?.length ? (
          <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
            <Text style={{
              fontFamily: fonts.arBold, fontSize: 14,
              color: theme.ink, textAlign: 'right', marginBottom: 8,
            }}>
              المواصفات
            </Text>
            <View style={{
              backgroundColor: theme.surface, borderRadius: radius.xl,
              borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
            }}>
              {product.specs.map((sp, i) => (
                <View
                  key={`${sp.label}-${i}`}
                  style={{
                    flexDirection: 'row-reverse', alignItems: 'center',
                    paddingVertical: 10, paddingHorizontal: 14,
                    borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.line,
                  }}
                >
                  <Text style={{
                    flex: 1, fontFamily: fonts.ar, fontSize: 12.5,
                    color: theme.subtle, textAlign: 'right',
                  }}>
                    {sp.label}
                  </Text>
                  <Text style={{
                    flex: 1.4, fontFamily: fonts.arBold, fontSize: 13,
                    color: theme.ink, textAlign: 'left',
                  }}>
                    {sp.value}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Reassurance ─────────────────────────────────────────── */}
        <View style={{
          marginHorizontal: 16, marginTop: 18, padding: 14,
          backgroundColor: theme.surface, borderRadius: radius.xl,
          borderWidth: 1, borderColor: theme.line, gap: 10,
        }}>
          <Assurance icon="check" text="جهاز جديد بالكارتون من متجر معتمد" />
          <Assurance icon="shield" text="تدفع نقداً عند الاستلام — لا دفع مسبق" />
          <Assurance
            icon="check"
            text={product.shop.shipping_fee > 0
              ? `أجور التوصيل ${fmtIQD(product.shop.shipping_fee)} د.ع لكل الطلب`
              : 'التوصيل مجاني'}
          />
        </View>
      </Animated.ScrollView>

          {/* Status-bar scrim, same treatment as the marketplace listing page:
              the gallery is deliberately edge-to-edge, so once it scrolls away
              the price and specs would otherwise run under the clock. Fades in
              rather than sitting solid, which would crop the hero photo.
              Non-interactive so the back/cart buttons above still take taps. */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: insets.top, backgroundColor: theme.bg,
              opacity: scrollY.interpolate({
                inputRange: [SCREEN_W * 0.5, SCREEN_W * 0.72],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            }}
          />

          <View style={{ position: 'absolute', top: insets.top + 6, right: 14, left: 14 }}>
            <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                activeOpacity={0.8}
                style={{
                  width: 36, height: 36, borderRadius: 999, backgroundColor: 'rgba(245,240,230,0.92)',
                  alignItems: 'center', justifyContent: 'center', ...shadowSoft,
                }}
              >
                <View style={{ transform: [{ scaleX: -1 }] }}>
                  <IconArrowLeft size={20} color={theme.ink} sw={1.8} />
                </View>
              </TouchableOpacity>
              {product.shop.phone ? (
                <TouchableOpacity
                  onPress={() => callPhone(product.shop.phone as string)}
                  activeOpacity={0.8}
                  style={{
                    width: 36, height: 36, borderRadius: 999, backgroundColor: 'rgba(245,240,230,0.92)',
                    alignItems: 'center', justifyContent: 'center', ...shadowSoft,
                  }}
                >
                  <IconMsgCall size={17} color={theme.accentDeep} sw={1.8} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

      {/* ── Buy bar ───────────────────────────────────────────────── */}
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
        backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.line,
        flexDirection: 'row-reverse', gap: 8,
      }}>
        {onRequest ? (
          <TouchableOpacity
            onPress={() => product.shop.phone && callPhone(product.shop.phone)}
            activeOpacity={0.85}
            disabled={!product.shop.phone}
            style={{
              flex: 1, backgroundColor: theme.accent, borderRadius: radius.xl,
              paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
              flexDirection: 'row-reverse', gap: 8, opacity: product.shop.phone ? 1 : 0.5,
            }}
          >
            <IconMsgCall size={17} color="#fff" sw={1.9} />
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, fontWeight: '700', color: '#fff' }}>
              اتصل للسعر والطلب
            </Text>
          </TouchableOpacity>
        ) : (
        <>
        <TouchableOpacity
          onPress={() => addToCart(false)}
          activeOpacity={0.85}
          style={{
            flex: 1, backgroundColor: theme.ink, borderRadius: radius.xl,
            paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
            flexDirection: 'row-reverse', gap: 6,
          }}
        >
          {inCart > 0 ? <IconCheck size={15} color={theme.buttonInk} sw={2.4} /> : null}
          <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.buttonInk }}>
            {inCart > 0 ? 'في السلة' : 'إضافة للسلة'}
          </Text>
          {/* Kept out of the Arabic string on purpose — see the cart bar on
              the store screen: a Latin "(2)" inside an RTL run gets dropped. */}
          {inCart > 0 ? (
            <View style={{
              minWidth: 20, height: 20, borderRadius: 999, paddingHorizontal: 5,
              backgroundColor: 'rgba(245,240,230,0.25)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontFamily: fonts.ltrBold, fontSize: 11.5, color: theme.buttonInk }}>
                {inCart}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => addToCart(true)}
          activeOpacity={0.85}
          style={{
            flex: 1, backgroundColor: theme.accent, borderRadius: radius.xl,
            paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: '#fff' }}>
            اشترِ الآن
          </Text>
        </TouchableOpacity>
        </>
        )}
      </View>

      {viewer !== null ? (
        <FullScreenGallery images={gallery} startIndex={viewer} onClose={() => setViewer(null)} />
      ) : null}
    </View>
  );
}

function BackBar({ insets, onBack }: { insets: { top: number }; onBack: () => void }) {
  return (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 14, paddingBottom: 6, flexDirection: 'row-reverse' }}>
      <TouchableOpacity onPress={onBack} style={{ padding: 6 }} activeOpacity={0.6}>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

function OptionRow({ label, options, value, available, onPick, priceOf }: {
  label: string;
  options: string[];
  value: string | null;
  available: (o: string) => boolean;
  onPick: (o: string) => void;
  priceOf?: (o: string) => number | null;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 13,
        color: theme.ink, textAlign: 'right', marginBottom: 8,
      }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const active = o === value;
          const ok = available(o);
          const price = priceOf?.(o) ?? null;
          return (
            <TouchableOpacity
              key={o}
              onPress={() => onPick(o)}
              activeOpacity={0.8}
              style={{
                paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.lg,
                borderWidth: active ? 2 : 1,
                borderColor: active ? theme.accent : theme.line,
                backgroundColor: active ? theme.accentSoft : theme.surface,
                opacity: ok ? 1 : 0.4,
                alignItems: 'center',
              }}
            >
              <Text style={{
                fontFamily: fonts.arBold, fontSize: 13,
                color: active ? theme.accentDeep : theme.ink,
              }}>
                {o}
              </Text>
              {price !== null ? (
                <Text style={{
                  fontFamily: fonts.ltr, fontSize: 10.5, marginTop: 2,
                  color: active ? theme.accentDeep : theme.subtle,
                }}>
                  {fmtIQD(price)}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function Tag({ bg, fg, label }: { bg: string; fg: string; label: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 11, color: fg }}>{label}</Text>
    </View>
  );
}

function Assurance({ icon, text }: { icon: 'check' | 'shield'; text: string }) {
  return (
    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 9 }}>
      {icon === 'shield'
        ? <IconShield size={15} color={theme.success} sw={1.7} />
        : <IconCheck size={15} color={theme.success} sw={2.2} />}
      <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.ink, flex: 1, textAlign: 'right' }}>
        {text}
      </Text>
    </View>
  );
}

const stepBtn = {
  width: 30, height: 30, borderRadius: 999,
  alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: theme.chipBg,
};
