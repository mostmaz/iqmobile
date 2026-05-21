import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, TextInput, BackHandler } from 'react-native';
import { Img } from '../../components/Img';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Btn, FieldLabel, Header, Input, Pill, fmtIQD } from '../../components/ui';
import { GovPicker } from '../../components/GovPicker';
import { StepDots, ChipTag } from '../../components/marketplace';
import { IconPin, IconPhoneIcon, IconCheck } from '../../components/icons';
import { Listings, type Condition } from '../../api/endpoints';
import { useTrack } from '../../analytics/track';
import { uploadListingImages } from '../../api/upload';
import { ar } from '../../i18n/ar';
import { compressForListing } from '../../lib/imageCompress';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, DEFAULT_GOV_AR } from '../../lib/governorates';
import { digitsOnly, parsePrice } from '../../lib/format';
import { useAuth } from '../../auth/AuthContext';

const BRANDS = ['Apple', 'Samsung', 'Xiaomi', 'Realme', 'Tecno', 'Huawei', 'OPPO', 'Vivo', 'OnePlus', 'Google', 'Nokia', 'Other'];
const CONDITIONS: Condition[] = ['new', 'used', 'refurbished', 'repaired'];
const ACCESSORIES_CHOICES = ['الشاحن', 'السماعات', 'العلبة الأصلية', 'كفر', 'لاصق شاشة', 'فاتورة'];
// Warranty options surfaced on step 0. Stored as the raw Arabic value on
// the server (warranty_status is a free-text TEXT column, no enum check);
// we render the same strings back wherever needed.
const WARRANTY_CHOICES = ['ضمان رسمي', 'ضمان محل', 'بدون ضمان'] as const;
type Warranty = typeof WARRANTY_CHOICES[number];

export default function PostListingScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const track = useTrack();
  const [step, setStep] = useState(0);

  // Posting requires a real (non-guest) account. Auto-provisioned guests
  // get bounced to the AuthGate on first entry to this screen, then
  // (after they enter a phone) to CompleteProfile via the navigation
  // gate in RootNav. We only auto-redirect once per mount — if the user
  // cancels the AuthGate modal we fall back to the inline CTA so they
  // can retry without being repeatedly hijacked.
  const isGuest = !!user?.is_guest;
  const autoRedirected = useRef(false);
  useEffect(() => {
    if (isGuest && !autoRedirected.current) {
      autoRedirected.current = true;
      navigation.getParent()?.getParent?.()?.navigate('AuthGate');
    }
  }, [isGuest, navigation]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // (Seller-name prompt removed — CompleteProfileScreen handles first-login
  // name capture for real users now. Guest sessions are short-lived and
  // upgrade to a real account via AuthGate before they can post.)

  const [brand, setBrand] = useState('Apple');
  const [model, setModel] = useState('');
  const [condition, setCondition] = useState<Condition>('used');
  const [storage, setStorage] = useState('128GB');
  const [color, setColor] = useState('');
  const [batteryHealth, setBatteryHealth] = useState('');
  // Warranty defaults to "no warranty" — the most common case for used
  // resale listings, so the user only has to change it for the minority
  // case where official/shop warranty applies.
  const [warranty, setWarranty] = useState<Warranty>('بدون ضمان');
  const [accessories, setAccessories] = useState<string[]>([]);
  const [askingPrice, setAskingPrice] = useState('');
  // Default governorate to whatever the user's profile has — that's set
  // by the onboarding location permission, so most users see their
  // actual province pre-selected here.
  const [govAr, setGovAr] = useState(GOV_EN_TO_AR[user?.governorate || ''] || DEFAULT_GOV_AR);
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);

  // Contact step — public on the listing. WhatsApp is optional and can
  // mirror the contact phone via the "same number" toggle.
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [waSameAsPhone, setWaSameAsPhone] = useState(false);

  // Android hardware-back: if the user has typed anything (any field
  // dirty) confirm before nuking the wizard. Without this, an accidental
  // back tap at step 4 (after compressing 10 photos) destroys their work
  // with zero recovery — a common Play Store complaint pattern.
  const isDirty =
    !!model || !!color || !!batteryHealth || accessories.length > 0 ||
    !!askingPrice || !!city || !!description || images.length > 0 ||
    !!contactPhone || !!contactWhatsapp;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isDirty) return false; // let the default back behaviour run
      Alert.alert(
        'تأكيد الخروج',
        'ستفقد الإعلان الذي بدأت بكتابته. هل تريد الخروج؟',
        [
          { text: 'متابعة الكتابة', style: 'cancel' },
          { text: 'خروج', style: 'destructive', onPress: () => navigation.goBack() },
        ],
      );
      return true; // we handled it; don't fall through to the default
    });
    return () => sub.remove();
  }, [isDirty, navigation]);

  // Battery-health % is only a meaningful spec on Apple devices (iOS
  // surfaces an exact number). For other brands we hide the field.
  const showBattery = brand === 'Apple';

  function toggleAcc(a: string) {
    setAccessories((s) => s.includes(a) ? s.filter((x) => x !== a) : [...s, a]);
  }

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('الصور', 'فعّل إذن الصون من إعدادات الجهاز.'); return;
    }
    // Guard against the off-by-one where `images.length === 10` makes
    // `selectionLimit: 0`, which expo-image-picker treats as "no limit"
    // on some Android versions — letting the user blow past the cap
    // and then silently lose extras to .slice(0, 10) below.
    const remaining = 10 - images.length;
    if (remaining <= 0) {
      Alert.alert('الحد الأقصى', 'الحد الأقصى 10 صور.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: remaining,
    });
    if (r.canceled) return;
    // Compress in parallel — picking 10 photos that each take 600ms to
    // resize used to add up to 6s of staring at a spinner; doing them
    // concurrently brings that down to roughly the slowest single
    // image. Per-asset try/catch keeps a single corrupt photo from
    // dropping the whole batch (the previous Promise.all without
    // wrapping would throw on the first failure and lose every other
    // compressed result).
    const settled = await Promise.all(
      (r.assets || []).map(async (a) => {
        try { return await compressForListing(a.uri); }
        catch { return null; }
      }),
    );
    const compressed = settled.filter((u): u is string => !!u);
    setImages((cur) => [...cur, ...compressed].slice(0, 10));
  }

  function removeImg(i: number) {
    setImages((s) => s.filter((_, idx) => idx !== i));
  }

  const create = useMutation({
    mutationFn: async () => {
      const wa = waSameAsPhone ? contactPhone : (contactWhatsapp || null);
      const listing = await Listings.create({
        brand, model, storage: storage || null, color: color || null,
        condition,
        // Server ignores null; only Apple listings carry a battery value.
        battery_health: showBattery && batteryHealth ? Number(batteryHealth) : null,
        warranty_status: warranty,
        accessories,
        asking_price: Number(askingPrice),
        governorate: GOV_AR_TO_EN[govAr],
        city: city || null,
        description: description || null,
        contact_phone: contactPhone,
        contact_whatsapp: wa,
      });
      // Roll back the listing if image upload fails — otherwise we leave
      // a phantom no-image listing on the server, the user sees an error
      // and re-submits, and we end up with duplicates. Best-effort:
      // if the rollback itself fails, log and surface the original
      // upload error so the user knows what went wrong.
      if (images.length > 0) {
        try {
          await uploadListingImages(listing.id, images);
        } catch (uploadErr) {
          try { await Listings.remove(listing.id); } catch {}
          throw uploadErr;
        }
      }
      return listing;
    },
    onSuccess: (listing) => {
      qc.invalidateQueries({ queryKey: ['mine'] });
      qc.invalidateQueries({ queryKey: ['browse'] });
      // safeTrack so a PostHog throw can't block navigation.replace —
      // user just spent five steps posting their phone; the wizard MUST
      // hand off to the detail screen even if analytics is broken.
      try {
        track('listing.created', {
          listing_id: listing.id,
          brand: listing.brand,
          condition: listing.condition,
          asking_price: listing.asking_price,
          governorate: listing.governorate,
          warranty: warranty,
          image_count: images.length,
        });
      } catch {}
      navigation.replace('ListingDetail', { id: listing.id });
    },
    onError: (e: any) => setErr((ar.errors as any)[e?.message] || (ar.errors as any).network),
  });

  // Step layout (6 total):
  //   0 Brand + model
  //   1 Specs (condition, storage, color, battery [Apple only], accessories)
  //   2 Price + location + description
  //   3 Contact (phone required, whatsapp optional with "same number" toggle)
  //   4 Images (≥3)
  //   5 Review
  function next() {
    setErr('');
    if (step === 0 && (!brand || !model)) return setErr('أدخل العلامة والموديل');
    if (step === 2 && parsePrice(askingPrice) == null) return setErr('أدخل سعراً صحيحاً');
    if (step === 3) {
      // Accept Arabic-Indic digits (٠١٢…) in phone fields. Iraqi keyboards
      // default to them, so a raw /\D/g filter would silently empty the
      // field and block the wizard at step 3 for many real users.
      const digits = digitsOnly(contactPhone);
      if (digits.length < 10) return setErr('أدخل رقم هاتف صحيح للتواصل');
      if (!waSameAsPhone && contactWhatsapp) {
        const waDigits = digitsOnly(contactWhatsapp);
        if (waDigits.length < 10) return setErr('رقم واتساب غير صحيح');
      }
    }
    if (step === 4 && images.length < 3) return setErr(ar.post.needAtLeast3);
    if (step === 5) { create.mutate(); return; }
    setStep(step + 1);
  }

  // Guest fallback — also reachable if the user dismissed the AuthGate
  // modal that the useEffect above pushed. A clear inline CTA so they
  // can retry without leaving the Sell tab.
  if (isGuest) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Header title={ar.post.title} onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, fontWeight: '700', color: theme.ink, textAlign: 'center' }}>
            سجّل الدخول لنشر إعلان
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'center', lineHeight: 22 }}>
            ادخل برقم هاتفك ثم اختر إن كنت شخصاً أو متجراً. يستغرق أقل من دقيقة.
          </Text>
          <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
            <Btn kind="accent" full onPress={() => navigation.getParent()?.getParent?.()?.navigate('AuthGate')}>
              تسجيل الدخول
            </Btn>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={ar.post.title} eyebrow={`الخطوة ${step + 1} من 6`} onBack={() => step === 0 ? navigation.goBack() : setStep(step - 1)} />
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <StepDots total={6} current={step} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {step === 0 && (
          <>
            <FieldLabel>العلامة التجارية</FieldLabel>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {BRANDS.map((b) => <Pill key={b} active={brand === b} onPress={() => setBrand(b)}>{b}</Pill>)}
            </View>
            <FieldLabel>الموديل</FieldLabel>
            <Input value={model} onChangeText={setModel} placeholder="مثلاً iPhone 13 Pro" ltr />

            {/* Warranty — single-select. Defaulted to "بدون ضمان" since
                most resale listings have no warranty. */}
            <FieldLabel style={{ marginTop: 14 }}>الضمان</FieldLabel>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
              {WARRANTY_CHOICES.map((w) => (
                <Pill key={w} active={warranty === w} onPress={() => setWarranty(w)}>{w}</Pill>
              ))}
            </View>

            {/* Accessories moved to step 0 so the buyer-relevant context
                (what's in the box) sits with the brand/model headline,
                not buried with the technical specs. */}
            <FieldLabel style={{ marginTop: 14 }}>{ar.listing.accessories}</FieldLabel>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
              {ACCESSORIES_CHOICES.map((a) => (
                <Pill key={a} active={accessories.includes(a)} onPress={() => toggleAcc(a)}>{a}</Pill>
              ))}
            </View>
          </>
        )}
        {step === 1 && (
          <>
            <FieldLabel>الحالة</FieldLabel>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {CONDITIONS.map((c) => <Pill key={c} active={condition === c} onPress={() => setCondition(c)}>{(ar.listing as any)[c]}</Pill>)}
            </View>
            <FieldLabel>{ar.listing.storage}</FieldLabel>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {['64GB', '128GB', '256GB', '512GB', '1TB'].map((s) => <Pill key={s} active={storage === s} onPress={() => setStorage(s)}>{s}</Pill>)}
            </View>
            <FieldLabel>{ar.listing.color}</FieldLabel>
            <Input value={color} onChangeText={setColor} placeholder="أسود، أبيض، …" />
            {/* Battery health only renders for Apple — iOS surfaces an
                exact percentage in Settings, while non-Apple devices
                don't have an equivalent canonical metric. */}
            {showBattery ? (
              <>
                <FieldLabel style={{ marginTop: 12 }}>{ar.listing.battery} (%)</FieldLabel>
                <Input value={batteryHealth} onChangeText={setBatteryHealth} placeholder="مثلاً 92 (اختياري)" numeric />
              </>
            ) : null}
          </>
        )}
        {step === 2 && (
          <>
            <FieldLabel>{ar.listing.asking}</FieldLabel>
            {/* Distinctive price field: large LTR digits on the right with a
                visible د.ع suffix on the left, accent border so it reads as
                THE primary input on this step. Live-comma-format as the user
                types; we store raw digits for clean backend parsing. */}
            <View style={{
              flexDirection: 'row-reverse',
              alignItems: 'center',
              backgroundColor: theme.surface,
              borderRadius: radius.lg,
              borderWidth: 1.5,
              borderColor: askingPrice ? theme.accent : theme.line,
              paddingHorizontal: 16,
              minHeight: 64,
            }}>
              <TextInput
                value={askingPrice ? Number(askingPrice).toLocaleString('en-US') : ''}
                onChangeText={(v) => setAskingPrice(digitsOnly(v))}
                placeholder="500,000"
                placeholderTextColor={theme.subtle}
                keyboardType="phone-pad"
                autoComplete="off"
                textContentType="none"
                importantForAutofill="noExcludeDescendants"
                autoCorrect={false}
                spellCheck={false}
                secureTextEntry={false}
                passwordRules=""
                style={{
                  flex: 1,
                  fontFamily: fonts.ltrBold,
                  fontSize: 26,
                  fontWeight: '700',
                  color: theme.accentDeep,
                  textAlign: 'right',
                  writingDirection: 'ltr',
                  paddingVertical: 12,
                  letterSpacing: -0.3,
                }}
              />
              <View style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                backgroundColor: theme.accentSoft, marginLeft: 8,
              }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, fontWeight: '700', color: theme.accentDeep }}>
                  د.ع
                </Text>
              </View>
            </View>
            <Text style={{ marginTop: 6, fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right' }}>
              السعر بالدينار العراقي — اكتب الأرقام فقط، التنسيق تلقائي.
            </Text>
            <View style={{ marginTop: 12, marginBottom: 12 }}>
              <GovPicker label="موقع الإعلان · المحافظة" valueAr={govAr} onChangeAr={setGovAr} />
            </View>
            <FieldLabel>{ar.auth.city}</FieldLabel>
            <Input value={city} onChangeText={setCity} placeholder="الكرادة، المنصور، …" />
            <FieldLabel style={{ marginTop: 12 }}>{ar.listing.description}</FieldLabel>
            <Input value={description} onChangeText={setDescription} placeholder="ملاحظات إضافية…" multiline />
          </>
        )}
        {step === 3 && (
          <>
            <FieldLabel>رقم الهاتف للتواصل</FieldLabel>
            <Input value={contactPhone} onChangeText={setContactPhone} placeholder="07700001234" numeric ltr />
            <Text style={{ marginTop: 6, fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', lineHeight: 18 }}>
              يظهر للمشترين على صفحة الإعلان — يمكنهم الاتصال أو فتح واتساب مباشرة.
            </Text>

            <View style={{ marginTop: 14, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
              <FieldLabel style={{ marginBottom: 0 }}>رقم واتساب (اختياري)</FieldLabel>
              <TouchableOpacity
                onPress={() => setWaSameAsPhone((s) => !s)}
                activeOpacity={0.75}
                style={{
                  flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                  paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999,
                  backgroundColor: waSameAsPhone ? theme.successSoft : theme.surface,
                  borderWidth: 1.5,
                  borderColor: waSameAsPhone ? theme.success : theme.line,
                }}
              >
                <View style={{
                  width: 20, height: 20, borderRadius: 6,
                  backgroundColor: waSameAsPhone ? theme.success : 'transparent',
                  borderWidth: waSameAsPhone ? 0 : 2, borderColor: theme.subtle,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {waSameAsPhone ? <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>✓</Text> : null}
                </View>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, fontWeight: '700', color: waSameAsPhone ? theme.success : theme.subtle }}>
                  نفس الرقم
                </Text>
              </TouchableOpacity>
            </View>
            {!waSameAsPhone ? (
              <View style={{ marginTop: 8 }}>
                <Input value={contactWhatsapp} onChangeText={setContactWhatsapp} placeholder="07710001234" numeric ltr />
              </View>
            ) : (
              <Text style={{ marginTop: 6, fontFamily: fonts.mono, fontSize: 10.5, color: theme.subtle, textAlign: 'right', writingDirection: 'ltr' }}>
                واتساب: {contactPhone || '—'}
              </Text>
            )}
          </>
        )}
        {step === 4 && (
          <>
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', marginBottom: 10 }}>
              {ar.post.needAtLeast3}
            </Text>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
              {images.map((uri, i) => (
                <View key={i} style={{ position: 'relative' }}>
                  <Img source={{ uri }} style={{ width: 100, height: 100, borderRadius: radius.md, backgroundColor: theme.surface }} />
                  <TouchableOpacity onPress={() => removeImg(i)} style={{ position: 'absolute', top: -6, left: -6, width: 22, height: 22, borderRadius: 999, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff' }}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {images.length < 10 ? (
                <TouchableOpacity onPress={pickImages} style={{ width: 100, height: 100, borderRadius: radius.md, borderWidth: 2, borderColor: theme.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>+ {ar.post.addImages}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        )}
        {step === 5 && (
          <>
            {/* Eyebrow — explains what they're looking at without yelling. */}
            <Text style={{
              fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.4,
              color: theme.subtle, textTransform: 'uppercase',
              textAlign: 'right', marginBottom: 8,
            }}>
              معاينة الإعلان قبل النشر
            </Text>

            {/* Preview card — visually mirrors the live ListingDetail so
                the seller knows exactly what buyers will see. */}
            <View style={{
              backgroundColor: theme.surface,
              borderRadius: radius.xxl,
              borderWidth: 1, borderColor: theme.line,
              overflow: 'hidden',
            }}>
              {/* Cover image (first one). If somehow none uploaded — shouldn't
                  happen, step 4 enforces ≥3 — show a tasteful placeholder. */}
              {images.length > 0 ? (
                <View>
                  <Img
                    source={{ uri: images[0] }}
                    style={{ width: '100%', height: 220, backgroundColor: theme.chipBg }}
                  />
                  {/* Photo count badge, bottom-right of the cover */}
                  <View style={{
                    position: 'absolute', bottom: 10, left: 10,
                    backgroundColor: 'rgba(20,16,12,0.7)',
                    paddingHorizontal: 10, paddingVertical: 4,
                    borderRadius: 999,
                  }}>
                    <Text style={{ color: '#fff', fontFamily: fonts.ltrBold, fontSize: 11.5, fontWeight: '700' }}>
                      📷 {images.length}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={{ height: 220, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.subtle, fontFamily: fonts.mono, letterSpacing: 1.4 }}>
                    {brand.toUpperCase()}
                  </Text>
                </View>
              )}

              {/* Strip of thumbnails for the remaining photos */}
              {images.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, padding: 10 }}>
                  {images.slice(1).map((uri, i) => (
                    <Img key={i} source={{ uri }}
                      style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: theme.chipBg }} />
                  ))}
                </ScrollView>
              ) : null}

              {/* Card body */}
              <View style={{ padding: 16 }}>
                {/* Chip row — condition / storage / color / warranty */}
                <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  <ChipTag>{(ar.listing as any)[condition]}</ChipTag>
                  {storage ? <ChipTag>{storage}</ChipTag> : null}
                  {color ? <ChipTag>{color}</ChipTag> : null}
                  <ChipTag>{warranty}</ChipTag>
                </View>

                <Text numberOfLines={1} style={{
                  fontFamily: fonts.arBold, fontSize: 19, fontWeight: '700',
                  color: theme.ink, textAlign: 'right', letterSpacing: -0.3,
                }}>
                  {brand} {model}
                </Text>

                {/* Price block — accent deep, matching the live detail page */}
                <View style={{ marginTop: 10, alignItems: 'flex-end' }}>
                  <Text style={{
                    fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4,
                    color: theme.subtle, textTransform: 'uppercase',
                  }}>
                    السعر المطلوب
                  </Text>
                  <Text style={{
                    marginTop: 2, fontFamily: fonts.ltrBold, fontSize: 28,
                    color: theme.accentDeep, fontWeight: '700', letterSpacing: -0.5,
                  }}>
                    {fmtIQD(Number(askingPrice))}
                    <Text style={{ fontSize: 14, color: theme.subtle, fontFamily: fonts.ar, fontWeight: '500' }}>
                      {'  '}د.ع
                    </Text>
                  </Text>
                </View>

                {/* Divider */}
                <View style={{ height: 1, backgroundColor: theme.line, marginVertical: 14 }} />

                {/* Location row */}
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                  <IconPin size={15} color={theme.subtle} sw={1.7} />
                  <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}>
                    {govAr}{city ? ` · ${city}` : ''}
                  </Text>
                </View>

                {/* Contact row */}
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <IconPhoneIcon size={15} color={theme.subtle} sw={1.7} />
                  <Text style={{ flex: 1, fontFamily: fonts.mono, fontSize: 13, color: theme.ink, textAlign: 'right', writingDirection: 'ltr' }}>
                    {contactPhone}
                    {(waSameAsPhone || contactWhatsapp) ? (
                      <Text style={{ color: theme.success }}>
                        {'  ·  '}واتساب
                      </Text>
                    ) : null}
                  </Text>
                </View>

                {/* Description (if any) */}
                {description ? (
                  <>
                    <View style={{ height: 1, backgroundColor: theme.line, marginVertical: 14 }} />
                    <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, color: theme.subtle, textTransform: 'uppercase', textAlign: 'right', marginBottom: 4 }}>
                      الوصف
                    </Text>
                    <Text numberOfLines={4} style={{ fontFamily: fonts.ar, fontSize: 13.5, color: theme.ink, textAlign: 'right', lineHeight: 22 }}>
                      {description}
                    </Text>
                  </>
                ) : null}

                {/* Accessories row */}
                {accessories.length > 0 ? (
                  <>
                    <View style={{ height: 1, backgroundColor: theme.line, marginVertical: 14 }} />
                    <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, color: theme.subtle, textTransform: 'uppercase', textAlign: 'right', marginBottom: 6 }}>
                      الملحقات
                    </Text>
                    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
                      {accessories.map((a) => <ChipTag key={a}>{a}</ChipTag>)}
                    </View>
                  </>
                ) : null}
              </View>
            </View>

            {/* Ready-to-publish hint below the card */}
            <View style={{
              marginTop: 14, paddingHorizontal: 14, paddingVertical: 12,
              backgroundColor: theme.successSoft, borderRadius: radius.lg,
              borderWidth: 1, borderColor: theme.success,
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
            }}>
              <IconCheck size={16} color={theme.success} sw={2.2} />
              <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13, color: theme.success, textAlign: 'right', lineHeight: 20 }}>
                جاهز للنشر. اضغط "نشر" بالأسفل لإطلاق إعلانك.
              </Text>
            </View>
          </>
        )}

      </ScrollView>

      {/* Sticky footer — soft elevation instead of a hard border so it floats
          cleanly above the wizard content. Always shows the primary action. */}
      <View style={{
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: Math.max(insets.bottom, 14),
        backgroundColor: theme.bg,
        shadowColor: '#1B1A18',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
        elevation: 8,
      }}>
        {err ? (
          <View style={{
            marginBottom: 10,
            paddingHorizontal: 12, paddingVertical: 9,
            backgroundColor: 'rgba(180,58,46,0.08)',
            borderRadius: radius.md,
          }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.danger, textAlign: 'right' }}>
              {err}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
          {step > 0 ? <Btn kind="ghost" full onPress={() => setStep(step - 1)}>{ar.post.back}</Btn> : null}
          <Btn kind="primary" full onPress={next} busy={create.isPending}>
            {step === 5 ? ar.post.publish : ar.post.next}
          </Btn>
        </View>
      </View>
    </View>
  );
}
