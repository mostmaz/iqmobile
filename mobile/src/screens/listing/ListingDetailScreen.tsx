import React, { useState } from 'react';
import {
  View, Text, ScrollView, Image, TouchableOpacity, ActivityIndicator,
  Alert, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Btn, Card, fmtIQD } from '../../components/ui';
import { IconStar, IconPin, IconArrowLeft, IconShare, IconBookmark, IconPhoneIcon, IconMsgCall } from '../../components/icons';
import { ChipTag, SpecRow } from '../../components/marketplace';
import { Listings, Reports } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { ar } from '../../i18n/ar';
import { arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';
import { callPhone, openWhatsApp } from '../../lib/contact';

const SCREEN_W = Dimensions.get('window').width;

export default function ListingDetailScreen({ route, navigation }: any) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [imgIdx, setImgIdx] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => Listings.get(id),
  });

  const save = useMutation({
    mutationFn: () => Listings.save(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved'] }),
  });

  // Mark-as-sold / restore mutation. Refetches the listing after the toggle,
  // also invalidates browse + mine so the grids reflect the new state. Shows
  // a clear confirmation alert so the seller knows the action took effect.
  const markSold = useMutation({
    mutationFn: (next: 'sold' | 'active') => Listings.patch(id, { status: next }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['listing', id] });
      qc.invalidateQueries({ queryKey: ['mine'] });
      qc.invalidateQueries({ queryKey: ['browse'] });
      Alert.alert(
        updated.status === 'sold' ? 'تم التحديد كمباع' : 'تم إرجاع الإعلان للمتاح',
        updated.status === 'sold'
          ? 'سيظهر الإعلان للمشترين مع علامة "مباع". يمكنك إرجاعه للمتاح في أي وقت.'
          : 'الإعلان متاح الآن للمشترين مرة أخرى.',
      );
    },
    onError: (e: any) => Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message),
  });

  if (isLoading || !data) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}><ActivityIndicator color={theme.accent} /></View>;
  }

  const isMine = user?.id === data.seller_id;
  // Per-listing contact info — always public, no deal-confirmation gate.
  const contactPhone = (data as any).contact_phone || data.seller_phone || null;
  const contactWhatsApp = (data as any).contact_whatsapp || null;

  function reportListing() {
    Alert.alert('إبلاغ عن الإعلان', '', [
      { text: 'إعلان مزيف', onPress: () => Reports.submit('listing', id, 'fake_listing') },
      { text: 'مواصفات خاطئة', onPress: () => Reports.submit('listing', id, 'wrong_specs') },
      { text: 'محاولة احتيال', onPress: () => Reports.submit('listing', id, 'scam_attempt') },
      { text: 'إلغاء', style: 'cancel' },
    ]);
  }

  const status = data.status;
  const showStatusBadge = status !== 'active';
  const statusBg = status === 'sold' ? theme.accent : theme.ink;
  const statusLabel = (ar.listing as any)[status] || status;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {/* Gallery — floating overlay buttons over the image */}
        <View style={{ position: 'relative', height: 320, backgroundColor: theme.chipBg }}>
          <ScrollView
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
          >
            {(data.images || []).length === 0 ? (
              <View style={{ width: SCREEN_W, height: 320, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: theme.subtle, fontFamily: fonts.ar }}>لا توجد صور</Text>
              </View>
            ) : (
              (data.images || []).map((im) => (
                <Image key={im.id} source={{ uri: fullImageUrl(im.image_path) }} style={{ width: SCREEN_W, height: 320 }} resizeMode="cover" />
              ))
            )}
          </ScrollView>

          <View pointerEvents="box-none" style={{
            position: 'absolute', top: 12 + insets.top, left: 12, right: 12,
            flexDirection: 'row-reverse', justifyContent: 'space-between',
          }}>
            <FloatBtn onPress={() => navigation.goBack()}>
              <View style={{ transform: [{ scaleX: -1 }] }}><IconArrowLeft size={18} color="#fff" sw={1.7} /></View>
            </FloatBtn>
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              <FloatBtn onPress={() => save.mutate()}><IconBookmark size={16} color="#fff" sw={1.7} /></FloatBtn>
              <FloatBtn><IconShare size={16} color="#fff" sw={1.7} /></FloatBtn>
            </View>
          </View>

          {(data.images?.length || 0) > 1 ? (
            <View style={{
              position: 'absolute', bottom: 14, left: 0, right: 0,
              flexDirection: 'row', justifyContent: 'center', gap: 4,
            }}>
              {data.images!.map((_, i) => (
                <View key={i} style={{
                  width: i === imgIdx ? 18 : 6, height: 6, borderRadius: 3,
                  backgroundColor: i === imgIdx ? '#fff' : 'rgba(255,255,255,0.5)',
                }} />
              ))}
            </View>
          ) : null}

          {showStatusBadge ? (
            <View style={{
              position: 'absolute', top: 60 + insets.top, right: 12,
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
              backgroundColor: statusBg,
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 11, color: '#fff', fontWeight: '700', letterSpacing: 0.4 }}>
                {statusLabel}
              </Text>
            </View>
          ) : null}
        </View>

        {/* title + chips + price */}
        <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
            <ChipTag>{(ar.listing as any)[data.condition]}</ChipTag>
            {data.storage ? <ChipTag>{data.storage}</ChipTag> : null}
            {data.color ? <ChipTag>{data.color}</ChipTag> : null}
          </View>

          <Text style={{ fontFamily: fonts.arBold, fontSize: 22, fontWeight: '700', color: theme.ink, letterSpacing: -0.3, textAlign: 'right' }}>
            {data.brand} {data.model}
          </Text>

          <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
            <View>
              <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.subtle }}>
                السعر المطلوب
              </Text>
              <Text style={{ marginTop: 2, fontFamily: fonts.ltrBold, fontSize: 30, color: theme.accentDeep, fontWeight: '700', letterSpacing: -0.5 }}>
                {fmtIQD(data.asking_price)}
                <Text style={{ fontSize: 14, color: theme.subtle, fontFamily: fonts.ar, fontWeight: '500' }}>  د.ع</Text>
              </Text>
            </View>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
              <IconPin size={13} color={theme.subtle} />
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                {arOf(data.governorate)}{data.city ? ` · ${data.city}` : ''}
              </Text>
            </View>
          </View>
        </View>

        {/* Contact CTAs — always available. Phone is public, WhatsApp
            shown only when the seller provided a number, in-app chat is
            always offered. Hidden on a seller's own listing. */}
        {!isMine && contactPhone ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <ContactRow phone={contactPhone} whatsapp={contactWhatsApp} />
          </View>
        ) : null}

        {/* specs card */}
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <Card style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
            {data.storage ? <SpecRow label={ar.listing.storage} value={data.storage} /> : null}
            {data.color ? <SpecRow label={ar.listing.color} value={data.color} /> : null}
            {data.battery_health != null ? <SpecRow label={ar.listing.battery} value={`${data.battery_health}%`} /> : null}
            {data.warranty_status ? <SpecRow label="الضمان" value={data.warranty_status} /> : null}
            {data.accessories?.length ? <SpecRow label={ar.listing.accessories} value={data.accessories.join('، ')} last /> : null}
          </Card>
        </View>

        {/* seller card */}
        {data.seller ? (
          <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
            <Card style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {/* Unified-account redesign: every seller renders the same.
                      No "shop" avatar variant, no individual/shop stamp. */}
                  <View style={{
                    width: 44, height: 44, borderRadius: 999,
                    backgroundColor: theme.chipBg,
                    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  }}>
                    {data.seller.profile_image_path ? (
                      <Image source={{ uri: fullImageUrl(data.seller.profile_image_path) }} style={{ width: 44, height: 44 }} />
                    ) : (
                      <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.chipInk, fontWeight: '700' }}>
                        {data.seller.display_name?.[0]}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 14, color: theme.ink, flexShrink: 1 }}>
                        {data.seller.display_name}
                      </Text>
                      {/* Tiny "متجر" chip when seller is a shop. */}
                      {data.seller.seller_type === 'shop' ? (
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.accentSoft }}>
                          <Text style={{ fontFamily: fonts.arBold, fontSize: 10, fontWeight: '700', color: theme.accentDeep }}>متجر</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
                {data.seller.rating_count > 0 ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
                      <IconStar size={14} filled color={theme.accent} />
                      <Text style={{ fontFamily: fonts.ltrBold, fontSize: 14, fontWeight: '700', color: theme.ink }}>
                        {data.seller.rating_avg.toFixed(1)}
                      </Text>
                    </View>
                    <Text style={{ marginTop: 2, fontFamily: fonts.ltr, fontSize: 11, color: theme.subtle }}>
                      {data.seller.rating_count} تقييم
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Shop sign image — only for shop sellers. Stretches across
                  the card under the name row. */}
              {data.seller.seller_type === 'shop' && (data.seller as any).shop_image_path ? (
                <View style={{ marginTop: 10, borderRadius: radius.md, overflow: 'hidden', backgroundColor: theme.chipBg }}>
                  <Image
                    source={{ uri: fullImageUrl((data.seller as any).shop_image_path) }}
                    style={{ width: '100%', height: 140 }}
                    resizeMode="cover"
                  />
                </View>
              ) : null}

              {/* Tappable "open in Maps" row — only when shop GPS is set. */}
              {data.seller.seller_type === 'shop' && (data.seller as any).shop_lat != null && (data.seller as any).shop_lng != null ? (
                <TouchableOpacity
                  onPress={() => {
                    const lat = (data.seller as any).shop_lat;
                    const lng = (data.seller as any).shop_lng;
                    const url = `https://maps.google.com/?q=${lat},${lng}`;
                    require('react-native').Linking.openURL(url).catch(() => {});
                  }}
                  activeOpacity={0.85}
                  style={{
                    marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md,
                    backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line,
                    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                  }}>
                  <IconPin size={14} color={theme.accent} sw={1.7} />
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13, fontWeight: '600', color: theme.ink }}>
                    افتح موقع المتجر على الخريطة
                  </Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          </View>
        ) : null}

        {/* description */}
        {data.description ? (
          <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.subtle, textAlign: 'right', marginBottom: 6 }}>
              {ar.listing.description}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.ink, lineHeight: 22, textAlign: 'right' }}>
              {data.description}
            </Text>
          </View>
        ) : null}

        {/* Secondary actions (chat lives in ContactRow above). */}
        <View style={{ padding: 16, gap: 10 }}>
          {!isMine ? (
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              <Btn kind="ghost" full onPress={() => save.mutate()}>{save.isSuccess ? ar.listing.saved : ar.listing.save}</Btn>
              <Btn kind="danger" full onPress={reportListing}>{ar.listing.report}</Btn>
            </View>
          ) : (
            <>
              <Btn kind="primary" full onPress={() => navigation.navigate('EditListing', { id })}>{ar.listing.edit}</Btn>
              <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                {/* Sold-state toggle. Active → "Mark sold" with confirmation
                    + success toast. Sold → "Mark available" so the seller
                    can flip it back without re-listing. Hidden entirely on
                    expired listings (renew button covers that flow). */}
                {data.status === 'sold' ? (
                  <Btn kind="success" full busy={markSold.isPending} onPress={() => {
                    Alert.alert(
                      'إعادة التفعيل',
                      'هل تريد إرجاع الإعلان إلى المتاح؟',
                      [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'إرجاع', onPress: () => markSold.mutate('active') },
                      ],
                    );
                  }}>إعادة للمتاح</Btn>
                ) : data.status === 'active' ? (
                  <Btn kind="ghost" full busy={markSold.isPending} onPress={() => {
                    Alert.alert(
                      'تحديد كمباع',
                      'سيظهر الإعلان مع علامة "مباع" بدلاً من اختفائه. يمكنك إرجاعه للمتاح لاحقاً. هل تريد المتابعة؟',
                      [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'تأكيد', onPress: () => markSold.mutate('sold') },
                      ],
                    );
                  }}>{ar.listing.markSold}</Btn>
                ) : null}
                {data.status === 'expired' ? (
                  <Btn kind="success" full onPress={async () => {
                    await Listings.renew(id);
                    qc.invalidateQueries({ queryKey: ['listing', id] });
                  }}>{ar.listing.renew}</Btn>
                ) : null}
                <Btn kind="danger" full onPress={() => {
                  Alert.alert('حذف', 'هل أنت متأكد؟', [
                    { text: 'إلغاء', style: 'cancel' },
                    { text: 'حذف', style: 'destructive', onPress: async () => { await Listings.remove(id); navigation.goBack(); } },
                  ]);
                }}>{ar.listing.remove}</Btn>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// Always-on contact CTAs. Three actions, all public:
//   - Call: tap-to-dial via tel:
//   - WhatsApp: deeplink wa.me, only when seller provided a number
//   - Chat: opens the in-app chat so buyers can negotiate without leaving
function ContactRow({
  phone, whatsapp,
}: {
  phone: string;
  whatsapp: string | null;
}) {
  return (
    <View style={{
      backgroundColor: theme.surface,
      borderColor: theme.line, borderWidth: 1, borderRadius: radius.xxl,
      padding: 14,
    }}>
      {/* Public phone — tap to call. */}
      <TouchableOpacity
        onPress={() => callPhone(phone)}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 12, paddingVertical: 10,
          backgroundColor: theme.bg, borderRadius: 12,
          borderWidth: 1, borderColor: theme.line,
        }}
      >
        <Text style={{ fontFamily: fonts.ltrBold, fontSize: 17, color: theme.ink, fontWeight: '700', letterSpacing: 0.3, writingDirection: 'ltr' }}>
          {phone}
        </Text>
        <IconPhoneIcon size={16} color={theme.subtle} sw={1.7} />
      </TouchableOpacity>

      <View style={{ marginTop: 8, flexDirection: 'row-reverse', gap: 8 }}>
        <Btn kind="success" full onPress={() => callPhone(phone)}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <IconPhoneIcon size={15} color="#fff" sw={1.8} />
            <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontWeight: '700', fontSize: 14 }}>اتصال</Text>
          </View>
        </Btn>
        {whatsapp ? (
          <Btn kind="successSoft" full onPress={() => openWhatsApp(whatsapp)}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
              <IconMsgCall size={15} color={theme.success} sw={1.8} />
              <Text style={{ color: theme.success, fontFamily: fonts.arBold, fontWeight: '700', fontSize: 14 }}>واتساب</Text>
            </View>
          </Btn>
        ) : null}
      </View>
    </View>
  );
}

function FloatBtn({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{
      width: 38, height: 38, borderRadius: 999,
      backgroundColor: 'rgba(20,16,12,0.55)',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </TouchableOpacity>
  );
}
