// The printed QR sticker for a shop's window, and the free week it earns.
//
// One screen for the whole life of the thing — ask, wait, prove — because
// they are the same question asked at three moments ("where is my sticker?"),
// and three screens would mean two of them are always the wrong one.
//
// Everything the shop is told here is decided by the server and read off
// `status`: how many devices are needed, how many it has, whether it may ask
// again. The screen states the rule, it does not own it.
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Image, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header, Input } from '../../components/ui';
import { Shops, type ShopStickerStatus } from '../../api/endpoints';
import { uploadStickerProof, fullImageUrl } from '../../api/upload';
import { launchLibrary } from '../../lib/imagePicker';
import { theme, fonts, radius, FONT_SCALE_TIGHT, shadowSoft } from '../../theme';

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

const KIND_LABEL: Record<string, string> = { window: 'ملصق واجهة', stand: 'ستاند طاولة' };
const KINDS: { key: 'window' | 'stand'; label: string; hint: string }[] = [
  { key: 'window', label: 'ملصق واجهة', hint: 'يلصق على الزجاج' },
  { key: 'stand', label: 'ستاند طاولة', hint: 'يوقف لحاله' },
];

export default function StickerScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'window' | 'stand'>('window');
  const [qty, setQty] = useState(1);
  const [address, setAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['shop-sticker'],
    queryFn: () => Shops.sticker(),
  });

  const open = status?.open ?? null;
  const last = status?.last ?? null;
  const reward = status?.reward;

  async function request() {
    if (sending || !status) return;
    const addr = (address || status.shop.address || '').trim();
    if (addr.length < 8) {
      Alert.alert('العنوان ناقص', 'اكتب عنوان يوصله المندوب — المنطقة والشارع وعلامة مميزة.');
      return;
    }
    setSending(true);
    try {
      await Shops.requestSticker({ sticker_kind: kind, qty, address: addr });
      qc.invalidateQueries({ queryKey: ['shop-sticker'] });
      Alert.alert('وصلنا طلبك', 'نطبع الملصق ونوصله لعنوان متجرك مجاناً، ونخبرك بكل خطوة.');
    } catch (e: any) {
      // The server owns the rules; say which one was hit.
      const msg = e?.data?.error === 'request_pending' ? 'عندك طلب ملصق مفتوح أصلاً.'
        : e?.data?.error === 'address_required' ? 'اكتب عنوان أوضح — المنطقة والشارع.'
          : e?.data?.error === 'not_a_shop' ? 'هذي الخدمة للمتاجر فقط.'
            : 'تعذّر إرسال الطلب، حاول مرة ثانية.';
      Alert.alert('ما انرسل', msg);
    } finally {
      setSending(false);
    }
  }

  async function sendProof() {
    if (uploading || !reward) return;
    if (!reward.listings_ok) {
      Alert.alert(
        'ناقصك أجهزة',
        `لازم ${arNum(reward.min_listings)} أجهزة معروضة على الأقل. عندك هسه ${arNum(reward.listings)}.`,
      );
      return;
    }
    const r = await launchLibrary({ mediaTypes: ['images'], quality: 0.8 });
    if (!r || r.canceled || !r.assets?.[0]?.uri) return;
    setUploading(true);
    try {
      await uploadStickerProof(r.assets[0].uri);
      qc.invalidateQueries({ queryKey: ['shop-sticker'] });
      Alert.alert('وصلتنا الصورة', 'نراجعها ونخبرك — إذا كل شي تمام يصير متجرك مميّز مجاناً.');
    } catch (e: any) {
      const err = e?.data?.error;
      const msg = err === 'not_enough_listings'
        ? `لازم ${arNum(e?.data?.need ?? reward.min_listings)} أجهزة معروضة. عندك ${arNum(e?.data?.listings ?? 0)}.`
        : err === 'proof_pending' ? 'عندنا صورة منك قيد المراجعة.'
          : err === 'already_rewarded' ? 'خذيت الترويج المجاني عن هذا الملصق.'
            : err === 'no_sticker_request' ? 'اطلب الملصق أول.'
              : 'تعذّر رفع الصورة، حاول مرة ثانية.';
      Alert.alert('ما انرفعت', msg);
    } finally {
      setUploading(false);
    }
  }

  function openWhatsApp() {
    if (!reward) return;
    const shop = status?.shop.name || '';
    const text = `مرحباً، هذي صورة ملصق QR بمحلي «${shop}» — أريد الترويج المجاني.`;
    const num = reward.whatsapp.replace(/\D/g, '').replace(/^0/, '964');
    Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(text)}`).catch(() => {
      Alert.alert('ما انفتح واتساب', `راسلنا على ${reward.whatsapp}`);
    });
  }

  if (isLoading || !status) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Header title="ملصق QR لمتجرك" onBack={() => navigation.goBack()} />
        <View style={{ paddingTop: 40 }}><ActivityIndicator color={theme.accent} /></View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="ملصق QR لمتجرك" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>

        {/* What it is, always — the shop reads this once and never again. */}
        <View style={{
          backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
          borderColor: theme.line, padding: 14, ...shadowSoft,
        }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, flex: 1, textAlign: 'right' }}>
              مسحة وحدة توصّل زبونك لمتجرك
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
              fontFamily: fonts.arBold, fontSize: 11, color: theme.success,
              backgroundColor: theme.successSoft, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3,
            }}>مجاناً</Text>
          </View>
          <Text style={{
            fontFamily: fonts.ar, fontSize: 13, color: theme.subtle,
            textAlign: 'right', lineHeight: 21, marginTop: 7,
          }}>
            تلصقه على واجهة المحل أو تخليه ستاند على الطاولة. الزبون يمسحه بالكاميرا
            وتفتح له صفحة متجرك بكل أجهزتك وأسعارك. ما عنده التطبيق؟ الكود ينزّله له.
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(status.sticker_url).catch(() => {})}
            activeOpacity={0.8}
            style={{ marginTop: 10, alignSelf: 'flex-end' }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.accentDeep }}>
              شوف شكل الملصق ←
            </Text>
          </TouchableOpacity>
        </View>

        {/* The free week. Above the form on purpose: it is the reason a shop
            bothers to put the sticker up at all. */}
        {reward ? (
          <View style={{
            backgroundColor: theme.accentSoft, borderRadius: radius.xxl, borderWidth: 1.5,
            borderColor: theme.accentBorder, padding: 14, marginTop: 12,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right' }}>
              🎉 {arNum(reward.days)} أيام ترويج مجاني
            </Text>
            <Text style={{
              fontFamily: fonts.ar, fontSize: 13, color: theme.subtle,
              textAlign: 'right', lineHeight: 21, marginTop: 6,
            }}>
              اعرض {arNum(reward.min_listings)} أجهزة أو أكثر، والصق الملصق بمحلك، وابعثلنا
              صورة — نراجعها ويصير متجرك مميّز بالمقدمة {arNum(reward.days)} أيام.
            </Text>

            {/* The device half is counted for them, not asked of them. */}
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10,
              backgroundColor: theme.surface, borderRadius: radius.lg, padding: 10,
            }}>
              <Text style={{
                fontFamily: fonts.arBold, fontSize: 13,
                color: reward.listings_ok ? theme.success : theme.accentDeep,
              }}>
                {reward.listings_ok ? '✓' : `${arNum(reward.listings)}/${arNum(reward.min_listings)}`}
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.ink, flex: 1, textAlign: 'right' }}>
                {reward.listings_ok
                  ? `عندك ${arNum(reward.listings)} جهاز معروض — الشرط مكتمل`
                  : `ناقصك ${arNum(reward.min_listings - reward.listings)} أجهزة معروضة`}
              </Text>
            </View>

            {reward.featured_until && reward.featured_until > Date.now() ? (
              <Text style={{
                fontFamily: fonts.arBold, fontSize: 12.5, color: theme.success,
                textAlign: 'right', marginTop: 9,
              }}>
                متجرك مميّز لحد {new Date(reward.featured_until).toLocaleDateString('ar-IQ')}
              </Text>
            ) : null}

            {reward.status === 'pending' ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 9 }}>
                صورتك وصلت — نراجعها ونخبرك.
              </Text>
            ) : reward.can_submit && last ? (
              <>
                <TouchableOpacity
                  onPress={sendProof}
                  disabled={uploading}
                  activeOpacity={0.88}
                  style={{
                    marginTop: 11, borderRadius: radius.xl, paddingVertical: 13, alignItems: 'center',
                    backgroundColor: reward.listings_ok ? theme.accentDeep : theme.chipBg,
                  }}
                >
                  <Text style={{
                    fontFamily: fonts.arBold, fontSize: 14.5,
                    color: reward.listings_ok ? '#fff' : theme.subtle,
                  }}>
                    {uploading ? 'جارٍ الرفع…' : 'ابعث صورة الملصق بمحلك'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={openWhatsApp} activeOpacity={0.8} style={{ marginTop: 8 }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'center' }}>
                    أو ابعثها واتساب على {reward.whatsapp}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}

            {reward.status === 'rejected' && last?.proof_note ? (
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.danger, textAlign: 'right', marginTop: 8 }}>
                {last.proof_note}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Either the state of the sticker we owe them, or the form to ask. */}
        {open ? (
          <View style={{
            backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
            borderColor: theme.line, padding: 16, marginTop: 12, ...shadowSoft,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right' }}>
              {KIND_LABEL[open.sticker_kind] || 'ملصق'} ×{arNum(open.qty)}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
              {open.address}
            </Text>
            <View style={{ marginTop: 14, gap: 0 }}>
              <Step done label="طلبك وصل" sub={new Date(open.created_at).toLocaleDateString('ar-IQ')} line />
              <Step
                done={!!open.printing_at}
                active={!open.printing_at}
                label="قيد الطباعة"
                sub="نطبع الملصق باسم متجرك"
                line
              />
              <Step
                done={!!open.shipped_at}
                active={!!open.printing_at && !open.shipped_at}
                label="بالطريق إلك"
                sub="نخبرك بالإشعار أول ما ينطلق"
              />
            </View>
          </View>
        ) : (
          <View style={{
            backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
            borderColor: theme.line, padding: 14, marginTop: 12, ...shadowSoft,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ink, textAlign: 'right' }}>
              شنو تريد؟
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: 9, marginTop: 10 }}>
              {KINDS.map((k) => {
                const on = kind === k.key;
                return (
                  <TouchableOpacity
                    key={k.key}
                    onPress={() => setKind(k.key)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={{
                      flex: 1, borderRadius: radius.xl, paddingVertical: 12, alignItems: 'center',
                      backgroundColor: on ? theme.accentSoft : theme.inset,
                      borderWidth: on ? 1.5 : 1, borderColor: on ? theme.accent : theme.line,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: on ? theme.accentDeep : theme.ink }}>
                      {k.label}
                    </Text>
                    <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
                      fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle, marginTop: 3,
                    }}>{k.hint}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 12,
              backgroundColor: theme.inset, borderRadius: radius.lg, padding: 8, paddingHorizontal: 12,
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, flex: 1, textAlign: 'right' }}>
                العدد
              </Text>
              <TouchableOpacity
                onPress={() => setQty((q) => Math.max(1, q - 1))}
                accessibilityLabel="قلّل العدد"
                style={stepBtn}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink }}>−</Text>
              </TouchableOpacity>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, minWidth: 26, textAlign: 'center' }}>
                {arNum(qty)}
              </Text>
              <TouchableOpacity
                onPress={() => setQty((q) => Math.min(5, q + 1))}
                accessibilityLabel="زد العدد"
                style={stepBtn}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink }}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={{
              fontFamily: fonts.arBold, fontSize: 13, color: theme.ink,
              textAlign: 'right', marginTop: 14, marginBottom: 6,
            }}>
              عنوان التوصيل
            </Text>
            <Input
              value={address || status.shop.address}
              onChangeText={setAddress}
              placeholder="المنطقة، الشارع، علامة مميزة قرب المحل"
              multiline
            />

            <TouchableOpacity
              onPress={request}
              disabled={sending}
              activeOpacity={0.88}
              style={{
                marginTop: 14, borderRadius: radius.xl, paddingVertical: 15,
                alignItems: 'center', backgroundColor: theme.accentDeep,
              }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: '#fff' }}>
                {sending ? 'جارٍ الإرسال…' : 'اطلب الملصق مجاناً'}
              </Text>
            </TouchableOpacity>
            <Text style={{
              fontFamily: fonts.ar, fontSize: 11, color: theme.subtle,
              textAlign: 'center', marginTop: 7,
            }}>
              ما تدفع شي — لا كلفة طباعة ولا توصيل · نراجع الطلب خلال ٢٤ ساعة
            </Text>
          </View>
        )}

        {/* Proof already sent: show it back, so "did it go through?" has an
            answer that is not another support message. */}
        {last?.proof_image_path && reward?.status === 'pending' ? (
          <View style={{
            backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
            borderColor: theme.line, padding: 14, marginTop: 12, flexDirection: 'row-reverse', gap: 12,
          }}>
            <Image
              source={{ uri: fullImageUrl(last.proof_image_path) }}
              style={{ width: 72, height: 72, borderRadius: radius.lg, backgroundColor: theme.inset }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}>
                صورتك قيد المراجعة
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 4, lineHeight: 19 }}>
                نخبرك بالإشعار أول ما نراجعها.
              </Text>
            </View>
          </View>
        ) : null}

      </ScrollView>
    </View>
  );
}

const stepBtn = {
  width: 36, height: 36, borderRadius: radius.md, backgroundColor: theme.surface,
  borderWidth: 1, borderColor: theme.line, alignItems: 'center', justifyContent: 'center',
} as const;

function Step({ done, active, label, sub, line }:
{ done?: boolean; active?: boolean; label: string; sub: string; line?: boolean }) {
  return (
    <View style={{ flexDirection: 'row-reverse', gap: 11 }}>
      <View style={{ width: 22, alignItems: 'center' }}>
        <View style={{
          width: 22, height: 22, borderRadius: 999,
          backgroundColor: done ? theme.success : active ? theme.accentSoft : 'transparent',
          borderWidth: done ? 0 : 2,
          borderColor: active ? theme.accent : theme.line,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {done ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text> : null}
        </View>
        {line ? <View style={{ width: 2, flex: 1, backgroundColor: theme.line }} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: line ? 16 : 0 }}>
        <Text style={{
          fontFamily: fonts.arBold, fontSize: 13.5,
          color: done || active ? theme.ink : theme.subtle, textAlign: 'right',
        }}>{label}</Text>
        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
          {sub}
        </Text>
      </View>
    </View>
  );
}
