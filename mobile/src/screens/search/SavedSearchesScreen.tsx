// "My saved searches" — the user's list of stored browse/search criteria.
// Each row shows a human summary, an alerts (bell) toggle, and a delete.
// A saved search with alerts on pushes a notification when a new listing
// matches (see server/src/routes/savedSearches.js).

import React from 'react';
import { View, Text, FlatList, TouchableOpacity, Switch, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius } from '../../theme';
import { Header, fmtIQD } from '../../components/ui';
import { IconBell, IconClose } from '../../components/icons';
import { TextRowListSkeleton } from '../../components/Skeleton';
import { SavedSearches, type SavedSearch, type SavedSearchCriteria } from '../../api/endpoints';
import { arOf } from '../../lib/governorates';
import { ar } from '../../i18n/ar';

// Turn a stored criteria object into a short Arabic sentence for the row.
// Mirrors the fields the browse/search UIs let the user narrow on.
export function describeCriteria(c: SavedSearchCriteria): string {
  const parts: string[] = [];
  if (c.q) parts.push(`"${c.q}"`);
  if (c.brand) parts.push(c.brand);
  if (c.model) parts.push(c.model);
  if (c.condition) parts.push((ar.listing as any)[c.condition] || c.condition);
  if (c.governorate) parts.push(arOf(c.governorate));
  if (c.min_price != null && c.max_price != null) parts.push(`${fmtIQD(c.min_price)}–${fmtIQD(c.max_price)} د.ع`);
  else if (c.min_price != null) parts.push(`من ${fmtIQD(c.min_price)} د.ع`);
  else if (c.max_price != null) parts.push(`حتى ${fmtIQD(c.max_price)} د.ع`);
  return parts.length ? parts.join(' · ') : 'كل الإعلانات';
}

export default function SavedSearchesScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: () => SavedSearches.list(),
  });

  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => SavedSearches.setAlerts(id, on),
    // Optimistic: flip the switch immediately, roll back on error.
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: ['saved-searches'] });
      const prev = qc.getQueryData<SavedSearch[]>(['saved-searches']);
      qc.setQueryData<SavedSearch[]>(['saved-searches'], (rows) =>
        (rows || []).map((r) => (r.id === id ? { ...r, alerts_enabled: on } : r)));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['saved-searches'], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['saved-searches'] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => SavedSearches.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-searches'] }),
  });

  function confirmDelete(item: SavedSearch) {
    Alert.alert('حذف البحث المحفوظ', describeCriteria(item.criteria), [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => remove.mutate(item.id) },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Header title="عمليات البحث المحفوظة" onBack={() => navigation.goBack()} />
      {isLoading ? (
        <TextRowListSkeleton count={4} />
      ) : (
        <FlatList
          data={data || []}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshing={isLoading}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
              padding: 14, marginBottom: 10, borderRadius: radius.lg,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, fontWeight: '600', textAlign: 'right' }}>
                  {item.label || describeCriteria(item.criteria)}
                </Text>
                {item.label ? (
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, marginTop: 3, textAlign: 'right' }}>
                    {describeCriteria(item.criteria)}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <IconBell size={13} color={item.alerts_enabled ? theme.accent : theme.subtle} sw={1.7} />
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: item.alerts_enabled ? theme.accent : theme.subtle }}>
                    {item.alerts_enabled ? 'التنبيهات مُفعّلة' : 'التنبيهات متوقّفة'}
                  </Text>
                  <Switch
                    value={item.alerts_enabled}
                    onValueChange={(on) => toggle.mutate({ id: item.id, on })}
                    trackColor={{ true: theme.accent, false: theme.line }}
                    thumbColor="#fff"
                    style={{ transform: [{ scale: 0.85 }] }}
                  />
                </View>
              </View>
              <TouchableOpacity onPress={() => confirmDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ padding: 4 }}>
                <IconClose size={16} color={theme.subtle} sw={1.7} />
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View style={{ padding: 40, alignItems: 'center' }}>
              <IconBell size={30} color={theme.subtle} sw={1.5} />
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, marginTop: 12, textAlign: 'center' }}>
                لا توجد عمليات بحث محفوظة
              </Text>
              <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
                احفظ بحثاً من صفحة التصفّح أو البحث لتصلك تنبيهات عند إضافة إعلان مطابق.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
