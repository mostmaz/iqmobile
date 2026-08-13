// Reports and device suggestions.
//
// Two queues, one screen. They are different data but the same job — read a
// short thing, then approve or dismiss it — and on a phone that is one
// screen with a switch, not two entries buried in a menu.

import React, { useState } from 'react';
import { View, Text, FlatList, RefreshControl, Alert, Image, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd, deviceTitle } from '../theme';
import { api, API_BASE } from '../api/client';
import { ScreenHeader, ChipRow, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';
import { PickerSheet } from '../components/editor';

type Report = {
  id: number; listing_id: number | null; reason: string; note: string | null;
  reporter_name: string | null; reporter_phone: string | null; created_at: number;
};
type Suggestion = {
  id: number; brand: string; model: string; device_type: string;
  user_name: string | null; user_phone: string | null; created_at: number;
  listing_id: number | null;
  listing_brand: string | null; listing_model: string | null;
  listing_price: number | null; listing_status: string | null;
  listing_cover: string | null;
};

const TABS = [
  { key: 'reports', label: 'البلاغات' },
  { key: 'devices', label: 'أجهزة مقترحة' },
] as const;

export default function ModerationScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'reports' | 'devices'>(route?.params?.tab || 'reports');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-reports'] });
    qc.invalidateQueries({ queryKey: ['admin-suggestions'] });
    qc.invalidateQueries({ queryKey: ['work-queue'] });
  };

  const reports = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => api<Report[]>('/admin/reports?status=open'),
    enabled: tab === 'reports',
  });
  const suggestions = useQuery({
    queryKey: ['admin-suggestions'],
    queryFn: () => api<Suggestion[]>('/admin/device-suggestions?status=pending'),
    enabled: tab === 'devices',
  });

  const resolveReport = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر التحديث', 'لم يتم تحديث البلاغ.'),
  });

  const decideDevice = useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: 'approve' | 'reject'; body?: any }) =>
      api(`/admin/device-suggestions/${id}/${action}`, {
        method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    onSuccess: () => { invalidate(); setFixing(null); },
    onError: () => Alert.alert('تعذّر التحديث', 'لم يتم تنفيذ القرار.'),
  });

  // The other way out of a suggestion: the NAME was wrong, not the
  // catalogue. Re-file the listing under a real brand+device, then reject
  // the suggestion — two calls, and the order matters: if the reject
  // fails, the suggestion stays pending, which is recoverable; a rejected
  // suggestion with an unfixed listing is not.
  const fixListing = useMutation({
    mutationFn: async ({ sug, brand, model }: { sug: Suggestion; brand: string; model: string }) => {
      await api(`/admin/listings/${sug.listing_id}`, {
        method: 'PATCH', body: JSON.stringify({ brand, model }),
      });
      await api(`/admin/device-suggestions/${sug.id}/reject`, { method: 'POST' });
    },
    onSuccess: () => { invalidate(); setFixing(null); },
    onError: () => Alert.alert('تعذّر التعديل', 'لم يتم تعديل الإعلان.'),
  });

  // Correction panel state: which suggestion is open, and its draft values.
  const [fixing, setFixing] = useState<number | null>(null);
  const [fixBrand, setFixBrand] = useState('');
  const [fixModel, setFixModel] = useState('');
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);

  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api<{ name: string }[]>('/brands'),
    staleTime: 10 * 60 * 1000,
    enabled: tab === 'devices',
  });

  function openFix(item: Suggestion) {
    setFixing(item.id);
    setFixBrand(item.brand || '');
    setFixModel(item.model || '');
  }

  const active = tab === 'reports' ? reports : suggestions;
  const rows: any[] = (active.data as any[]) || [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader title="الإشراف" onBack={() => navigation.goBack()} />
      <ChipRow options={TABS as any} value={tab} onChange={setTab as any} />

      <FlatList
        data={rows}
        keyExtractor={(r) => `${tab}-${r.id}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={
          <RefreshControl refreshing={active.isRefetching} onRefresh={active.refetch} tintColor={theme.subtle} />
        }
        ListEmptyComponent={
          <ListState
            loading={active.isLoading}
            error={active.isError ? active.error : false}
            empty={!active.isLoading && !active.isError}
            emptyText={tab === 'reports' ? 'لا بلاغات مفتوحة.' : 'لا أجهزة مقترحة.'}
            onRetry={active.refetch}
          />
        }
        renderItem={({ item }) =>
          tab === 'reports' ? (
            <Card>
              <Title>{item.reason || 'بلاغ'}</Title>
              {item.note ? <Meta>{item.note}</Meta> : null}
              <Meta>
                {item.listing_id ? `إعلان #${item.listing_id} · ` : ''}
                من {item.reporter_name || '—'}{item.reporter_phone ? ` · ${item.reporter_phone}` : ''}
              </Meta>
              <ActionRow>
                <Action
                  label="تمت المراجعة"
                  tone="primary"
                  busy={resolveReport.isPending}
                  onPress={() => resolveReport.mutate({ id: item.id, status: 'reviewed' })}
                />
                <Action
                  label="تجاهل"
                  busy={resolveReport.isPending}
                  onPress={() => resolveReport.mutate({ id: item.id, status: 'dismissed' })}
                />
              </ActionRow>
            </Card>
          ) : (
            <Card>
              <Title>{deviceTitle(item.brand, item.model)}</Title>
              <Meta>{item.device_type === 'tablet' ? 'جهاز لوحي' : item.device_type === 'accessory' ? 'إكسسوار' : 'هاتف'}</Meta>
              <Meta>اقترحه {item.user_name || '—'}{item.user_phone ? ` · ${item.user_phone}` : ''}</Meta>

              {/* The ad behind the suggestion — the reviewer's real
                  question is "what is this actually selling". */}
              {item.listing_id ? (
                <View style={{
                  flexDirection: 'row-reverse', gap: 10, alignItems: 'center',
                  marginTop: 8, padding: 8, borderRadius: radius.md,
                  backgroundColor: theme.surfaceAlt,
                }}>
                  {item.listing_cover ? (
                    <Image
                      source={{ uri: item.listing_cover.startsWith('http') ? item.listing_cover : `${API_BASE}${item.listing_cover}` }}
                      style={{ width: 44, height: 44, borderRadius: 6 }}
                    />
                  ) : null}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink, textAlign: 'right' }}>
                      إعلان #{item.listing_id} · {deviceTitle(item.listing_brand || '', item.listing_model || '')}
                    </Text>
                    <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                      {item.listing_price ? `${iqd(item.listing_price)} د.ع` : ''}{item.listing_status ? ` · ${item.listing_status}` : ''}
                    </Text>
                  </View>
                </View>
              ) : null}

              {fixing === item.id ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginBottom: 6 }}>
                    الماركة
                  </Text>
                  <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {(brands.data || []).map((b) => (
                      <TouchableOpacity
                        key={b.name}
                        onPress={() => setFixBrand(b.name)}
                        style={{
                          paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
                          backgroundColor: fixBrand === b.name ? theme.accent : theme.surface,
                          borderWidth: 1, borderColor: fixBrand === b.name ? theme.accent : theme.line,
                        }}
                      >
                        <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: fixBrand === b.name ? '#fff' : theme.subtle }}>
                          {b.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle, textAlign: 'right', marginBottom: 6 }}>
                    الجهاز
                  </Text>
                  <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                    <TextInput
                      value={fixModel}
                      onChangeText={setFixModel}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="اسم الجهاز…"
                      placeholderTextColor={theme.faint}
                      style={{
                        flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg,
                        borderWidth: 1, borderColor: theme.line,
                        paddingHorizontal: 12, paddingVertical: 10,
                        fontSize: 13.5, color: theme.ink, textAlign: 'right',
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => setDevicePickerOpen(true)}
                      style={{
                        paddingHorizontal: 13, borderRadius: radius.lg, justifyContent: 'center',
                        backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.line,
                      }}
                    >
                      <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: theme.accent }}>اختر</Text>
                    </TouchableOpacity>
                  </View>
                  <PickerSheet
                    visible={devicePickerOpen}
                    title="اختر الجهاز من الكتالوج"
                    load={async (query) => {
                      if (!fixBrand) return [];
                      const rows2 = await api<{ id: number; model: string }[]>(
                        `/device-catalog/devices?${new URLSearchParams({
                          brand: fixBrand, type: item.device_type || 'phone',
                          ...(query.trim() ? { q: query.trim() } : {}), limit: '60',
                        })}`,
                      );
                      return rows2.map((r) => ({ value: r.model }));
                    }}
                    onPick={(v) => { setFixModel(v); setDevicePickerOpen(false); }}
                    onClose={() => setDevicePickerOpen(false)}
                  />
                  <ActionRow>
                    <Action
                      label="إضافة للكتالوج بهذا الاسم"
                      tone="primary"
                      busy={decideDevice.isPending}
                      confirm={{ title: 'إضافة للكتالوج؟', body: `${fixBrand} ${fixModel}` }}
                      onPress={() => decideDevice.mutate({
                        id: item.id, action: 'approve',
                        body: { brand: fixBrand, model: fixModel },
                      })}
                    />
                    {item.listing_id ? (
                      <Action
                        label="تعديل الإعلان بهذا الجهاز"
                        busy={fixListing.isPending}
                        confirm={{
                          title: 'تعديل الإعلان؟',
                          body: `الإعلان #${item.listing_id} يصبح ${fixBrand} ${fixModel}، ويُرفض الاقتراح.`,
                        }}
                        onPress={() => fixListing.mutate({ sug: item, brand: fixBrand, model: fixModel })}
                      />
                    ) : null}
                    <Action label="إغلاق" onPress={() => setFixing(null)} />
                  </ActionRow>
                </View>
              ) : (
                <ActionRow>
                  {/* Approving writes a row into the live catalogue that every
                      seller then picks from, so it asks first. */}
                  <Action
                    label="إضافة للكتالوج"
                    tone="primary"
                    busy={decideDevice.isPending}
                    confirm={{ title: 'إضافة للكتالوج؟', body: `${item.brand} ${item.model}` }}
                    onPress={() => decideDevice.mutate({ id: item.id, action: 'approve' })}
                  />
                  <Action
                    label="تصحيح"
                    onPress={() => openFix(item)}
                  />
                  <Action
                    label="رفض"
                    tone="danger"
                    busy={decideDevice.isPending}
                    onPress={() => decideDevice.mutate({ id: item.id, action: 'reject' })}
                  />
                </ActionRow>
              )}
            </Card>
          )
        }
      />
    </View>
  );
}
