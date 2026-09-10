// طلبات الأجهزة — the request board.
//
// This tab is the active half of the marketplace: instead of a buyer
// hunting through listings, he publishes «اطلب جهازاً» and the sellers come
// to him. Three views behind one segmented control, because the same board
// serves two very different people:
//
//   كل الطلبات — every open request (what a SELLER opens the tab for)
//   طلباتي     — the buyer's own requests + the offers they collected
//   عروضي      — what this seller has already quoted, so he doesn't re-walk
//                the board wondering which ones he answered
//
// The create sheet mirrors WishlistScreen's add panel deliberately: a buyer
// who has used one should recognise the other instantly — brand pills, the
// catalog device picker, a stepped budget.

import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, Header, Pill, Input, fmtIQD } from '../../components/ui';
import { Img } from '../../components/Img';
import { bundledBrandLogo } from '../../lib/brandLogos';
import {
  IconRequest, IconPlus, IconMinus, IconChevronDown, IconClose, IconPin,
  IconChat, IconTag, IconCheck,
} from '../../components/icons';
import { DevicePickerModal } from '../../components/DevicePickerModal';
import { GovPicker } from '../../components/GovPicker';
import { TextRowListSkeleton } from '../../components/Skeleton';
import { PhoneRequests, DeviceCatalog, type PhoneRequest, type SentOffer, type RequestSort } from '../../api/endpoints';
import { deviceTitle, timeAgoAr, timeLeftAr } from '../../lib/format';
import { GOV_AR_TO_EN, GOV_EN_TO_AR, arOf } from '../../lib/governorates';
import { useAuth } from '../../auth/AuthContext';
import { conditionLabel } from '../../components/RequestComposeSheet';
import { useRequestHub } from '../../lib/requestHub';
import { pulseLine } from '../../lib/requestPulse';


type Tab = 'board' | 'mine' | 'offers';

const SORTS: [RequestSort, string][] = [
  ['new', 'الأحدث'],
  ['budget', 'أعلى ميزانية'],
  ['no_offers', 'بدون عروض'],
];

export default function RequestsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isReal = !!user && !(user as any).is_guest;

  const { pulse, markFeedSeen, openCompose } = useRequestHub();

  const [tab, setTab] = useState<Tab>('board');
  const [govAr, setGovAr] = useState('');           // '' = كل المحافظات
  const [mineToAnswer, setMineToAnswer] = useState(false);
  const [sort, setSort] = useState<RequestSort>('new');
  // row-reverse lays the first pill at the far RIGHT of the content, but a
  // horizontal ScrollView opens at offset 0 — the LEFT edge — so the rail
  // opened on «بدون عروض». Both callbacks, as elsewhere: onContentSizeChange
  // can fire before the scroller knows its own width.
  const sortRailRef = React.useRef<ScrollView>(null);

  const board = useQuery({
    queryKey: ['requests-board', govAr, mineToAnswer, sort],
    queryFn: () => PhoneRequests.board({
      governorate: govAr ? GOV_AR_TO_EN[govAr] : undefined,
      mineToAnswer: mineToAnswer || undefined,
      sort,
    }),
  });
  const mine = useQuery({ queryKey: ['requests-mine'], queryFn: () => PhoneRequests.mine(), enabled: isReal });
  const sent = useQuery({ queryKey: ['requests-sent'], queryFn: () => PhoneRequests.sentOffers(), enabled: isReal });

  // Coming back from a detail screen must not show a stale offer count.
  //
  // Opening the feed is also what clears the الطلبات badge — «يصفّر بعد ما
  // تفتح الفيد». Stamped on FOCUS rather than on mount so returning from a
  // request's detail page re-stamps it too; anything posted while the buyer
  // was reading one request has been seen by the time they come back to the
  // list that shows it.
  useFocusEffect(React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['requests-board'] });
    qc.invalidateQueries({ queryKey: ['requests-mine'] });
    qc.invalidateQueries({ queryKey: ['requests-sent'] });
    markFeedSeen();
  }, [qc, markFeedSeen]));

  const active = tab === 'board' ? board : tab === 'mine' ? mine : sent;

  // Offers waiting on the buyer's own OPEN requests. Closed ones are
  // excluded: a badge that keeps counting offers on a request the buyer
  // already fulfilled is a notification nobody can clear.
  const waitingOffers = useMemo(
    () => ((mine.data as PhoneRequest[] | undefined) || [])
      .filter((r) => r.status === 'open')
      .reduce((n, r) => n + (r.offer_count || 0), 0),
    [mine.data],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header
        title="الطلبات"
        // The subtitle is a MEASUREMENT, not a slogan. «اطلب الجهاز الذي
        // تبحث عنه» described the button; this describes whether opening the
        // screen was worth it, and it is the same number the tab's badge
        // counts up to — see lib/requestPulse.ts.
        eyebrow={pulseLine(pulse?.count_24h ?? 0, arOf((user as any)?.governorate) || '')}
        // No back button: this is the tab root now, not a page pushed from
        // the funnel.
        // A tinted tile, not a bare glyph. In the header a lone «+» has no
        // edge to aim at and reads as decoration; the tile gives it a body
        // and a 38pt target.
        right={(
          <TouchableOpacity
            onPress={() => openCompose()}
            accessibilityRole="button"
            accessibilityLabel="اطلب جهازاً"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 38, height: 38, borderRadius: radius.lg, backgroundColor: theme.accentSoft,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <IconPlus size={19} color={theme.accentDeep} sw={2.2} />
          </TouchableOpacity>
        )}
      />

      {/* One track, three segments — three separately-outlined buttons read
          as three independent choices rather than one control with a
          position. */}
      <View style={{
        flexDirection: 'row-reverse', marginHorizontal: 16, marginBottom: 10,
        padding: 3, borderRadius: radius.pill, backgroundColor: theme.chipBg,
      }}>
        {([['board', 'كل الطلبات'], ['mine', 'طلباتي'], ['offers', 'عروضي']] as [Tab, string][]).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => setTab(key)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            style={{
              flex: 1, paddingVertical: 8, borderRadius: radius.pill,
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 5,
              backgroundColor: tab === key ? theme.ink : 'transparent',
            }}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={FONT_SCALE_TIGHT}
              style={{
                fontFamily: tab === key ? fonts.arBold : fonts.ar, fontSize: 12.5,
                color: tab === key ? theme.accentInk : theme.subtle,
              }}
            >
              {label}
            </Text>
            {/* «طلباتي» says how many offers are waiting. The strip should
                tell a buyer which of the three tabs has something in it —
                otherwise finding out means visiting all three. */}
            {key === 'mine' && waitingOffers > 0 ? (
              <View style={{
                minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 999,
                backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center',
              }}>
                <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.ltrBold, fontSize: 9.5, color: '#fff' }}>
                  {waitingOffers > 99 ? '99+' : waitingOffers}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      {/* Board filters */}
      {tab === 'board' ? (
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          {/* Order the board. «بدون عروض» is the one that changes a seller's
              day: a request with five offers is a bidding war they probably
              lose, and one with none is a reply that wins outright. It was
              not reachable at all before — the board only ever sorted by
              recency. */}
          <ScrollView
            ref={sortRailRef}
            horizontal showsHorizontalScrollIndicator={false}
            onContentSizeChange={() => sortRailRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => sortRailRef.current?.scrollToEnd({ animated: false })}
            contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2, paddingBottom: 8 }}
          >
            {(SORTS).map(([key, label]) => (
              <Pill key={key} active={sort === key} onPress={() => setSort(key)}>{label}</Pill>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <GovPicker valueAr={govAr} onChangeAr={setGovAr} allowAll compact />
            </View>
            {isReal ? (
              <TouchableOpacity
                onPress={() => setMineToAnswer((v) => !v)}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
                  paddingHorizontal: 11, paddingVertical: 9, borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: mineToAnswer ? theme.accent : theme.line,
                  backgroundColor: mineToAnswer ? theme.accentSoft : theme.surface,
                }}
              >
                {mineToAnswer ? <IconCheck size={12} color={theme.accent} sw={2.4} /> : null}
                <Text style={{
                  fontFamily: mineToAnswer ? fonts.arBold : fonts.ar, fontSize: 12,
                  color: mineToAnswer ? theme.accent : theme.subtle,
                }}>
                  أقدر أجهزها
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {!isReal && tab !== 'board' ? (
        <SignedOut navigation={navigation} />
      ) : active.isLoading ? (
        <TextRowListSkeleton count={4} />
      ) : (
        <FlatList
          data={(active.data as any[]) || []}
          keyExtractor={(it: any) => String(it.id)}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 96 }}
          refreshing={active.isFetching}
          onRefresh={() => active.refetch()}
          renderItem={({ item }) => (tab === 'offers'
            ? <SentOfferRow offer={item as SentOffer} onPress={() => navigation.navigate('RequestDetail', { id: (item as SentOffer).request.id })} />
            : <RequestRow
                request={item as PhoneRequest}
                showOffers={tab === 'mine'}
                showAction={tab === 'board' && !(item as PhoneRequest).is_mine}
                onPress={() => navigation.navigate('RequestDetail', { id: item.id })}
              />
          )}
          ListEmptyComponent={<Empty tab={tab} onCompose={() => openCompose()} />}
        />
      )}

      {/* The sticky «اطلب جهازاً» bar is gone, and that is the point of the
          new tab row: «اطلب جهاز» sits in the bar directly below, always, on
          every screen. Two accent buttons stacked on top of each other doing
          the same thing was the cost of the old single-tab arrangement. The
          header's «+» tile stays for reach from the top of a long list, and
          the empty states still offer it in words. */}
    </View>
  );
}

// ─── rows ──────────────────────────────────────────────────────────────

/** «١٢» — counts written in prose are Arabic-Indic, matching the feed. */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n: number) => String(Math.max(0, Math.floor(n))).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

function RequestRow({ request, showOffers, showAction, onPress }: {
  request: PhoneRequest; showOffers?: boolean;
  /** The board's view. On «طلباتي» the reader IS the buyer — offering on
      your own request is not a thing, and the footer would name them to
      themselves. */
  showAction?: boolean;
  onPress: () => void;
}) {
  const closed = request.status !== 'open';
  const offers = request.offer_count || 0;
  const mark = bundledBrandLogo(request.brand);
  const deadline = timeLeftAr(request.expires_at);
  // my_offer is only present in a signed-in seller's view of the board.
  const answered = !!request.my_offer;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1,
      borderColor: offers > 0 && showOffers ? theme.accent : theme.line,
      ...shadowSoft, padding: 14, marginBottom: 10, opacity: closed ? 0.6 : 1,
    }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 }}>
        {/* The brand mark, not a generic request glyph. A seller skimming
            this board is deciding "do I stock that?" — the logo answers it
            before the words are read, and every row used to carry the same
            icon. */}
        <View style={{
          width: 40, height: 40, borderRadius: 13, backgroundColor: theme.chipBg,
          alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {mark ? (
            <Img source={mark} contentFit="contain" style={{ width: 24, height: 24 }} />
          ) : (
            <IconRequest size={19} color={theme.ink} sw={1.6} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 7 }}>
            <Text numberOfLines={1} style={{
              flexShrink: 1, fontFamily: fonts.arBold, fontSize: 14.5, color: theme.ink,
              textAlign: 'right', writingDirection: 'ltr',
            }}>
              {deviceTitle(request.brand, request.model)}
            </Text>
            {/* The offer count moves up beside the title. At the bottom of
                the card it was the last thing read; it is the first thing a
                seller wants to know, because it is the competition. */}
            <View style={{
              flexShrink: 0, flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
              backgroundColor: offers > 0 ? 'rgba(217,88,58,0.12)' : theme.inset,
            }}>
              <IconChat size={11} color={offers > 0 ? theme.accentDeep : theme.subtle} sw={1.7} />
              <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
                fontFamily: offers > 0 ? fonts.arBold : fonts.arRegular, fontSize: 11,
                color: offers > 0 ? theme.accentDeep : theme.subtle,
              }}>
                {offers > 0 ? `${arNum(offers)} عرض` : 'لا عروض'}
              </Text>
            </View>
          </View>
          {/* The budget is the number a seller decides on, so it is set like
              a price rather than folded into a grey summary line with the
              condition. */}
          <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
            <Text style={{ fontFamily: fonts.arRegular, fontSize: 11.5, color: theme.subtle }}>ميزانيته حتى</Text>
            <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 14, color: theme.accentDeep }}>
              {fmtIQD(request.max_price)}
            </Text>
            <Text style={{ fontFamily: fonts.arRegular, fontSize: 11, color: theme.subtle }}>د.ع</Text>
          </View>
        </View>
        {closed ? (
          <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: theme.chipBg }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 10.5, color: theme.subtle }}>
              {request.status === 'fulfilled' ? 'تم' : request.status === 'expired' ? 'منتهي' : 'مغلق'}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Condition and place as chips rather than a run-on grey line. The
          age moved to the footer, beside the person whose age it is. */}
      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        <MetaChip>{conditionLabel(request.condition)}</MetaChip>
        <MetaChip icon={<IconPin size={11} color={theme.subtle} sw={1.7} />}>{arOf(request.governorate)}</MetaChip>
        {/* The deadline, and ONLY when it is close — timeLeftAr returns null
            past its window. A request lives three weeks, so a countdown on
            every card would be a badge that has stopped meaning "hurry". */}
        {!closed && deadline ? (
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
            paddingHorizontal: 9, paddingVertical: 4,
            borderRadius: radius.pill, backgroundColor: theme.accentSoft,
          }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 11, color: theme.accentDeep }}>
              {deadline}
            </Text>
          </View>
        ) : null}
      </View>

      {request.note ? (
        <Text numberOfLines={2} style={{
          fontFamily: fonts.arRegular, fontSize: 12.5, color: theme.ink, textAlign: 'right',
          marginTop: 9, lineHeight: 20,
        }}>
          {request.note}
        </Text>
      ) : null}

      {/* Who is asking, and the one thing to do about it.
      
          A board of anonymous demand is a spreadsheet; a name and an initial
          make it a person a seller is answering. «قدّم عرض» is spelled out
          rather than left implicit in the card tap, because the previous card
          gave a seller no visible verb at all — the whole row was a link to
          a screen whose purpose you had to already know. */}
      {showAction ? (
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
          marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: theme.line,
        }}>
          <View style={{
            width: 26, height: 26, borderRadius: 999, backgroundColor: theme.chipBg,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle }}>
              {(request.buyer?.display_name || '؟').trim().charAt(0)}
            </Text>
          </View>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right' }}>
            {request.buyer?.display_name || 'مشتري'} · {timeAgoAr(request.created_at)}
          </Text>
          <View style={{
            flexShrink: 0, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 8,
            backgroundColor: answered ? theme.inset : theme.ink,
          }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
              fontFamily: fonts.arBold, fontSize: 12,
              color: answered ? theme.subtle : theme.buttonInk,
            }}>
              {answered ? 'عرضك مُرسل' : 'قدّم عرض'}
            </Text>
          </View>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function MetaChip({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
      paddingHorizontal: 9, paddingVertical: 4,
      borderRadius: radius.pill, backgroundColor: theme.inset,
    }}>
      {icon}
      <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle }}>
        {children}
      </Text>
    </View>
  );
}

function SentOfferRow({ offer, onPress }: { offer: SentOffer; onPress: () => void }) {
  const dead = offer.request.status !== 'open';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{
      backgroundColor: theme.surface, borderRadius: radius.xxl, borderWidth: 1, borderColor: theme.line,
      ...shadowSoft, padding: 14, marginBottom: 10, opacity: dead ? 0.6 : 1,
    }}>
      <Text numberOfLines={1} style={{
        fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right', writingDirection: 'ltr',
      }}>
        {deviceTitle(offer.request.brand, offer.request.model)}
      </Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 7 }}>
        <IconTag size={13} color={theme.accent} sw={1.8} />
        <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.accent }}>
          عرضك: {fmtIQD(offer.price)} د.ع
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle }}>
          {dead ? (offer.request.status === 'fulfilled' ? 'الطلب انتهى' : 'الطلب مغلق') : timeAgoAr(offer.created_at)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function Empty({ tab, onCompose }: { tab: Tab; onCompose: () => void }) {
  const copy = tab === 'board'
    ? { title: 'ما في طلبات مفتوحة', body: 'كن أول من ينشر طلباً — يراه البائعون ويردون عليك بعروضهم.' }
    : tab === 'mine'
      ? { title: 'ما عندك طلبات', body: 'انشر الجهاز الذي تبحث عنه وميزانيتك، ودع البائعين يأتون إليك.' }
      : { title: 'ما قدّمت أي عرض', body: 'افتح «كل الطلبات» واطّلع على المشترين الذين يبحثون عن أجهزة لديك.' };
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <IconRequest size={30} color={theme.subtle} sw={1.5} />
      <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, marginTop: 12, textAlign: 'center' }}>
        {copy.title}
      </Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
        {copy.body}
      </Text>
      {tab !== 'offers' ? (
        <View style={{ marginTop: 16 }}>
          <Btn kind="accent" onPress={onCompose}>اطلب جهازاً</Btn>
        </View>
      ) : null}
    </View>
  );
}

function SignedOut({ navigation }: any) {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.subtle, textAlign: 'center', lineHeight: 22, marginBottom: 16 }}>
        سجّل الدخول لتنشر طلبك — يراه البائعون ويرسلون إليك عروضهم مباشرة.
      </Text>
      <Btn kind="accent" onPress={() => navigation.getParent()?.getParent?.()?.navigate('AuthGate') ?? navigation.navigate('AuthGate')}>
        تسجيل الدخول
      </Btn>
    </View>
  );
}

// ─── compose ───────────────────────────────────────────────────────────
