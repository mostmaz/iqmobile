import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { theme, fonts } from '../../theme';
import { Btn, FieldLabel, Header, Input } from '../../components/ui';
import { Listings } from '../../api/endpoints';
import { ar } from '../../i18n/ar';
import { parsePrice } from '../../lib/format';

export default function EditListingScreen({ route, navigation }: any) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [askingPrice, setAskingPrice] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  // Fetch the listing on mount with proper error handling. Without this,
  // a 404 (deleted listing) or network failure left the form blank forever
  // with no way for the user to recover other than backing out.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Listings.get(id)
      .then((l) => {
        if (!alive) return;
        setAskingPrice(String(l.asking_price));
        setDescription(l.description || '');
        setLoadErr('');
      })
      .catch((e: any) => {
        if (!alive) return;
        setLoadErr((ar.errors as any)[e?.message] || (ar.errors as any).network);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  async function save() {
    // Client-side price validation: empty / non-positive / non-numeric
    // input was silently shipped as `Number('')` = 0 to the server. We
    // now reject before the request goes out so the user sees a clear
    // Arabic error instead of a confusing 400 from the API.
    const price = parsePrice(askingPrice);
    if (price == null) {
      Alert.alert('خطأ', (ar.errors as any).bad_price);
      return;
    }
    setBusy(true);
    try {
      await Listings.patch(id, {
        asking_price: price,
        description: description || null,
      });
      qc.invalidateQueries({ queryKey: ['listing', id] });
      qc.invalidateQueries({ queryKey: ['mine'] });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('خطأ', (ar.errors as any)[e?.message] || (ar.errors as any).network);
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Header title={ar.listing.edit} onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </View>
    );
  }

  if (loadErr) {
    // Surface the load failure with an explicit retry button. Previously
    // a load error left the form blank and the user could submit a zero-
    // price update against a possibly-deleted listing.
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Header title={ar.listing.edit} onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.danger, textAlign: 'center' }}>
            {loadErr}
          </Text>
          <Btn kind="ghost" onPress={() => navigation.goBack()}>رجوع</Btn>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={ar.listing.edit} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <FieldLabel>{ar.listing.asking} (د.ع)</FieldLabel>
        <Input value={askingPrice} onChangeText={setAskingPrice} numeric ltr />
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
              <Text style={{ fontFamily: fonts.arBold, fontSize: 12, fontWeight: '700', color: '#fff' }}>نعم</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        <FieldLabel style={{ marginTop: 14 }}>{ar.listing.description}</FieldLabel>
        <Input value={description} onChangeText={setDescription} multiline />
        <View style={{ marginTop: 20 }}>
          <Btn kind="primary" full onPress={save} busy={busy}>حفظ</Btn>
        </View>
      </ScrollView>
    </View>
  );
}
