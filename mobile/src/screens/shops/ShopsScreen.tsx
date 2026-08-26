// Shops directory — merchandise-forward redesign (design_handoff_shops §B).
// Every shop card leads with three device thumbnails (+N overlay), then
// activity / reply / idle badges, so the list answers "who actually has
// stock and answers messages" before a single tap. Client-side controls:
// an activity chip (نشط = posted in the last 7 days), a multi-select brand
// filter sheet with live counts, and a five-option sort sheet whose default
// (الأنسب) ranks featured → posted-this-week → reply rate → stock size.
// All filter state lives in this component, so goBack() from a shop page
// restores exactly what the shopper had (the screen stays mounted).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT } from '../../theme';
import { Img } from '../../components/Img';
import {
  IconStore, IconStar, IconPin, IconSpark, IconPlus, IconChevronLeft,
  IconChevronDown, IconFilter, IconChat,
} from '../../components/icons';
import { GovPicker } from '../../components/GovPicker';
import { Shops, type ShopCard } from '../../api/endpoints';
import { fullImageUrl } from '../../api/upload';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';

// Arabic-Indic numerals for counts and days (prices keep fmtIQD elsewhere).
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

const DAY_MS = 86400000;
const ACTIVE_WINDOW_MS = 7 * DAY_MS;

// Arabic labels for brand chips; anything unmapped shows its raw name.
const BRAND_AR: Record<string, string> = {
  Samsung: 'سامسونگ', Apple: 'آيفون', Xiaomi: 'شاومي', Tecno: 'تكنو',
  Honor: 'هونر', Infinix: 'إنفنكس', Realme: 'ريلمي', OPPO: 'أوبو',
  Oppo: 'أوبو', Vivo: 'فيفو', Huawei: 'هواوي', Nokia: 'نوكيا',
  Google: 'كوكل', OnePlus: 'ون بلس', POCO: 'بوكو', Motorola: 'موتورولا',
};
const brandAr = (b: string) => BRAND_AR[b] || b;

type SortKey = 'best' | 'most' | 'fast' | 'rated' | 'new';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'best', label: 'الأنسب' },
  { key: 'most', label: 'الأكثر أجهزة' },
  { key: 'fast', label: 'الأسرع رداً' },
  { key: 'rated', label: 'الأعلى تقييماً' },
  { key: 'new', label: 'الأحدث نشراً' },
];

const postedRecently = (s: ShopCard, now: number) =>
  !!(s.last_posted_at && now - s.last_posted_at <= ACTIVE_WINDOW_MS);

export default function ShopsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Governorate default: the shopper's own, applied once (see previous
  // revision's note — `user` hydrates late, but a touched picker is never
  // overridden underneath the shopper).
  const homeGovAr = (user?.governorate && GOV_EN_TO_AR[user.governorate]) || '';
  const [govAr, setGovAr] = useState(homeGovAr);
  const govPinned = useRef(!!homeGovAr);
  useEffect(() => {
    if (govPinned.current || !homeGovAr) return;
    govPinned.current = true;
    setGovAr(homeGovAr);
  }, [homeGovAr]);
  const govEn = govAr ? GOV_AR_TO_EN[govAr] : undefined;

  // Directory state (survives navigating into a shop and back: the screen
  // stays mounted under the stack, so plain component state is the store).
  const [tab, setTab] = useState<'all' | 'active'>('all');
  const [sort, setSort] = useState<SortKey>('best');
  const [brands, setBrands] = useState<string[]>([]);
  const [draftBrands, setDraftBrands] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['shops', govEn ?? '__all__'],
    queryFn: () => Shops.list(govEn),
  });
  useFocusEffect(React.useCallback(() => { refetch(); }, [refetch]));
  const shops = useMemo(() => data ?? [], [data]);
  const now = Date.now();

  // ── Filtering ────────────────────────────────────────────────────
  const byTab = useMemo(
    () => (tab === 'active' ? shops.filter((s) => postedRecently(s, now)) : shops),
    [shops, tab, now],
  );
  const applyBrands = (list: ShopCard[], sel: string[]) =>
    sel.length ? list.filter((s) => (s.brands || []).some((b) => sel.includes(b))) : list;
  const visible = useMemo(() => {
    const rows = applyBrands(byTab, brands);
    const arr = [...rows];
    const cmp: Record<SortKey, (a: ShopCard, b: ShopCard) => number> = {
      // الأنسب: featured → posted-in-7-days → reply rate → active stock.
      best: (a, b) =>
        Number(b.is_featured) - Number(a.is_featured)
        || Number(postedRecently(b, now)) - Number(postedRecently(a, now))
        || (b.reply_rate ?? -1) - (a.reply_rate ?? -1)
        || (b.active_count ?? 0) - (a.active_count ?? 0),
      most: (a, b) => (b.active_count ?? 0) - (a.active_count ?? 0),
      // Fastest reply: measured medians first (ascending), unmeasured last.
      fast: (a, b) =>
        (a.reply_median_minutes ?? Infinity) - (b.reply_median_minutes ?? Infinity)
        || (b.active_count ?? 0) - (a.active_count ?? 0),
      rated: (a, b) =>
        (Number(b.rating_avg) || 0) - (Number(a.rating_avg) || 0)
        || (b.rating_count ?? 0) - (a.rating_count ?? 0),
      new: (a, b) => (b.last_posted_at ?? 0) - (a.last_posted_at ?? 0),
    };
    arr.sort(cmp[sort]);
    return arr;
  }, [byTab, brands, sort, now]);

  // Brand facet counts reflect the current activity chip (README: chip
  // numbers and the result count must come from the same base set).
  const brandFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of byTab) for (const b of new Set(s.brands || [])) {
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [byTab]);
  const draftCount = useMemo(
    () => applyBrands(byTab, draftBrands).length,
    [byTab, draftBrands],
  );

  const isShop = user?.seller_type === 'shop';
  const sortLabel = SORTS.find((s) => s.key === sort)!.label;

  const clearAll = () => { setTab('all'); setSort('best'); setBrands([]); setDraftBrands([]); };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <View style={{
        paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10,
        borderBottomWidth: 1, borderBottomColor: theme.line,
      }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 21, color: theme.ink, textAlign: 'right' }}>
          متاجر {govAr || 'العراق'}
        </Text>
        <Text style={{ marginTop: 2, fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right' }}>
          {arNum(visible.length)} متجر
        </Text>

        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <HeaderControl onPress={() => { setDraftBrands(brands); setFilterOpen(true); }}>
            <IconFilter size={16} color={theme.ink} sw={1.8} />
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink }}>فلترة</Text>
            {brands.length ? (
              <View style={{ minWidth: 17, height: 17, borderRadius: 999, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ fontFamily: fonts.ltrBold, fontSize: 9.5, color: '#fff' }}>{brands.length}</Text>
              </View>
            ) : null}
          </HeaderControl>
          <HeaderControl onPress={() => setSortOpen(true)}>
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink }}>{sortLabel}</Text>
            <IconChevronDown size={13} color={theme.ink} sw={2} />
          </HeaderControl>
          <View style={{ flex: 1 }} />
          <GovPicker
            valueAr={govAr}
            onChangeAr={(v) => { govPinned.current = true; setGovAr(v); }}
            allowAll
            allLabel="كل المحافظات"
            compact
          />
        </View>

        {/* Activity chips + brand rail. The rail is the same selection the
            filter sheet edits — quick toggles for the common case, the sheet
            for counts and clearing. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12, flexDirection: 'row-reverse' }}
          contentContainerStyle={{ flexDirection: 'row-reverse', gap: 8 }}
        >
          <Chip selected={tab === 'all'} onPress={() => setTab('all')} label="الكل" />
          <Chip selected={tab === 'active'} onPress={() => setTab('active')} label="نشط" />
          {brandFacets.map(([brand]) => (
            <Chip
              key={brand}
              selected={brands.includes(brand)}
              onPress={() => setBrands((s2) => s2.includes(brand) ? s2.filter((x) => x !== brand) : [...s2, brand])}
              label={brandAr(brand)}
            />
          ))}
        </ScrollView>
      </View>

      {/* ── List ────────────────────────────────────────────────── */}
      <FlatList
        data={isLoading ? [] : visible}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, paddingTop: 12 }}
        renderItem={({ item }) => (
          <ShopRow shop={item} now={now} onPress={() => navigation.navigate('ShopDetail', { id: item.id })} />
        )}
        ListEmptyComponent={isLoading ? (
          <DirectorySkeleton />
        ) : (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center' }}>
              <IconStore size={30} color={theme.subtle} sw={1.6} />
            </View>
            <Text style={{ marginTop: 14, fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>
              ما في متاجر بهذي الفلاتر
            </Text>
            <Text style={{ marginTop: 5, fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, lineHeight: 21, textAlign: 'center' }}>
              جرّب تشيل فلتر أو غيّر المحافظة
            </Text>
            <TouchableOpacity
              onPress={clearAll}
              activeOpacity={0.85}
              style={{ marginTop: 16, backgroundColor: theme.ink, borderRadius: radius.lg, paddingHorizontal: 20, paddingVertical: 11 }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk }}>مسح الفلاتر</Text>
            </TouchableOpacity>
            {govAr && !brands.length && tab === 'all' ? (
              <TouchableOpacity
                onPress={() => { govPinned.current = true; setGovAr(''); }}
                activeOpacity={0.85}
                style={{ marginTop: 10, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface }}
              >
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink }}>عرض متاجر كل المحافظات</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        ListFooterComponent={
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ShopRegister')}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
              backgroundColor: isShop ? theme.surface : theme.ink,
              borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg,
              paddingHorizontal: 14, paddingVertical: 12, marginTop: 4,
            }}
          >
            <IconPlus size={18} color={isShop ? theme.ink : theme.buttonInk} sw={2} />
            <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 14, color: isShop ? theme.ink : theme.buttonInk, textAlign: 'right' }}>
              {isShop ? 'إدارة متجري' : 'سجّل متجرك مجاناً'}
            </Text>
            <View style={{ transform: [{ scaleX: -1 }] }}>
              <IconChevronLeft size={14} color={isShop ? theme.subtle : theme.buttonInk} sw={2} />
            </View>
          </TouchableOpacity>
        }
      />

      {/* ── Filter sheet ────────────────────────────────────────── */}
      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 17.5, color: theme.ink }}>فلترة المتاجر</Text>
          <TouchableOpacity onPress={() => setDraftBrands([])} hitSlop={10}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accentDeep }}>مسح الكل</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ marginTop: 16, fontFamily: fonts.arBold, fontSize: 12.5, color: theme.subtle, textAlign: 'right' }}>
          عنده أجهزة
        </Text>
        <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {brandFacets.map(([brand, count]) => {
            const on = draftBrands.includes(brand);
            const dead = count === 0;
            return (
              <TouchableOpacity
                key={brand}
                disabled={dead}
                onPress={() => setDraftBrands((s) => on ? s.filter((x) => x !== brand) : [...s, brand])}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
                  paddingHorizontal: 15, paddingVertical: 10, borderRadius: 999,
                  backgroundColor: on ? theme.accent : theme.chipBg,
                  opacity: dead ? 0.38 : 1,
                }}
              >
                <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: on ? '#fff' : theme.chipInk }}>
                  {brandAr(brand)}
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: on ? 'rgba(255,255,255,0.85)' : theme.subtle }}>
                  {arNum(count)}
                </Text>
              </TouchableOpacity>
            );
          })}
          {!brandFacets.length ? (
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>
              ما في ماركات ضمن الفلتر الحالي.
            </Text>
          ) : null}
        </View>

        {draftCount === 0 ? (
          <Text style={{ marginTop: 14, fontFamily: fonts.ar, fontSize: 12.5, color: theme.danger, textAlign: 'center' }}>
            ما في نتائج — جرّب تشيل فلتر
          </Text>
        ) : null}
        <TouchableOpacity
          disabled={draftCount === 0}
          onPress={() => { setBrands(draftBrands); setFilterOpen(false); }}
          activeOpacity={0.85}
          style={{
            marginTop: draftCount === 0 ? 8 : 18, borderRadius: 14, paddingVertical: 14,
            alignItems: 'center',
            backgroundColor: draftCount === 0 ? theme.chipBg : theme.accent,
          }}
        >
          <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: draftCount === 0 ? theme.subtle : '#fff' }}>
            عرض {arNum(draftCount)} متجر
          </Text>
        </TouchableOpacity>
      </Sheet>

      {/* ── Sort sheet ──────────────────────────────────────────── */}
      <Sheet open={sortOpen} onClose={() => setSortOpen(false)}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 17.5, color: theme.ink, textAlign: 'right' }}>الترتيب</Text>
        <View style={{ marginTop: 8 }}>
          {SORTS.map((o) => {
            const on = sort === o.key;
            return (
              <TouchableOpacity
                key={o.key}
                onPress={() => { setSort(o.key); setSortOpen(false); }}
                activeOpacity={0.8}
                style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 11, paddingVertical: 13, paddingHorizontal: 2 }}
              >
                <View style={{
                  width: 20, height: 20, borderRadius: 999, borderWidth: 2,
                  borderColor: on ? theme.accent : 'rgba(27,26,24,0.25)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {on ? <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: theme.accent }} /> : null}
                </View>
                <Text style={{ fontFamily: on ? fonts.arBold : fonts.ar, fontSize: 14.5, color: on ? theme.accentDeep : theme.ink }}>
                  {o.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

// ─── Shop card ─────────────────────────────────────────────────────
function ShopRow({ shop, now, onPress }: { shop: ShopCard; now: number; onPress: () => void }) {
  const logo = shop.shop_image_path || shop.profile_image_path;
  const initial = (shop.shop_name || shop.display_name || '?').trim()[0] || '?';
  const thumbs = shop.thumbnails || [];
  const activeCount = shop.active_count ?? 0;
  const extra = Math.max(0, activeCount - thumbs.length);
  const recent = postedRecently(shop, now);
  const idleDays = shop.last_posted_at ? Math.floor((now - shop.last_posted_at) / DAY_MS) : null;
  const fastReply = shop.reply_median_minutes != null && shop.reply_median_minutes <= 60;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: 20, borderWidth: 1,
      borderColor: shop.is_featured ? theme.accent : theme.line, ...shadowSoft,
      padding: 12, marginBottom: 12,
    }}>
      {/* Row 1 — identity */}
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {logo ? (
            <Img source={{ uri: fullImageUrl(logo) }} style={{ width: 52, height: 52 }} />
          ) : (
            <Text style={{ fontFamily: fonts.arBold, fontSize: 20, color: theme.subtle }}>{initial}</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 15.5, color: theme.ink, textAlign: 'right', flexShrink: 1 }}>
              {shop.shop_name}
            </Text>
            {shop.is_featured ? (
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 2, backgroundColor: theme.accent, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                <IconSpark size={9} color="#fff" />
                <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 9.5 }}>مميّز</Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {shop.rating_count > 0 && Number.isFinite(shop.rating_avg as any) ? (
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3 }}>
                <IconStar size={12} filled color={theme.accent} />
                <Text style={{ fontFamily: fonts.ltrBold, fontSize: 12, color: theme.ink }}>
                  {Number(shop.rating_avg).toFixed(1)}
                </Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 3, flexShrink: 1 }}>
              <IconPin size={11} color={theme.subtle} />
              <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle }}>
                {arOf(shop.governorate)}{shop.city ? ` · ${shop.city}` : ''}
              </Text>
            </View>
          </View>
        </View>
        <IconChevronLeft size={16} color={theme.subtle} sw={2} />
      </View>

      {/* Row 2 — merchandise: three thumbnails, +N overlay on the third */}
      {activeCount > 0 ? (
        <View style={{ flexDirection: 'row-reverse', gap: 7, marginTop: 10 }}>
          {[0, 1, 2].map((i) => {
            const img = thumbs[i];
            const isLast = i === 2;
            return (
              <View key={i} style={{ flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: theme.chipBg, overflow: 'hidden' }}>
                {img ? (
                  <Img source={{ uri: fullImageUrl(img) }} contentFit="cover" style={{ width: '100%', height: '100%' }} />
                ) : null}
                {isLast && extra > 0 ? (
                  <View style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(27,26,24,0.62)', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.surface }}>
                      +{arNum(extra)} جهاز
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Row 3 — badges */}
      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {shop.new_today_count ? (
          <Badge bg={theme.successSoft}>
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: theme.success }} />
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.success }}>
              {shop.new_today_count === 1 ? 'جهاز جديد اليوم' : `${arNum(shop.new_today_count)} أجهزة جديدة اليوم`}
            </Text>
          </Badge>
        ) : null}
        {fastReply ? (
          <Badge bg={theme.chipBg}>
            <IconChat size={11} color={theme.chipInk} sw={1.8} />
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.chipInk }}>
              يرد خلال ساعة
            </Text>
          </Badge>
        ) : null}
        {!recent ? (
          <Badge bg="transparent" border="rgba(27,26,24,0.14)">
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>
              {idleDays == null ? 'ما نشر بعد' : `ما نشر من ${arNum(idleDays)} يوم`}
            </Text>
          </Badge>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Small pieces ──────────────────────────────────────────────────
function HeaderControl({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
      height: 38, paddingHorizontal: 13, borderRadius: 999,
      backgroundColor: theme.surface, borderWidth: 1, borderColor: 'rgba(27,26,24,0.09)',
    }}>
      {children}
    </TouchableOpacity>
  );
}

function Chip({ selected, onPress, label }: { selected: boolean; onPress: () => void; label: string }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{
      paddingHorizontal: 15, paddingVertical: 10, borderRadius: 999,
      backgroundColor: selected ? theme.accent : theme.chipBg,
    }}>
      <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: selected ? '#fff' : theme.chipInk }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Badge({ bg, border, children }: { bg: string; border?: string; children: React.ReactNode }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
      backgroundColor: bg, borderWidth: border ? 1 : 0, borderColor: border,
    }}>
      {children}
    </View>
  );
}

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(27,26,24,0.45)' }} />
      <View style={{
        backgroundColor: theme.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 18, paddingTop: 8, paddingBottom: insets.bottom + 18, maxHeight: 640,
      }}>
        <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: 'rgba(27,26,24,0.18)', marginBottom: 14 }} />
        <ScrollView bounces={false}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

// Skeleton matching the final card geometry so nothing jumps when data
// lands (kept local: Skeleton.tsx is out of scope for this review round).
function DirectorySkeleton() {
  return (
    <View>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{
          backgroundColor: theme.surface, borderRadius: 20, borderWidth: 1,
          borderColor: theme.line, padding: 12, marginBottom: 12,
        }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: theme.chipBg }} />
            <View style={{ flex: 1, alignItems: 'flex-end', gap: 7 }}>
              <View style={{ width: '55%', height: 13, borderRadius: 6, backgroundColor: theme.chipBg }} />
              <View style={{ width: '35%', height: 11, borderRadius: 6, backgroundColor: theme.chipBg }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row-reverse', gap: 7, marginTop: 10 }}>
            {[0, 1, 2].map((j) => (
              <View key={j} style={{ flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: theme.chipBg }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 10 }}>
            <View style={{ width: 110, height: 24, borderRadius: 999, backgroundColor: theme.chipBg }} />
            <View style={{ width: 90, height: 24, borderRadius: 999, backgroundColor: theme.chipBg }} />
          </View>
        </View>
      ))}
    </View>
  );
}
