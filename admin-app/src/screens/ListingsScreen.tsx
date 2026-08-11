// Listings — moderate, reprice, remove.
//
// The three things that actually get done from a phone: fix a price someone
// fat-fingered, take a listing down, and mark one sold/reserved. Editing the
// full record (photos, description, specs) stays on the desktop, where there
// is room to see what you are changing.

import React, { useState } from 'react';
import { View, Text, FlatList, RefreshControl, Modal, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, SearchBar, ChipRow, Card, Action, ActionRow, ListState, Meta, Title } from '../components/kit';

type Listing = {
  id: number; brand: string; model: string; asking_price: number;
  status: string; governorate: string; city: string | null;
  storage: string | null; color: string | null;
  seller_name?: string | null; contact_phone?: string | null;
  created_at: number;
};

const STATUS_AR: Record<string, string> = {
  active: 'نشط', reserved: 'محجوز', sold: 'مباع', expired: 'منتهي', removed: 'محذوف',
};

const FILTERS = [
  { key: 'active', label: 'نشط' },
  { key: 'reserved', label: 'محجوز' },
  { key: 'sold', label: 'مباع' },
  { key: '', label: 'الكل' },
] as const;

export default function ListingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('active');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Listing | null>(null);

  const { data, isLoading, isRefetching, refetch, isError } = useQuery({
    queryKey: ['admin-listings', status, q],
    // GET /admin/listings answers with a BARE ARRAY, not {listings}. Guessing
    // the wrapper cost a screen that rendered perfectly and always said "no
    // matching listings" — the worst kind of wrong, because nothing errors.
    queryFn: () => api<Listing[]>(
      `/admin/listings?${new URLSearchParams({
        ...(status ? { status } : {}),
        ...(q.trim() ? { q: q.trim() } : {}),
        limit: '50',
      })}`,
    ),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-listings'] });
    qc.invalidateQueries({ queryKey: ['work-queue'] });
  };

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      api(`/admin/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر الحفظ', 'لم يتم تطبيق التغيير.'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/admin/listings/${id}/remove`, { method: 'PATCH' }),
    onSuccess: invalidate,
    onError: () => Alert.alert('تعذّر الحذف', 'لم يتم حذف الإعلان.'),
  });

  const rows = Array.isArray(data) ? data : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title="الإعلانات"
        subtitle={rows.length ? `${rows.length} إعلان` : undefined}
        onBack={() => navigation.goBack()}
      />
      <SearchBar value={q} onChangeText={setQ} placeholder="ابحث بالموديل أو الرقم…" />
      <ChipRow options={FILTERS as any} value={status} onChange={setStatus} />

      <FlatList
        data={rows}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState
            loading={isLoading}
            error={isError}
            empty={!isLoading && !isError}
            emptyText="لا إعلانات مطابقة."
            onRetry={refetch}
          />
        }
        renderItem={({ item: l }) => (
          <Card>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <View style={{
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
                backgroundColor: l.status === 'active' ? theme.ok : theme.surfaceAlt,
              }}>
                <Text style={{ fontSize: 10.5, fontWeight: '700', color: l.status === 'active' ? '#fff' : theme.subtle }}>
                  {STATUS_AR[l.status] || l.status}
                </Text>
              </View>
              <Text style={{ flex: 1, textAlign: 'left', fontSize: 14.5, fontWeight: '700', color: theme.accent }}>
                {iqd(l.asking_price)} <Text style={{ fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
              </Text>
            </View>

            <View style={{ marginTop: 8 }}>
              <Title>{l.brand} {l.model}</Title>
              <Meta>
                {[l.storage, l.color, l.governorate, l.city].filter(Boolean).join(' · ')}
              </Meta>
              <Meta>#{l.id}{l.contact_phone ? ` · ${l.contact_phone}` : ''}</Meta>
            </View>

            <ActionRow>
              <Action label="السعر" tone="primary" onPress={() => setEditing(l)} busy={patch.isPending} />
              {l.status !== 'sold' ? (
                <Action
                  label="مباع"
                  onPress={() => patch.mutate({ id: l.id, body: { status: 'sold' } })}
                  busy={patch.isPending}
                />
              ) : (
                <Action
                  label="تفعيل"
                  onPress={() => patch.mutate({ id: l.id, body: { status: 'active' } })}
                  busy={patch.isPending}
                />
              )}
              <Action
                label="حذف"
                tone="danger"
                busy={remove.isPending}
                confirm={{ title: 'حذف الإعلان؟', body: `${l.brand} ${l.model} — لا يمكن التراجع.` }}
                onPress={() => remove.mutate(l.id)}
              />
            </ActionRow>
          </Card>
        )}
      />

      <PriceEditor
        listing={editing}
        busy={patch.isPending}
        onClose={() => setEditing(null)}
        onSave={(price) => {
          if (editing) patch.mutate({ id: editing.id, body: { asking_price: price } });
          setEditing(null);
        }}
      />
    </View>
  );
}

function PriceEditor({ listing, busy, onClose, onSave }: {
  listing: Listing | null; busy: boolean; onClose: () => void; onSave: (price: number) => void;
}) {
  const [v, setV] = useState('');
  React.useEffect(() => { setV(listing ? String(listing.asking_price) : ''); }, [listing?.id]);
  const n = Number(String(v).replace(/\D/g, ''));
  const valid = Number.isFinite(n) && n > 0;

  return (
    <Modal visible={!!listing} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 28 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: radius.xl, padding: 20 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'right' }}>
            تعديل السعر
          </Text>
          <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginTop: 4 }}>
            {listing?.brand} {listing?.model}
          </Text>
          <TextInput
            value={v ? Number(String(v).replace(/\D/g, '')).toLocaleString('en-US') : ''}
            onChangeText={(t) => setV(t.replace(/\D/g, ''))}
            keyboardType="phone-pad"
            autoFocus
            style={{
              marginTop: 14, backgroundColor: theme.bg, borderRadius: radius.lg,
              borderWidth: 1, borderColor: theme.line,
              paddingHorizontal: 14, paddingVertical: 14,
              fontSize: 20, fontWeight: '700', color: theme.ink, textAlign: 'center',
            }}
          />
          <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 16 }}>
            <TouchableOpacity
              disabled={!valid || busy}
              onPress={() => onSave(n)}
              style={{
                flex: 1, paddingVertical: 13, borderRadius: radius.lg,
                backgroundColor: theme.accent, alignItems: 'center', opacity: valid && !busy ? 1 : 0.45,
              }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: '#fff' }}>حفظ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onClose}
              style={{
                flex: 1, paddingVertical: 13, borderRadius: radius.lg,
                borderWidth: 1.5, borderColor: theme.line, alignItems: 'center',
              }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.subtle }}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
