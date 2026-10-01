// «انباع الجهاز؟» — the question the app asks three days after a listing's
// first contact, and the one optional follow-up.
//
// Reached from the notification's two buttons (the push category
// `sold_check`), from the inbox row, or from a listing of the seller's
// own. The answer is one tap: «انباع» closes the listing (and asks, once,
// what it went for — skippable), «بعده موجود» keeps it and says when the
// question comes back. The server decides the re-ask schedule.

import React from 'react';
import { View, Text, ScrollView, TextInput, Keyboard } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius, shadowSoft, FONT_SCALE_TIGHT } from '../../theme';
import { Btn, Header, fmtIQD } from '../../components/ui';
import { IconCheck, IconTag } from '../../components/icons';
import { LoadFailed } from '../../components/LoadFailed';
import { Listings, type SoldCheckState } from '../../api/endpoints';
import { parsePrice } from '../../lib/format';
import { useTrack } from '../../analytics/track';

type Answer = 'sold' | 'still';

export default function SoldCheckScreen({ route, navigation }: any) {
  const id = Number(route.params?.id);
  // From a notification button: the answer is already given.
  const preset: Answer | undefined = route.params?.answer === 'sold' || route.params?.answer === 'still'
    ? route.params.answer : undefined;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const track = useTrack();

  const q = useQuery({
    queryKey: ['sold-check', id],
    queryFn: () => Listings.soldCheck(id),
    enabled: Number.isFinite(id) && id > 0,
  });
  const device = q.data?.listing.device || '';

  // sold → ask the price; still → send at once.
  const [stage, setStage] = React.useState<'ask' | 'price' | 'done'>(preset === 'sold' ? 'price' : 'ask');
  const [price, setPrice] = React.useState('');
  const [result, setResult] = React.useState<Answer | null>(null);

  const answer = useMutation({
    mutationFn: (body: { answer: Answer; sale_price?: number | null }) => Listings.answerSoldCheck(id, body),
    onSuccess: (_d, body) => {
      setResult(body.answer);
      setStage('done');
      qc.invalidateQueries({ queryKey: ['mine'] });
      qc.invalidateQueries({ queryKey: ['listing', id] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      track('listing.sold_check_answered', { listing_id: id, answer: body.answer, with_price: body.sale_price != null });
    },
  });
  const sentPreset = React.useRef(false);
  React.useEffect(() => {
    if (preset === 'still' && !sentPreset.current && id) {
      sentPreset.current = true;
      answer.mutate({ answer: 'still' });
    }
  }, [preset, id, answer]);

  const closed = q.data?.listing.status === 'sold';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title="انباع الجهاز؟" onBack={() => navigation.goBack()} />
      {q.error && !q.data ? (
        <LoadFailed error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: 12, paddingBottom: 40, gap: 14 }}>
          {/* The device, so a seller with three ads answers about the right one. */}
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            borderRadius: radius.xxl, padding: 14, ...shadowSoft,
          }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.lg, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <IconTag size={18} color={theme.accentDeep} sw={1.8} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right', writingDirection: 'ltr' }}>
                {device || '…'}
              </Text>
              {q.data ? (
                <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 3 }}>
                  معروض بـ {fmtIQD(Number(q.data.listing.asking_price))} د.ع
                </Text>
              ) : null}
            </View>
          </View>

          {stage === 'done' || (closed && stage !== 'price') ? (
            <Done
              answer={result || (closed ? 'sold' : 'still')}
              onMine={() => navigation.navigate('MyListings')}
              onPost={() => navigation.navigate('Main', { screen: 'Sell' })}
            />
          ) : stage === 'price' ? (
            <View style={{ gap: 12 }}>
              <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, textAlign: 'right' }}>
                بيش بعته؟ <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}>(اختياري)</Text>
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, lineHeight: 20, color: theme.subtle, textAlign: 'right' }}>
                يساعدنا نعرف أسعار السوق الحقيقية. ما يظهر لأحد.
              </Text>
              <View style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
                borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 4,
              }}>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="number-pad"
                  placeholder={String(q.data?.listing.asking_price || '')}
                  placeholderTextColor={theme.subtle}
                  style={{ flex: 1, fontFamily: fonts.ltrBold, fontSize: 18, color: theme.ink, textAlign: 'right', paddingVertical: 10 }}
                  autoFocus
                />
                <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle }}>د.ع</Text>
              </View>
              <Btn
                kind="accent" full busy={answer.isPending}
                onPress={() => { Keyboard.dismiss(); answer.mutate({ answer: 'sold', sale_price: parsePrice(price) || null }); }}
              >
                تم — انباع
              </Btn>
              <Btn kind="ghost" full disabled={answer.isPending} onPress={() => answer.mutate({ answer: 'sold', sale_price: null })}>
                تخطّي السعر
              </Btn>
              {answer.error ? <ErrLine /> : null}
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={{ fontFamily: fonts.ar, fontSize: 13.5, lineHeight: 22, color: theme.ink, textAlign: 'right' }}>
                مرّت ثلاثة أيام على أول تواصل. إذا انباع نغلق الإعلان ويرتاح المشترون من السؤال؛ وإذا بعده موجود نخليه كما هو.
              </Text>
              <Btn kind="accent" full onPress={() => setStage('price')}>انباع</Btn>
              <Btn kind="ghost" full busy={answer.isPending} onPress={() => answer.mutate({ answer: 'still' })}>بعده موجود</Btn>
              {answer.error ? <ErrLine /> : null}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Done({ answer, onMine, onPost }: { answer: Answer; onMine: () => void; onPost: () => void }) {
  const sold = answer === 'sold';
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingTop: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: sold ? theme.success : theme.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <IconCheck size={26} color={sold ? '#fff' : theme.accentDeep} sw={2.4} />
      </View>
      <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 19, color: theme.ink, textAlign: 'center' }}>
        {sold ? 'مبروك البيعة' : 'تمام، بعده موجود'}
      </Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13, lineHeight: 21, color: theme.subtle, textAlign: 'center' }}>
        {sold ? 'أُغلق الإعلان وما راح يوصلك سؤال عنه بعد.' : 'نسألك مرة ثانية بعد أسبوع إذا بقي معروضاً.'}
      </Text>
      <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 8 }}>
        {sold ? <Btn kind="accent" full onPress={onPost}>انشر جهازاً آخر</Btn> : null}
        <Btn kind="ghost" full onPress={onMine}>إعلاناتي</Btn>
      </View>
    </View>
  );
}

function ErrLine() {
  return (
    <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.danger, textAlign: 'center' }}>
      ما وصل الجواب — جرّب مرة ثانية.
    </Text>
  );
}
