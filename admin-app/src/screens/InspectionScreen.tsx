// الفحص — listings the automated inspector flagged.
//
// This is the one queue where the operator must SEE the thing before
// deciding, so the photos are the screen rather than a detail view behind a
// tap. The verdict and defects the inspector produced sit next to them, and
// the two outcomes are one tap each.

import React from 'react';
import { View, Text, FlatList, RefreshControl, Image, ScrollView, Alert, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd, deviceTitle } from '../theme';
import { api, API_BASE } from '../api/client';
import { ScreenHeader, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';

type Row = {
  id: number; listing_id: number; verdict: string; status: string;
  brand: string; model: string; asking_price: number; governorate: string;
  description: string | null; seller_name: string | null;
  defects: string[]; images: string[];
};

const W = Dimensions.get('window').width;

export default function InspectionScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['inspection'],
    queryFn: () => api<Row[]>('/admin/inspection/queue?status=pending'),
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'remove' }) =>
      api(`/admin/inspection/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspection'] });
      qc.invalidateQueries({ queryKey: ['work-queue'] });
    },
    onError: () => Alert.alert('تعذّر التحديث', 'لم يُنفَّذ القرار.'),
  });

  const rows = Array.isArray(data) ? data : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title="الفحص"
        subtitle={rows.length ? `${rows.length} بانتظار قرار` : undefined}
        onBack={() => navigation.goBack()}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: insets.bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError ? error : false}
            empty={!isLoading && !isError} emptyText="لا إعلانات بانتظار الفحص." onRetry={refetch} />
        }
        renderItem={({ item: r }) => (
          <Card>
            {/* Photos first. A verdict without the picture is a coin flip. */}
            {r.images?.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {r.images.slice(0, 6).map((path, i) => (
                  <Image
                    key={i}
                    source={{ uri: path.startsWith('http') ? path : `${API_BASE}${path}` }}
                    style={{
                      width: W * 0.42, height: W * 0.42, borderRadius: radius.lg,
                      marginLeft: 8, backgroundColor: theme.surfaceAlt,
                    }}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            ) : (
              <Meta>لا صور</Meta>
            )}

            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <View style={{
                paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill,
                backgroundColor: r.status === 'error' ? theme.warn : theme.danger,
              }}>
                <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#fff' }}>
                  {r.status === 'error' ? 'فشل الفحص' : r.verdict}
                </Text>
              </View>
              <Text style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: '700', color: theme.accent }}>
                {iqd(r.asking_price)} <Text style={{ fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
              </Text>
            </View>

            <View style={{ marginTop: 8 }}>
              <Title>{deviceTitle(r.brand, r.model)}</Title>
              <Meta>{r.governorate} · {r.seller_name || '—'} · إعلان #{r.listing_id}</Meta>
              {r.defects?.length ? (
                <Text style={{
                  fontFamily: fonts.ar, fontSize: 12.5, color: theme.warn,
                  textAlign: 'right', marginTop: 5, lineHeight: 19,
                }}>
                  {r.defects.join('، ')}
                </Text>
              ) : null}
              {r.description ? (
                <Text numberOfLines={3} style={{
                  fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
                  textAlign: 'right', marginTop: 5, lineHeight: 19,
                }}>
                  {r.description}
                </Text>
              ) : null}
            </View>

            <ActionRow>
              <Action
                label="موافقة"
                tone="ok"
                busy={decide.isPending}
                onPress={() => decide.mutate({ id: r.id, action: 'approve' })}
              />
              {/* Removal takes a live listing off the marketplace, so it asks. */}
              <Action
                label="حذف الإعلان"
                tone="danger"
                busy={decide.isPending}
                confirm={{ title: 'حذف الإعلان؟', body: deviceTitle(r.brand, r.model) }}
                onPress={() => decide.mutate({ id: r.id, action: 'remove' })}
              />
            </ActionRow>
          </Card>
        )}
      />
    </View>
  );
}
