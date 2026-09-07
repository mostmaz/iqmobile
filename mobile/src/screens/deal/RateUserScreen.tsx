import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts } from '../../theme';
import { Btn, FieldLabel, Header, Input } from '../../components/ui';
import { IconStar } from '../../components/icons';
import { Deals } from '../../api/endpoints';
import { ar } from '../../i18n/ar';

export default function RateUserScreen({ route, navigation }: any) {
  // route.params can be undefined on deep-link / restored stack — a bare
  // `const { dealId } = route.params` throws at module evaluation in
  // those edge cases. Optional-chain, then bounce out cleanly.
  const dealId = route?.params?.dealId;
  const insets = useSafeAreaInsets();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  // No deal id = nothing to rate; leave on the next tick rather than during
  // render, which would trip "cannot update component during render".
  //
  // The hook is OUTSIDE the `if` and guards internally. It used to sit inside
  // it, which is a conditional hook: the render with no dealId called one more
  // hook than the render with one, and React aborts on that mismatch with
  // "Rendered more hooks than during the previous render". Same defect that
  // crashed 0.4.0 on the listing page — found by the new lint rule, not by us.
  React.useEffect(() => {
    if (!dealId) navigation.goBack();
  }, [dealId, navigation]);

  if (!dealId) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }

  async function submit() {
    // Defensive — stars come from setStars which only accepts 1..5 from
    // the IconStar buttons, but make sure no path can ship 0/6+.
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      Alert.alert('خطأ', (ar.errors as any).bad_stars);
      return;
    }
    setBusy(true);
    try {
      await Deals.rate(dealId, stars, comment || undefined);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={ar.rate.title} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 30 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <TouchableOpacity key={n} onPress={() => setStars(n)}>
              <IconStar size={44} filled={n <= stars} color={n <= stars ? theme.accent : theme.line} />
            </TouchableOpacity>
          ))}
        </View>
        <FieldLabel>{ar.rate.leaveComment}</FieldLabel>
        <Input value={comment} onChangeText={setComment} multiline placeholder="ملاحظتك حول التجربة…" />
        <View style={{ marginTop: 24 }}>
          <Btn kind="primary" full onPress={submit} busy={busy}>{ar.rate.submit}</Btn>
        </View>
      </ScrollView>
    </View>
  );
}
