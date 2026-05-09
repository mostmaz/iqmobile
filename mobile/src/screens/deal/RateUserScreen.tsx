import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts } from '../../theme';
import { Btn, FieldLabel, Header, Input } from '../../components/ui';
import { IconStar } from '../../components/icons';
import { Deals } from '../../api/endpoints';
import { ar } from '../../i18n/ar';

export default function RateUserScreen({ route, navigation }: any) {
  const { dealId } = route.params;
  const insets = useSafeAreaInsets();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await Deals.rate(dealId, stars, comment || undefined);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message);
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
