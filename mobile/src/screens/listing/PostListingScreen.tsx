import { AskingPriceGuidance } from '../../components/AskingPriceGuidance';
import { listingQuality } from '../../lib/listingQuality';
import { ListingStrengthRail } from '../../components/ListingStrengthRail';
import { InspectionCard } from '../../components/InspectionCard';
import { DescriptionField } from '../../components/DescriptionField';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, TextInput, BackHandler, Modal, KeyboardAvoidingView } from 'react-native';
import { Img } from '../../components/Img';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft } from '../../theme';
import { Btn, FieldLabel, Header, Input, Pill, fmtIQD } from '../../components/ui';
import { GovPicker } from '../../components/GovPicker';
import { districtHint } from '../../lib/governorates';
import { SELLABLE_CONDITIONS } from '../../lib/conditions';
import { fieldsFor, type ConditionDetails } from '../../lib/conditionDetails';
import { slotAt, nextSlot } from '../../lib/photoSlots';
import { type PriceMode } from '../../lib/priceMode';
import { COLOR_CHOICES, canonicalColor, colorProblem } from '../../lib/deviceColors';
import { ConfirmSheet } from '../../components/ConfirmSheet';
import { StepDots, ChipTag } from '../../components/marketplace';
import { IconPin, IconPhoneIcon, IconCheck, IconChevronDown } from '../../components/icons';
import { Listings, Brands, DeviceCatalog, type Condition } from '../../api/endpoints';
import { DevicePickerModal } from '../../components/DevicePickerModal';
import { BrandListModal } from '../../components/BrandListModal';
import { useTrack } from '../../analytics/track';
import { logMetaEvent } from '../../analytics/meta';
import { uploadListingImages, uploadListingVideo, uploadListingImage, type PhotoUploadResult } from '../../api/upload';
import {
  loadDraft, saveDraft, clearDraft, persistDraftImage, newClientKey, draftIsSubstantial,
  setWizardDirty,
} from '../../lib/listingDraft';
import { compressVideo } from '../../lib/videoCompress';
import { ar } from '../../i18n/ar';
import { compressForListing } from '../../lib/imageCompress';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, DEFAULT_GOV_AR } from '../../lib/governorates';
import { digitsOnly, parsePrice, deviceTitle } from '../../lib/format';
import { useAuth } from '../../auth/AuthContext';
import { useNotificationPermission } from '../../push/permission';
import { NotificationGate } from '../../components/NotificationGate';

// Fallback brand list used only if the /brands fetch fails (offline first
// launch). The live list comes from the server so new brands (Infinix,
// POCO, Honor, Oukitel…) show up without an app update — the old hardcoded
// list is exactly what pushed those phones into "Other".
const FALLBACK_BRANDS = ['Apple', 'Samsung', 'Xiaomi', 'Realme', 'Tecno', 'Huawei', 'OPPO', 'Vivo', 'OnePlus', 'Google', 'Nokia', 'Other'];

// Ascending by capacity. The old order put 1TB last after descending
// GB values, so the largest option looked like the smallest.
const STORAGE_CHOICES = ['64GB', '128GB', '256GB', '512GB', '1TB'];
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
  const qualityScrollRef = useRef<ScrollView>(null);
  useEffect(() => { qualityScrollRef.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  // Obligatory notification gate, at the LAST step rather than the first.
  // A seller who publishes and then never hears the buyer ask "متوفر؟" has
  // an ad, not a sale — and by step 6 he has spent real effort, so the ask
  // reads as protecting that work instead of taxing it. Shown between
  // "نشر" and the actual create() call.
  const [notifyGateOpen, setNotifyGateOpen] = useState(false);
  const perm = useNotificationPermission();
  // Which field the current error belongs to, so it can be outlined instead
  // of leaving the user to guess which of five inputs the banner means.
  const [fieldErr, setFieldErr] = useState<string | null>(null);

  // ── draft recovery ───────────────────────────────────────────────────
  // `draftReady` is the same gate cart.tsx documents: until the stored draft
  // has been read, every save is suppressed. Without it the first render's
  // empty state is written over the stored draft before the load resolves,
  // and the recovery destroys the thing it exists to recover.
  const [draftReady, setDraftReady] = useState(false);
  const [restoreAsk, setRestoreAsk] = useState<null | { lostImages: number }>(null);
  const pendingDraft = useRef<any>(null);
  // Survives the whole draft so a retried create can't make a second listing.
  const clientKey = useRef<string>(newClientKey());
  // Photos the server refused, by local URI. Retryable one at a time.
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [publishedId, setPublishedId] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

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

  // NO default brand. It used to start on 'Apple', and a pre-filled dropdown
  // is indistinguishable from a deliberate choice — to the seller who never
  // opens it, and to the server, whose brand auto-correct deliberately only
  // fires for 'Other' because "an explicit brand choice is always respected".
  // That is how 10 live listings ended up as "Apple POCO X7 Pro", "Apple
  // Infinix ZERO 40", "Apple Tecno Camon 30 Pro 5G". Empty forces a choice,
  // and makes every brand that reaches the server a real one.
  const [brand, setBrand] = useState('');
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  // Brand options come from the server so the catalog stays in sync without
  // an app update. "Other" is forced last. Falls back to the hardcoded list
  // only if the fetch fails (e.g. offline first launch).
  const { data: brandRows } = useQuery({
    queryKey: ['brands'],
    queryFn: () => Brands.list(),
    staleTime: 5 * 60 * 1000,
  });
  const brandOptions = (() => {
    const names = (brandRows || []).map((b) => b.name);
    const list = names.length ? names : FALLBACK_BRANDS;
    const withoutOther = list.filter((b) => b !== 'Other');
    return [...withoutOther, 'Other'];
  })();
  const [model, setModel] = useState('');
  // Device model is picked from the catalog (brand → model). We remember when
  // the seller typed a model that wasn't in the list so we can queue it for
  // admin review — the listing still posts with their free-text model.
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [condition, setCondition] = useState<Condition>('used');
  const [storage, setStorage] = useState('128GB');
  const [color, setColor] = useState('');
  const [batteryHealth, setBatteryHealth] = useState('');
  const [conditionDetails, setConditionDetails] = useState<ConditionDetails>({});
  // No longer asked. Kept so the draft round-trips and the payload still
  // carries a value the API expects; see the note beside the price field.
  const [priceMode, setPriceMode] = useState<PriceMode>('fixed');
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
  const qualityIssues = listingQuality({ brand, model, condition, description, images, conditionDetails });
  // The denominator for «قوة الإعلان». Not a constant in listingQuality.ts
  // because the rules there are conditional — a `new` device raises checks a
  // used one never sees — so this is the count a typical listing can face.
  // It only scales the bar; the notes themselves are always the real list.
  const TOTAL_QUALITY_CHECKS = 9;
  // Optional video: local uri after compression, plus a busy flag while the
  // compressor runs (it can take a few seconds on a long clip).
  const [video, setVideo] = useState<{ uri: string; sizeMB: number | null; compressed: boolean } | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);

  // Contact step — public on the listing. WhatsApp is optional and can
  // mirror the contact phone via the "same number" toggle.
  const lowPriceWarnedRef = useRef<number | null>(null);
  // The login number is a PLACEHOLDER, not a prefilled value: prefilled it
  // rendered in full ink and read as something the seller typed. Shown as
  // the light hint it actually is, with the empty field falling back to it
  // at every point of use (validation, payload, the WhatsApp mirror, the
  // review page) — so the default behaviour is unchanged.
  //
  // This also retires the cold-start backfill that used to live here: a
  // placeholder reads user?.phone at render time, so there is no useState
  // snapshot left to race /auth/me against.
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [waSameAsPhone, setWaSameAsPhone] = useState(false);
  const effectivePhone = contactPhone.trim() || user?.phone || '';

  // Android hardware-back: if the user has typed anything (any field
  // dirty) confirm before nuking the wizard. Without this, an accidental
  // back tap at step 4 (after compressing 10 photos) destroys their work
  // with zero recovery — a common Play Store complaint pattern.
  // `brand` belongs here. It was omitted, so a seller who picked only a brand
  // had a form that reported itself clean — no exit confirm, and (now) no
  // draft worth saving.
  const isDirty =
    !!brand || !!model || !!color || !!batteryHealth || accessories.length > 0 ||
    Object.keys(conditionDetails).length > 0 ||
    !!askingPrice || !!city || !!description || images.length > 0 ||
    !!contactPhone || !!contactWhatsapp;

  // Read the stored draft exactly once. We do NOT apply it silently — a form
  // that fills itself in is indistinguishable from one the user filled in and
  // forgot, so the restore is always offered.
  useEffect(() => {
    let alive = true;
    loadDraft()
      .then((res) => {
        if (!alive) return;
        if (res && draftIsSubstantial(res.draft)) {
          pendingDraft.current = res.draft;
          setRestoreAsk({ lostImages: res.lostImages });
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setDraftReady(true); });
    return () => { alive = false; };
  }, []);

  // Persist on every change once the load has settled. Cheap: AsyncStorage
  // writes are async and the payload is a few hundred bytes plus URIs.
  useEffect(() => {
    if (!draftReady || restoreAsk) return;
    if (!isDirty) return;
    saveDraft({
      step, brand, model, condition, storage, color, batteryHealth, warranty, conditionDetails, priceMode,
      accessories, askingPrice, govAr, city, description, images,
      contactPhone, contactWhatsapp, waSameAsPhone,
      clientKey: clientKey.current,
    });
  }, [
    draftReady, restoreAsk, isDirty, step, brand, model, condition, storage, color,
    batteryHealth, warranty, accessories, askingPrice, govAr, city, description, conditionDetails, priceMode,
    images, contactPhone, contactWhatsapp, waSameAsPhone,
  ]);

  // Tell the navigator whether a Sell tab tap would be destroying anything.
  useEffect(() => { setWizardDirty(isDirty); }, [isDirty]);

  const applyDraft = useCallback(() => {
    const d = pendingDraft.current;
    pendingDraft.current = null;
    setRestoreAsk(null);
    if (!d) return;
    setStep(typeof d.step === 'number' ? Math.min(Math.max(d.step, 0), 5) : 0);
    setBrand(d.brand || ''); setModel(d.model || '');
    setCondition(d.condition || 'used'); setStorage(d.storage || '128GB');
    setColor(d.color || ''); setBatteryHealth(d.batteryHealth || '');
    setConditionDetails(d.conditionDetails || {});
    setPriceMode((d.priceMode as PriceMode) || 'fixed');
    setWarranty(d.warranty || 'بدون ضمان');
    setAccessories(Array.isArray(d.accessories) ? d.accessories : []);
    setAskingPrice(d.askingPrice || '');
    if (d.govAr) setGovAr(d.govAr);
    setCity(d.city || ''); setDescription(d.description || '');
    setImages(Array.isArray(d.images) ? d.images : []);
    setContactPhone(d.contactPhone || ''); setContactWhatsapp(d.contactWhatsapp || '');
    setWaSameAsPhone(!!d.waSameAsPhone);
    // Carrying the key over is the point: if the previous attempt actually
    // created the listing and only the response was lost, reusing it returns
    // that listing instead of making a twin.
    if (d.clientKey) clientKey.current = d.clientKey;
  }, []);

  const dropDraft = useCallback(() => {
    pendingDraft.current = null;
    setRestoreAsk(null);
    clientKey.current = newClientKey();
    clearDraft();
  }, []);

  // Wipe the wizard back to a blank step 1.
  const resetForm = useCallback(() => {
    setStep(0); setErr(''); setBusy(false);
    setBrand(''); setModel('');
    setCondition('used'); setStorage('128GB'); setColor(''); setBatteryHealth('');
    setWarranty('بدون ضمان');
    setAccessories([]);
    setAskingPrice(''); setCity(''); setDescription('');
    setImages([]);
    setVideo(null); setVideoBusy(false);
    setContactPhone(''); setContactWhatsapp(''); setWaSameAsPhone(false);
    setFailedPhotos([]); setPublishedId(null);
    // A new form is a new listing: never reuse the old idempotency key, or the
    // server would hand back the previous listing instead of creating this one.
    clientKey.current = newClientKey();
    clearDraft();
  }, []);

  // useFocusEffect, NOT useEffect. BackHandler is app-global and this screen
  // is the Sell TAB ROOT, so it never unmounts — a plain useEffect leaves the
  // handler registered for the life of the process. Combined with the bug
  // below that meant the confirm dialog fired on every back press anywhere in
  // the app, on Browse, on Account, forever, until the process was killed.
  const [exitAsk, setExitAsk] = useState(false);

  // Discard for real. goBack() alone was a no-op from a tab root, so the
  // form kept its values, isDirty stayed true, and the guard re-armed
  // itself on the very next back press.
  // Leaving the wizard no longer destroys the work. resetForm() clears the
  // on-screen state (so the tab is clean when re-entered) but the stored
  // draft stays, and the restore prompt offers it back. The one path that
  // really forgets is dropDraft(), behind an explicit "ابدأ من جديد".
  const discardDraft = useCallback(() => {
    setExitAsk(false);
    setStep(0); setErr(''); setBusy(false);
    setBrand(''); setModel('');
    setCondition('used'); setStorage('128GB'); setColor(''); setBatteryHealth('');
    setWarranty('بدون ضمان'); setAccessories([]);
    setAskingPrice(''); setCity(''); setDescription('');
    setImages([]); setVideo(null); setVideoBusy(false);
    setContactPhone(''); setContactWhatsapp(''); setWaSameAsPhone(false);
    const parent = navigation.getParent?.();
    if (parent) parent.navigate('Browse');
    else if (navigation.canGoBack()) navigation.goBack();
  }, [navigation, resetForm]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!isDirty) return false; // let the default back behaviour run
        setExitAsk(true);
        return true; // we handled it; don't fall through to the default
      });
      return () => sub.remove();
    }, [isDirty]),
  );

  // Battery-health % is only a meaningful spec on Apple devices (iOS
  // surfaces an exact number). For other brands we hide the field.
  const showBattery = brand === 'Apple';

  function toggleAcc(a: string) {
    setAccessories((s) => s.includes(a) ? s.filter((x) => x !== a) : [...s, a]);
  }

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('الفيديو', 'فعّل إذن الوصول للوسائط من إعدادات الجهاز.'); return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false,
      // A minute is plenty to show a phone working; longer clips balloon
      // upload sizes past what mobile data here tolerates.
      videoMaxDuration: 60,
    });
    if (r.canceled || !r.assets?.length) return;
    const asset = r.assets[0];
    setVideoBusy(true);
    try {
      // Compress BEFORE upload (≈720p H.264). On builds without the native
      // compressor the original file is used and the server cap applies.
      const out = await compressVideo(asset.uri);
      let sizeMB: number | null = null;
      try {
        const info = await fetch(out.uri, { method: 'HEAD' }).catch(() => null);
        const len = info?.headers?.get?.('content-length');
        sizeMB = len ? Math.round((Number(len) / 1048576) * 10) / 10
          : asset.fileSize ? Math.round((asset.fileSize / 1048576) * 10) / 10 : null;
      } catch {}
      setVideo({ uri: out.uri, sizeMB, compressed: out.compressed });
    } finally {
      setVideoBusy(false);
    }
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
    // Compress concurrently but cap to 3-at-a-time. A naïve Promise.all
    // over 10 photos was much faster than sequential, but each
    // manipulateAsync holds a decoded bitmap in memory (a 4032×3024
    // photo decodes to ~48 MB) — 10 in parallel can spike to ~480 MB
    // peak and OOM-kill the app on a 2 GB Android Go device. A
    // concurrency of 3 keeps the perceived wait near "slowest single
    // image" without the memory cliff. Per-asset try/catch preserves
    // partial-batch recovery on a single corrupt source.
    const CONCURRENCY = 3;
    const assets = r.assets || [];
    const compressed: string[] = [];
    for (let i = 0; i < assets.length; i += CONCURRENCY) {
      const chunk = assets.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        chunk.map(async (a) => {
          try { return await compressForListing(a.uri); }
          catch { return null; }
        }),
      );
      for (const u of settled) if (u) compressed.push(u);
    }
    // compressForListing() writes into the app CACHE directory, which the OS
    // may purge between launches — persisting those URIs alone would restore
    // a draft with broken images. Copy into documentDirectory first; a failed
    // copy falls back to the cache URI, which still works this session.
    const durable = await Promise.all(compressed.map((u) => persistDraftImage(u)));
    setImages((cur) => [...cur, ...durable].slice(0, 10));
  }

  // Retry a single photo against the listing that already exists. This is
  // only reachable after a publish that partially failed, which is why it
  // takes publishedId rather than creating anything.
  const retryPhoto = useCallback(async (uri: string) => {
    if (!publishedId || retrying) return;
    setRetrying(uri);
    try {
      await uploadListingImage(publishedId, uri);
      setFailedPhotos((cur) => cur.filter((u) => u !== uri));
      qc.invalidateQueries({ queryKey: ['listing', publishedId] });
    } catch (e: any) {
      Alert.alert('لم تُرفع الصورة', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally {
      setRetrying(null);
    }
  }, [publishedId, retrying, qc]);

  function removeImg(i: number) {
    setImages((s) => s.filter((_, idx) => idx !== i));
  }

  const create = useMutation({
    mutationFn: async () => {
      const wa = waSameAsPhone ? effectivePhone : (contactWhatsapp || null);
      const listing = await Listings.create({
        brand, model, storage: storage || null, color: canonicalColor(color) || null,
        condition,
        condition_details: conditionDetails,
        price_mode: priceMode,
        // Server ignores null; only Apple listings carry a battery value.
        battery_health: showBattery && batteryHealth ? Number(batteryHealth) : null,
        warranty_status: warranty,
        accessories,
        asking_price: Number(askingPrice),
        governorate: GOV_AR_TO_EN[govAr],
        city: city || null,
        description: description || null,
        contact_phone: effectivePhone,
        contact_whatsapp: wa,
        // Makes a retry of THIS create idempotent. If a previous attempt
        // reached the server and only the reply was lost, the server returns
        // that listing rather than creating a second one.
        client_key: clientKey.current,
      });
      setPublishedId(listing.id);

      // Photos upload one at a time and their failures are REPORTED, not
      // fatal. This used to roll the listing back with Listings.remove() on
      // any upload error — the reasoning was sound (don't leave a phantom
      // image-less listing) but the cost was not: a single dropped packet on
      // the last step destroyed a six-step form, and the seller's only
      // recourse was to do the whole thing again over the same bad
      // connection. The video path next door already had the better answer —
      // publish, report, let them retry the media — so images now match it.
      let failed: string[] = [];
      if (images.length > 0) {
        const results: PhotoUploadResult[] = await uploadListingImages(listing.id, images);
        failed = results.filter((r) => !r.ok).map((r) => r.uri);
      }
      setFailedPhotos(failed);
      // Video is OPTIONAL and review-gated — its failure must never cost
      // the seller a five-step listing. Post without it and say so.
      if (video) {
        try {
          await uploadListingVideo(listing.id, video.uri);
        } catch {
          Alert.alert('الفيديو لم يُرفع', 'إعلانك منشور بدون الفيديو. يمكنك تجربة رفعه لاحقاً من تعديل الإعلان.');
        }
      }
      return { listing, failedCount: failed.length };
    },
    onSuccess: ({ listing, failedCount }) => {
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
      // Meta App Event — the "add device" conversion Ads Manager optimises
      // for. Fire-and-forget: logMetaEvent swallows its own errors, so a
      // broken SDK can never block the hand-off to the detail screen.
      logMetaEvent('AddDevice', {
        brand: listing.brand,
        condition: listing.condition,
        governorate: listing.governorate,
      });
      // The draft has done its job. Clearing it here and not in the mutation
      // body means a create that threw keeps its draft — which is exactly
      // when the seller needs it.
      clearDraft();
      clientKey.current = newClientKey();

      if (failedCount > 0) {
        // Say it plainly and point at the one place it can be fixed. The old
        // code would have deleted the listing rather than admit this.
        Alert.alert(
          'نُشر الإعلان، وبعض الصور لم تُرفع',
          `${failedCount} من الصور لم تُرفع بسبب الاتصال. إعلانك منشور، وتقدر ترفع الصور الباقية من تعديل الإعلان.`,
        );
      }
      navigation.replace('ListingDetail', { id: listing.id });
    },
    // `reason` first: the server sends a widely-understood `error` code for
    // the benefit of older builds and puts the specific cause in `reason`.
    // Falling back to `.network` for an unknown code is what told shops
    // their connection had failed when they had simply hit a quota.
    onError: (e: any) => setErr(
      (ar.errors as any)[e?.data?.reason]
      || (ar.errors as any)[e?.message]
      || (ar.errors as any).network,
    ),
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
    // Name the field that is actually empty. The old message asked for
    // "the brand and the model" even when the brand was already filled,
    // which reads as the form not knowing what it has.
    if (step === 0 && !brand) { setFieldErr('brand'); return setErr('اختر العلامة التجارية'); }
    if (step === 0 && !model) { setFieldErr('model'); return setErr('اختر موديل الجهاز'); }
    if (step === 1) {
      const cp = colorProblem(color);
      if (cp) { setFieldErr('color'); return setErr(cp); }
      // Battery health is a percentage. 999 used to sail through.
      if (batteryHealth) {
        const n = Number(digitsOnly(batteryHealth));
        if (!Number.isFinite(n) || n < 1 || n > 100) {
          setFieldErr('battery');
          return setErr('صحة البطارية بين 1 و 100 بالمئة.');
        }
      }
    }
    // Step 1 — the device's own facts. All required now: a listing that omits
    // capacity, colour, accessories or the condition answers is the listing
    // buyers open a chat about and sellers answer the same three questions
    // for, over and over.
    if (step === 1) {
      if (!storage) { setFieldErr('storage'); return setErr('اختر السعة'); }
      if (!color.trim()) { setFieldErr('color'); return setErr('اختر لون الجهاز'); }
      if (accessories.length === 0) {
        setFieldErr('accessories');
        return setErr('اختر الملحقات — أو «بدون ملحقات» إن لم يكن معها شيء.');
      }
      // Only for a device that HAS a history: a sealed phone has no screen
      // wear, no repairs and no water damage to declare, and asking would be
      // the form not paying attention.
      const need = fieldsFor(condition);
      const missing = need.filter((f) => !conditionDetails[f.id]);
      if (missing.length) {
        setFieldErr('conditionDetails');
        return setErr(`أجب عن ${missing[0].question} — «غير معروف» جواب مقبول.`);
      }
    }
    if (step === 2) {
      const priceVal = parsePrice(askingPrice);
      if (priceVal == null) { setFieldErr('price'); return setErr('أدخل سعراً صحيحاً'); }
      // Hard floor: no listings under 100,000 IQD. First attempt reads as
      // a typo check ("did you drop a zero?"), a second attempt at the
      // same low price gets the policy stated outright. Editing the price
      // resets the ladder (lowPriceWarnedRef tracks WHICH value we warned
      // about). The server enforces the same floor regardless.
      if (priceVal < 100000) {
        setFieldErr('price');
        if (lowPriceWarnedRef.current === priceVal) {
          return setErr('نعتذر — لا نقبل أي جهاز بسعر أقل من 100,000 د.ع.');
        }
        lowPriceWarnedRef.current = priceVal;
        return setErr('تأكد أن السعر أعلى من 100,000 د.ع.');
      }
      lowPriceWarnedRef.current = null;
      // The description is where a buyer decides whether to call. Thirty
      // characters is about one honest sentence — enough to have said
      // something, short enough not to be a wall a seller gives up at.
      if (description.trim().length < 30) {
        setFieldErr('description');
        return setErr('اكتب وصفاً قصيراً لحالة الجهاز (30 حرفاً على الأقل).');
      }
    }
    if (step === 3) {
      // Accept Arabic-Indic digits (٠١٢…) in phone fields. Iraqi keyboards
      // default to them, so a raw /\D/g filter would silently empty the
      // field and block the wizard at step 3 for many real users.
      const digits = digitsOnly(effectivePhone);
      if (digits.length < 10) { setFieldErr('phone'); return setErr('أدخل رقم هاتف صحيح للتواصل'); }
      if (!waSameAsPhone && contactWhatsapp) {
        const waDigits = digitsOnly(contactWhatsapp);
        if (waDigits.length < 10) { setFieldErr('whatsapp'); return setErr('رقم واتساب غير صحيح'); }
      }
    }
    // Say how many are still missing rather than repeating, word for word,
    // the helper text already on screen above the button.
    if (step === 4 && images.length < 3) {
      const missing = 3 - images.length;
      return setErr(images.length === 0
        ? 'أضف 3 صور على الأقل للمتابعة.'
        : `أضفت ${images.length} من 3 — بقيت ${missing === 1 ? 'صورة واحدة' : `${missing} صور`}.`);
    }
    if (step === 5) {
      // Don't block on `loading` — an unresolved read shouldn't stop a
      // publish; the gate simply doesn't appear that once.
      if (!perm.loading && !perm.granted) { setNotifyGateOpen(true); return; }
      create.mutate();
      return;
    }
    setFieldErr(null);
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
          <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, textAlign: 'center' }}>
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
        {/* «قوة الإعلان» — the checklist, moved to where it gets read. It
            used to sit BELOW each step's content, which on a 390pt screen
            means below the fold, so a seller could finish the whole wizard
            and press publish having never seen a note. */}
        <ListingStrengthRail
          issues={qualityIssues}
          totalChecks={TOTAL_QUALITY_CHECKS}
          onEdit={(target) => {
            setErr(''); setFieldErr(null); setStep(target);
            qualityScrollRef.current?.scrollTo({ y: 0, animated: true });
          }}
        />
      </View>
      {/* automaticallyAdjustKeyboardInsets is iOS-only, so on Android the
          keyboard still opened over «وصف حالة الجهاز» — the last field on
          step 2 — and the seller typed blind. The app is edge-to-edge, which
          means adjustResize no longer resizes the window either, so padding
          on BOTH platforms is what works. ChatScreen documents the same. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView
        ref={qualityScrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {step === 0 && (
          <>
            <FieldLabel>العلامة التجارية</FieldLabel>
            {/* A tap-to-open list rather than a pill grid: 20 brands as pills
                sprawled over several lines and buried the later ones. */}
            <TouchableOpacity
              onPress={() => setBrandPickerOpen(true)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg,
                backgroundColor: theme.surface, paddingHorizontal: 14, paddingVertical: 13,
                marginBottom: 12,
              }}
            >
              <Text style={{
                fontFamily: brand ? fonts.arBold : fonts.ar,
                fontSize: 14.5,
                color: brand ? theme.ink : theme.subtle,
              }}>
                {brand || 'اختر العلامة التجارية…'}
              </Text>
              <IconChevronDown size={18} color={theme.subtle} sw={1.8} />
            </TouchableOpacity>
            <BrandListModal
              visible={brandPickerOpen}
              brands={brandOptions.map((b) => ({ name: b }))}
              value={brand}
              onClose={() => setBrandPickerOpen(false)}
              onSelect={(b) => { if (b) { setBrand(b); setModel(''); } }}
            />
            <FieldLabel>الموديل</FieldLabel>
            {/* Model is picked from the device catalog for this brand, so it
                matches what buyers search for. If it's not in the list the
                seller can still type it (and we queue it for review). */}
            <TouchableOpacity
              onPress={() => (brand ? setDevicePickerOpen(true) : setBrandPickerOpen(true))}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                paddingHorizontal: 14, paddingVertical: 13,
                backgroundColor: theme.surface, borderRadius: radius.lg,
                borderWidth: 1, borderColor: theme.line,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  flex: 1, textAlign: 'right', writingDirection: model ? 'ltr' : 'rtl',
                  fontFamily: model ? fonts.arBold : fonts.ar, fontSize: 14,
                  color: model ? theme.ink : theme.subtle,
                }}
              >
                {model || 'اختر الجهاز…'}
              </Text>
              <IconChevronDown size={16} color={theme.subtle} sw={2} />
            </TouchableOpacity>
            <DevicePickerModal
              visible={devicePickerOpen}
              brand={brand}
              value={model}
              allowManual
              onClose={() => setDevicePickerOpen(false)}
              onSelect={(m, meta) => {
                setModel(m);
                setDevicePickerOpen(false);
                // Device the seller typed isn't in the catalog → queue it for
                // an admin to add, so the next seller finds it. Best-effort.
                if (!meta.fromCatalog) DeviceCatalog.suggest(brand, m).catch(() => {});
              }}
            />

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
              {/* SELLABLE, not CONDITIONS: «مجدد» is no longer offered but stays a
                  valid value so the listings that carry it remain filterable. */}
              {SELLABLE_CONDITIONS.map((c) => <Pill key={c} active={condition === c} onPress={() => setCondition(c)}>{(ar.listing as any)[c]}</Pill>)}
            </View>

            {/* Structured condition, as ONE card rather than four rows of
                pills indistinguishable from «السعة» and «اللون» above them.
                An answered row collapses, so the step gets shorter as the
                seller works — which is the reason anyone reaches the fourth
                question. Still suggestions, never a gate: leaving them blank
                publishes. See components/InspectionCard.tsx. */}
            <InspectionCard condition={condition} value={conditionDetails} onChange={setConditionDetails} />

            <FieldLabel>{ar.listing.storage}</FieldLabel>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {STORAGE_CHOICES.map((s) => <Pill key={s} active={storage === s} onPress={() => setStorage(s)}>{s}</Pill>)}
            </View>
            <FieldLabel>{ar.listing.color}</FieldLabel>
            {/* Chips first, free text second. One tap gives a canonical
                spelling, which is what makes colour filterable at all. */}
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {COLOR_CHOICES.map((c) => (
                <Pill
                  key={c}
                  active={canonicalColor(color) === c}
                  onPress={() => { setColor(canonicalColor(color) === c ? '' : c); setFieldErr(null); }}
                >
                  {c}
                </Pill>
              ))}
            </View>
            <Input
              value={color}
              onChangeText={(v) => { setColor(v); if (fieldErr === 'color') setFieldErr(null); }}
              onBlur={() => setColor((c) => canonicalColor(c))}
              placeholder="أو اكتب لوناً آخر…"
              invalid={fieldErr === 'color'}
            />
            {/* Battery health only renders for Apple — iOS surfaces an
                exact percentage in Settings, while non-Apple devices
                don't have an equivalent canonical metric. */}
            {showBattery ? (
              <>
                <FieldLabel style={{ marginTop: 12 }}>{ar.listing.battery} (%)</FieldLabel>
                <Input
                  value={batteryHealth}
                  onChangeText={(v) => {
                    // Cap at three characters and drop anything over 100 as
                    // it is typed, so the field cannot hold 999 at all.
                    const d = digitsOnly(v).slice(0, 3);
                    setBatteryHealth(d && Number(d) > 100 ? '100' : d);
                    if (fieldErr === 'battery') setFieldErr(null);
                  }}
                  placeholder="مثلاً 92 (اختياري)"
                  numeric
                  invalid={fieldErr === 'battery'}
                />
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
                placeholder="٠"
                placeholderTextColor={theme.line}
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
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accentDeep }}>
                  د.ع
                </Text>
              </View>
            </View>
            <Text style={{ marginTop: 6, fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right' }}>
              السعر بالدينار العراقي — اكتب الأرقام فقط، التنسيق تلقائي. مثال: 500,000
            </Text>
            {/* Thousands-nudge: IQD listings are almost always in the 100k–
                millions range, so a raw "500" is almost certainly meant as
                500,000. We show a one-tap fix rather than silently ×1000
                (someone genuinely selling a 500 IQD cable would be wrecked
                by a hidden multiplier). */}
            {Number(askingPrice) >= 1 && Number(askingPrice) < 1000 ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setAskingPrice(String(Number(askingPrice) * 1000))}
                style={{
                  marginTop: 8, alignSelf: 'flex-end',
                  flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
                  backgroundColor: theme.accentSoft,
                  borderWidth: 1, borderColor: theme.accent,
                  borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
                }}
              >
                <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.accentDeep }}>
                  هل تقصد {(Number(askingPrice) * 1000).toLocaleString('en-US')} د.ع؟
                </Text>
                <View style={{ backgroundColor: theme.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: '#fff' }}>نعم</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            <View style={{ marginTop: 12, marginBottom: 12 }}>
              <GovPicker label="موقع الإعلان · المحافظة" valueAr={govAr} onChangeAr={setGovAr} />
            </View>
            {/* «نوع السعر» (ثابت / قابل للتفاوض) was asked here and is not any
                more: the owner removed it. Every listing posts as `fixed`,
                which is what the field defaulted to anyway. The VALUE stays
                in the API and on the card — shops set it from the panel and
                the importer, and dropping it from the payload would silently
                flip those listings. */}
            <AskingPriceGuidance brand={brand} model={model} storage={storage}
              condition={condition} governorate={GOV_AR_TO_EN[govAr]} askingPrice={Number(askingPrice)} />
            <FieldLabel>{ar.auth.city}</FieldLabel>
            <Input value={city} onChangeText={setCity} placeholder={districtHint(govAr)} />
            {/* The note about the description now lives UNDER the
                description, and turns green when it is satisfied. It used to
                be one row in a card at the bottom of the step, which is
                where a seller who has already scrolled past the field never
                looks. See components/DescriptionField.tsx. */}
            <DescriptionField
              value={description}
              onChange={setDescription}
              note={qualityIssues.find((i) => i.id === 'description')?.advice}
            />
          </>
        )}
        {step === 3 && (
          <>
            <FieldLabel>رقم الهاتف للتواصل</FieldLabel>
            <Input value={contactPhone} onChangeText={setContactPhone} placeholder={user?.phone || '07700001234'} numeric ltr />
            <Text style={{ marginTop: 6, fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', lineHeight: 18 }}>
              {user?.phone
                ? 'يظهر للمشترين على صفحة الإعلان. اتركه فارغاً لاستخدام رقمك المسجّل.'
                : 'يظهر للمشترين على صفحة الإعلان — يمكنهم الاتصال أو فتح واتساب مباشرة.'}
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
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: waSameAsPhone ? theme.success : theme.subtle }}>
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
                واتساب: {effectivePhone || '—'}
              </Text>
            )}
          </>
        )}
        {step === 4 && (
          <>
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 10,
            }}>
              <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right' }}>
                {ar.post.needAtLeast3}
              </Text>
              {/* Progress, so "3 required" is a target and not just a rule. */}
              <Text style={{
                fontFamily: fonts.mono, fontSize: 12,
                color: images.length >= 3 ? theme.success : theme.subtle,
              }}>
                {images.length} / 3
              </Text>
            </View>
            {/* Labelled slots, not a wall of identical squares. The label is
                positional — we cannot verify what a photo actually shows, so
                it reads as "photo three is usually the side", a prompt rather
                than a claim about the picture above it. Past the fourth,
                photos are unlabelled instead of wrongly labelled. */}
            {/* Said BEFORE the picker opens, not after upload. A seller who
                learns about review only when their listing is held reads it
                as a rejection; here it is just the rule. */}
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8,
              backgroundColor: theme.accentSoft, borderColor: theme.accent, borderWidth: 1,
              borderRadius: radius.lg, padding: 11, marginBottom: 12,
            }}>
              <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 12.5, color: theme.accentDeep, textAlign: 'right', lineHeight: 20 }}>
                تُراجَع صور كل إعلان قبل نشره. اختر صوراً واضحة للجهاز نفسه — لا صوراً من الإنترنت ولا صوراً تحتوي أرقاماً أو معلومات شخصية.
              </Text>
            </View>

            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
              {images.map((uri, i) => (
                <View key={i} style={{ position: 'relative', width: 100 }}>
                  <Img source={{ uri }} style={{ width: 100, height: 100, borderRadius: radius.md, backgroundColor: theme.surface }} />
                  <TouchableOpacity onPress={() => removeImg(i)} style={{ position: 'absolute', top: -6, left: -6, width: 22, height: 22, borderRadius: 999, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff' }}>×</Text>
                  </TouchableOpacity>
                  {slotAt(i) ? (
                    <Text numberOfLines={1} style={{
                      fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle,
                      textAlign: 'center', marginTop: 3,
                    }}>
                      {slotAt(i)!.label}
                    </Text>
                  ) : null}
                </View>
              ))}
              {images.length < 10 ? (
                <View style={{ width: 100 }}>
                  <TouchableOpacity onPress={pickImages} style={{ width: 100, height: 100, borderRadius: radius.md, borderWidth: 2, borderColor: theme.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                    {nextSlot(images.length) ? (
                      <>
                        <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.ink, textAlign: 'center' }}>
                          + {nextSlot(images.length)!.label}
                        </Text>
                        <Text numberOfLines={2} style={{ fontFamily: fonts.ar, fontSize: 9.5, color: theme.subtle, textAlign: 'center', marginTop: 2 }}>
                          {nextSlot(images.length)!.hint}
                        </Text>
                      </>
                    ) : (
                      <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>+ {ar.post.addImages}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            {/* Optional video. One clip, compressed on-device, and held for
                review — the notice sets that expectation BEFORE upload so
                "why isn't my video showing" support calls never start. */}
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', marginTop: 18, marginBottom: 8 }}>
              فيديو للجهاز (اختياري)
            </Text>
            {video ? (
              <View style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
                backgroundColor: theme.surface, borderRadius: radius.lg,
                borderWidth: 1, borderColor: theme.line, padding: 12,
              }}>
                <Text style={{ fontSize: 22 }}>🎬</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
                    فيديو جاهز للرفع
                  </Text>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                    {video.sizeMB ? `${video.sizeMB} MB` : ''}{video.sizeMB && video.compressed ? ' · ' : ''}{video.compressed ? 'مضغوط' : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setVideo(null)} hitSlop={8} style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff' }}>×</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={pickVideo}
                disabled={videoBusy}
                style={{
                  borderRadius: radius.lg, borderWidth: 2, borderColor: theme.line,
                  borderStyle: 'dashed', paddingVertical: 16, alignItems: 'center',
                  opacity: videoBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
                  {videoBusy ? 'جارٍ ضغط الفيديو…' : '+ أضف فيديو (حتى ٦٠ ثانية)'}
                </Text>
              </TouchableOpacity>
            )}
            {/* The small notice the review gate promises. */}
            <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: '#B07A28', textAlign: 'right', marginTop: 6, lineHeight: 17 }}>
              ملاحظة: الفيديو لا يُنشر مباشرة — يظهر على إعلانك بعد موافقة الإدارة.
            </Text>
          </>
        )}
        {step === 5 && (
          <>
            {/* Eyebrow — explains what they're looking at without yelling. */}
            <Text style={{
              fontFamily: fonts.arBold, fontSize: 11.5,
              color: theme.subtle,
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
                  fontFamily: fonts.arBold, fontSize: 19,
                  color: theme.ink, textAlign: 'right', letterSpacing: -0.3 }}>
                  {deviceTitle(brand, model)}
                </Text>

                {/* Price block — accent deep, matching the live detail page */}
                <View style={{ marginTop: 10, alignItems: 'flex-end' }}>
                  <Text style={{
                    fontFamily: fonts.arBold, fontSize: 11,
                    color: theme.subtle,
                  }}>
                    السعر المطلوب
                  </Text>
                  <Text style={{
                    marginTop: 2, fontFamily: fonts.ltrBold, fontSize: 28,
                    color: theme.accentDeep, fontWeight: '700', letterSpacing: -0.5,
                  }}>
                    {fmtIQD(Number(askingPrice))}
                    <Text style={{ fontSize: 14, color: theme.subtle, fontFamily: fonts.ar }}>
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
                    {effectivePhone}
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
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 11, color: theme.subtle, textAlign: 'right', marginBottom: 4 }}>
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
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 11, color: theme.subtle, textAlign: 'right', marginBottom: 6 }}>
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
                {qualityIssues.length ? 'راجع الملاحظات أدناه لتحسين إعلانك. يمكنك النشر بعد مراجعتها.' : 'جاهز للنشر. اضغط "نشر" بالأسفل لإطلاق إعلانك.'}
              </Text>
            </View>
          </>
        )}

        {/* The bottom-of-step checklist is gone — it lives in the header
            rail now, where it cannot be scrolled past. What remains here is
            the review step's own summary, which is about publishing rather
            than about any one field. */}
      </ScrollView>
      </KeyboardAvoidingView>

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
        {/* Floating, not a bar: the two buttons sit on their own rounded
            surfaces over the form rather than inside a full-width footer
            slab. Step 1 used to show only "التالي", leaving a 30dp top arrow
            as the sole way out — every step still pairs forward with back. */}
        <View style={{ flexDirection: 'row-reverse', gap: 10, alignItems: 'center' }}>
          <View style={{ flex: 1, borderRadius: radius.pill, overflow: 'hidden', ...shadowSoft }}>
            <Btn kind="primary" full onPress={next} busy={create.isPending}>
              {step === 5 ? ar.post.publish : ar.post.next}
            </Btn>
          </View>
          <View style={{
            borderRadius: radius.pill, overflow: 'hidden',
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            ...shadowSoft,
          }}>
            <TouchableOpacity
              onPress={() => (step > 0 ? setStep(step - 1) : (isDirty ? setExitAsk(true) : navigation.goBack()))}
              accessibilityRole="button"
              style={{ paddingHorizontal: 20, paddingVertical: 14 }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink }}>
                {step > 0 ? ar.post.back : 'إلغاء'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Restore, never silently. A form that fills itself in is
          indistinguishable from one the user filled in and forgot. The count
          of purged photos is stated up front so the seller isn't surprised by
          a short gallery at step 5. */}
      <ConfirmSheet
        visible={!!restoreAsk}
        title="نكمل إعلانك السابق؟"
        body={
          restoreAsk && restoreAsk.lostImages > 0
            ? `عندك إعلان لم تكمله. ${restoreAsk.lostImages} من صوره لم تعد موجودة على الجهاز وسيلزم اختيارها من جديد.`
            : 'عندك إعلان لم تكمله. نقدر نكمل من حيث توقفت.'
        }
        // Inverted on purpose. ConfirmSheet gives the FILLED button to
        // `cancel` because it is built for destructive confirms where
        // cancelling is the safe path — and it routes a scrim tap there too.
        // Here the safe path is keeping the draft, so continuing takes the
        // cancel slot: it gets the emphasis, and a stray tap outside the
        // sheet restores rather than discards.
        confirmText="ابدأ من جديد"
        cancelText="أكمل"
        onConfirm={dropDraft}
        onCancel={applyDraft}
      />

      <ConfirmSheet
        visible={exitAsk}
        title="تترك الإعلان؟"
        body="سنحتفظ بما كتبته كمسودة، وتقدر تكمله لاحقاً."
        confirmText="اترك الآن"
        cancelText="متابعة الكتابة"
        destructive
        onConfirm={discardDraft}
        onCancel={() => setExitAsk(false)}
      />

      {/* Last-step notification gate. Full-screen rather than a sheet, because
          this is a step and not a question — and the draft stays mounted
          underneath, so nothing the seller typed is at risk. Granting
          publishes immediately: he already pressed «نشر» once, and making him
          press it twice for the same intent is just a toll. */}
      <Modal visible={notifyGateOpen} animationType="slide" onRequestClose={() => setNotifyGateOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
          <Header
            title="خطوة أخيرة"
            eyebrow="قبل النشر"
            onBack={() => setNotifyGateOpen(false)}
          />
          <NotificationGate
            required
            compactReasons
            title="فعّل الإشعارات ليصل إليك المشتري"
            intro="سيُنشر إعلانك بعد هذه الخطوة. يراسلك المشترون عبر التطبيق — ومن دون إشعارات لن تعرف بهم، وسيتجهون إلى إعلان آخر."
            onGranted={() => { setNotifyGateOpen(false); create.mutate(); }}
          />
        </View>
      </Modal>
    </View>
  );
}
