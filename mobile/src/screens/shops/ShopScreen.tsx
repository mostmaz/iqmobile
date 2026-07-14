// Shop page — the shop's profile + price-list images + contact methods + its
// listings. Reached from the Shops directory (and from any listing whose
// seller is a shop). Contact is call (one button per public number) / WhatsApp
// / Facebook / Instagram. Price-list images open full-screen (swipeable).

import React, { useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Img } from '../../components/Img';
import { Btn } from '../../components/ui';
import { ListingCard } from '../../components/ListingCard';
import { FullScreenGallery } from '../../components/FullScreenGallery';
import { IconStar, IconPin, IconSpark, IconArrowLeft, IconMsgCall, IconPlus } from '../../components/icons';
import { Shops } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { arOf } from '../../lib/governorates';
import { callPhone, openWhatsApp } from '../../lib/contact';
import { useAuth } from '../../auth/AuthContext';

export default function ShopScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const id: number = route.params?.id;
  const { data: shop, isLoading } = useQuery({ queryKey: ['shop', id], queryFn: () => Shops.get(id) });
  // The shop IS a user account (seller_type='shop'), so ownership is a
  // simple id match. Owners get a post-device CTA right on their shop page;
  // the new listing shows up here automatically (shop listings are just
  // their marketplace listings).
  const isOwner = !!user && user.id === id;
  // Full-screen price-image viewer (index of the tapped image, or null).
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  if (isLoading || !shop) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const logo = shop.shop_image_path || shop.profile_image_path;
  const initial = (shop.shop_name || shop.display_name || '?').trim()[0] || '?';
  // Prefer the explicit list; fall back to the legacy single number.
  const phones = shop.shop_phones && shop.shop_phones.length
    ? shop.shop_phones
    : (shop.shop_phone ? [shop.shop_phone] : []);
  const whatsapp = shop.shop_whatsapp || shop.shop_phone || null;
  const images = shop.shop_images || [];

  const openUrl = (url?: string | null) => { if (url) Linking.openURL(url).catch(() => {}); };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Back bar */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 6, flexDirection: 'row-reverse' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 6 }} activeOpacity={0.6}>
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconArrowLeft size={22} color={theme.ink} sw={1.7} />
          </View>
        </TouchableOpacity>
      </View>

      <FlatList
        data={shop.listings}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        renderItem={({ item }) => (
          <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
        )}
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            {/* Shop header card */}
            <View style={{
              backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
              borderColor: shop.is_featured ? theme.accent : theme.line, ...shadowSoft,
              padding: 16, marginBottom: 14,
            }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 68, height: 68, borderRadius: 18, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {logo ? (
                    <Img source={{ uri: fullImageUrl(logo) }} style={{ width: 68, height: 68 }} />
                  ) : (
                    <Text style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 28, color: theme.subtle }}>{initial}</Text>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 19, color: theme.ink, textAlign: 'right', flexShrink: 1 }}>
                      {shop.shop_name}
                    </Text>
                    {shop.is_featured ? (
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 2, backgroundColor: theme.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
                        <IconSpark size={9} color="#fff" />
                        <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 9, fontWeight: '700' }}>مميّز</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 5 }}>
                    <IconPin size={12} color={theme.subtle} />
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
                      {arOf(shop.governorate)}{shop.city ? ` · ${shop.city}` : ''}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 5 }}>
                    <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>{shop.listing_count} إعلان</Text>
                    {shop.rating_count > 0 && Number.isFinite(shop.rating_avg as any) ? (
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}>
                        <IconStar size={12} filled color={theme.accent} />
                        <Text style={{ fontFamily: fonts.ltr, fontSize: 12, color: theme.subtle }}>
                          {Number(shop.rating_avg).toFixed(1)} · {shop.rating_count}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>

              {shop.shop_bio ? (
                <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right', marginTop: 12, lineHeight: 22 }}>
                  {shop.shop_bio}
                </Text>
              ) : null}
              {shop.shop_address ? (
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <IconPin size={13} color={theme.subtle} />
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', flex: 1 }}>{shop.shop_address}</Text>
                </View>
              ) : null}

              {/* Contact — hidden on your own shop (you don't call yourself);
                  owners get the post-device CTA instead. One call button per
                  public number, then WhatsApp, then Facebook / Instagram. */}
              {!isOwner ? (
                <View style={{ marginTop: 14, gap: 8 }}>
                  {phones.map((p) => (
                    <Btn key={p} kind="primary" full onPress={() => callPhone(p)}>
                      <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15, fontWeight: '600' }}>
                        اتصال · <Text style={{ fontFamily: fonts.ltr }}>{p}</Text>
                      </Text>
                    </Btn>
                  ))}
                  {whatsapp ? (
                    <Btn kind="success" full onPress={() => openWhatsApp(whatsapp, `مرحباً، أتواصل معك من تطبيق iQ بخصوص متجر ${shop.shop_name}`)}>
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                        <IconMsgCall size={16} color="#fff" />
                        <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15, fontWeight: '600' }}>واتساب</Text>
                      </View>
                    </Btn>
                  ) : null}
                  {shop.shop_facebook || shop.shop_instagram ? (
                    <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                      {shop.shop_facebook ? (
                        <SocialButton label="فيسبوك" bg="#1877F2" onPress={() => openUrl(shop.shop_facebook)} />
                      ) : null}
                      {shop.shop_instagram ? (
                        <SocialButton label="انستغرام" bg="#C13584" onPress={() => openUrl(shop.shop_instagram)} />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Owner CTA: post a device from inside the shop page. Routes
                  to the Sell tab (fresh wizard via its tabPress reset); the
                  published listing appears in this shop page automatically. */}
              {isOwner ? (
                <View style={{ marginTop: 14 }}>
                  <Btn kind="accent" full onPress={() => (navigation as any).getParent()?.navigate('Sell')}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <IconPlus size={17} color="#fff" sw={2} />
                      <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 15, fontWeight: '600' }}>
                        أضف جهازاً وسعره إلى متجرك
                      </Text>
                    </View>
                  </Btn>
                </View>
              ) : null}
            </View>

            {/* Price-list images — tap to open full-screen (swipe between). */}
            {images.length ? (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: theme.ink, textAlign: 'right', marginBottom: 10 }}>
                  قائمة الأسعار
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row-reverse' }}>
                  {images.map((im, i) => (
                    <TouchableOpacity key={im.id} activeOpacity={0.85} onPress={() => setViewerIdx(i)} style={{ marginLeft: 10 }}>
                      <Img
                        source={{ uri: fullImageUrl(im.image_path) }}
                        style={{ width: 116, height: 158, borderRadius: 14, backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.line }}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: theme.ink, textAlign: 'right', marginBottom: 10 }}>
              إعلانات المتجر
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.ar, color: theme.subtle, fontSize: 13, textAlign: 'center', lineHeight: 22 }}>
              {isOwner ? 'لا توجد إعلانات بعد — أضف أول جهاز لمتجرك من الزر أعلاه.' : 'لا توجد إعلانات حالياً.'}
            </Text>
          </View>
        }
      />

      {/* Full-screen price-image viewer */}
      {viewerIdx != null && images.length > 0 ? (
        <FullScreenGallery images={images} startIndex={viewerIdx} onClose={() => setViewerIdx(null)} />
      ) : null}
    </View>
  );
}

function SocialButton({ label, bg, onPress }: { label: string; bg: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flex: 1, height: 44, borderRadius: radius.lg, backgroundColor: bg,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 14, fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
}
