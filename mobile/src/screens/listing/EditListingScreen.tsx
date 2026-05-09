import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { theme, fonts } from '../../theme';
import { Btn, FieldLabel, Header, Input } from '../../components/ui';
import { Listings } from '../../api/endpoints';
import { ar } from '../../i18n/ar';

export default function EditListingScreen({ route, navigation }: any) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [askingPrice, setAskingPrice] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Listings.get(id).then((l) => {
      setAskingPrice(String(l.asking_price));
      setDescription(l.description || '');
    });
  }, [id]);

  async function save() {
    setBusy(true);
    try {
      await Listings.patch(id, {
        asking_price: Number(askingPrice),
        description: description || null,
      });
      qc.invalidateQueries({ queryKey: ['listing', id] });
      qc.invalidateQueries({ queryKey: ['mine'] });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e.message] || e.message);
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={ar.listing.edit} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <FieldLabel>{ar.listing.asking} (د.ع)</FieldLabel>
        <Input value={askingPrice} onChangeText={setAskingPrice} numeric ltr />
        <FieldLabel style={{ marginTop: 14 }}>{ar.listing.description}</FieldLabel>
        <Input value={description} onChangeText={setDescription} multiline />
        <View style={{ marginTop: 20 }}>
          <Btn kind="primary" full onPress={save} busy={busy}>حفظ</Btn>
        </View>
      </ScrollView>
    </View>
  );
}
