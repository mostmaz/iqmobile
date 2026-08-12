// The whole store section: stock, fulfilment, customers, performance.
//
// Four dashboard pages behind one switch. On a desktop they are separate nav
// entries because there is room; on a phone, four taps to compare "what did we
// sell" against "what is left" is worse than one row of tabs — they are the
// same job seen from four angles.

import React, { useState } from 'react';
import { View, Text, FlatList, ScrollView, RefreshControl, Modal, TextInput, TouchableOpacity, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { theme, fonts, radius, iqd, deviceTitle } from '../theme';
import { api } from '../api/client';
import { ScreenHeader, ChipRow, Card, Action, ActionRow, ListState, Meta, Title, SearchBar } from '../components/kit';

type Shop = { id: number; shop_name: string | null; display_name: string; shop_orders_enabled: number };
type Item = {
  id: number; brand: string; model: string; asking_price: number;
  stock_qty: number | null; cost_price: number | null; status: string;
  storage: string | null; color: string | null;
};
type Order = {
  id: number; code: string; status: string; customer_name: string; customer_phone: string;
  governorate: string; address: string; total: number;
  courier?: string | null; tracking_note?: string | null; delivery_cost?: number | null;
};
// Field names copied from the SELECT in admin/store.js, not guessed —
// `delivered_value` and `last_order_at` are easy to misremember as `spent`
// and `last_at`, and a wrong key renders a silent zero rather than an error.
type Customer = {
  phone: string; name: string | null; governorate: string | null;
  orders: number; delivered: number; cancelled: number; returned: number; open: number;
  delivered_value: number; last_order_at: number; first_order_at: number;
};

const TABS = [
  { key: 'stock', label: 'المخزون' },
  { key: 'fulfil', label: 'التجهيز' },
  { key: 'customers', label: 'الزبائن' },
  { key: 'stats', label: 'الأداء' },
] as const;
type Tab = typeof TABS[number]['key'];

export default function StoreScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('stock');

  // Every tab is scoped to one storefront, so the shop is resolved once here
  // rather than four times.
  const shops = useQuery({
    queryKey: ['admin-storefronts'],
    queryFn: async () => (await api<Shop[]>('/admin/shops')).filter((s) => s.shop_orders_enabled),
  });
  const shop = shops.data?.[0] || null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        title="المتجر"
        subtitle={shop ? (shop.shop_name || shop.display_name) : undefined}
        onBack={() => navigation.goBack()}
      />
      <ChipRow options={TABS as any} value={tab} onChange={setTab as any} />

      {!shop ? (
        <ListState
          loading={shops.isLoading}
          error={shops.isError ? shops.error : false}
          empty={!shops.isLoading && !shops.isError}
          emptyText="لا يوجد متجر مفعّل للطلبات."
          onRetry={shops.refetch}
        />
      ) : tab === 'stock' ? <Stock shopId={shop.id} bottom={insets.bottom} />
        : tab === 'fulfil' ? <Fulfilment bottom={insets.bottom} />
        : tab === 'customers' ? <Customers shopId={shop.id} bottom={insets.bottom} />
        : <Stats shopId={shop.id} bottom={insets.bottom} />}
    </View>
  );
}

// ─── المخزون ─────────────────────────────────────────────────────────
function Stock({ shopId, bottom }: { shopId: number; bottom: number }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);

  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['store-stock', shopId, q],
    queryFn: () => api<Item[]>(
      `/admin/listings?seller_id=${shopId}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}&limit=200`,
    ),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      api(`/admin/listings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-stock'] }),
    onError: () => Alert.alert('تعذّر الحفظ', 'لم يتم تطبيق التغيير.'),
  });

  const rows = Array.isArray(data) ? data : [];
  const outOfStock = rows.filter((r) => r.stock_qty === 0).length;

  return (
    <>
      <SearchBar value={q} onChangeText={setQ} placeholder="ابحث في المخزون…" />
      {outOfStock ? (
        <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.warn, textAlign: 'right', paddingHorizontal: 18, paddingBottom: 6 }}>
          {outOfStock} صنف نفد من المخزون
        </Text>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError ? error : false}
            empty={!isLoading && !isError} emptyText="لا أصناف." onRetry={refetch} />
        }
        renderItem={({ item: it }) => (
          <Card>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <StockPill qty={it.stock_qty} />
              <Text style={{ flex: 1, textAlign: 'left', fontSize: 14.5, fontWeight: '700', color: theme.accent }}>
                {iqd(it.asking_price)} <Text style={{ fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
              </Text>
            </View>
            <View style={{ marginTop: 8 }}>
              <Title>{deviceTitle(it.brand, it.model)}</Title>
              <Meta>{[it.storage, it.color].filter(Boolean).join(' · ') || '—'}</Meta>
              {/* Cost is the one number that must never reach a buyer, so it
                  is shown here and nowhere in the public API. */}
              <Meta>الكلفة: {it.cost_price != null ? `${iqd(it.cost_price)} د.ع` : 'غير محددة'}</Meta>
            </View>
            <ActionRow>
              <Action label="السعر والكمية" tone="primary" onPress={() => setEditing(it)} busy={patch.isPending} />
              <Action
                label={it.status === 'active' ? 'إخفاء' : 'تفعيل'}
                tone={it.status === 'active' ? 'neutral' : 'ok'}
                busy={patch.isPending}
                onPress={() => patch.mutate({ id: it.id, body: { status: it.status === 'active' ? 'sold' : 'active' } })}
              />
            </ActionRow>
          </Card>
        )}
      />
      <StockEditor
        item={editing}
        busy={patch.isPending}
        onClose={() => setEditing(null)}
        onSave={(body) => { if (editing) patch.mutate({ id: editing.id, body }); setEditing(null); }}
      />
    </>
  );
}

function StockPill({ qty }: { qty: number | null }) {
  const label = qty == null ? 'غير محدود' : qty === 0 ? 'نفد' : `${qty} قطعة`;
  const tone = qty == null ? theme.surfaceAlt : qty === 0 ? theme.danger : qty <= 2 ? theme.warn : theme.ok;
  const fg = qty == null ? theme.subtle : '#fff';
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: tone }}>
      <Text style={{ fontSize: 10.5, fontWeight: '700', color: fg }}>{label}</Text>
    </View>
  );
}

function StockEditor({ item, busy, onClose, onSave }: {
  item: Item | null; busy: boolean; onClose: () => void; onSave: (body: any) => void;
}) {
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  React.useEffect(() => {
    setPrice(item ? String(item.asking_price) : '');
    setQty(item?.stock_qty != null ? String(item.stock_qty) : '');
    setCost(item?.cost_price != null ? String(item.cost_price) : '');
  }, [item?.id]);

  const p = Number(price.replace(/\D/g, ''));
  const valid = Number.isFinite(p) && p > 0;

  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: radius.xl, padding: 20 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'right' }}>
            {item ? deviceTitle(item.brand, item.model) : ''}
          </Text>
          <Num label="سعر البيع (د.ع)" value={price} onChange={setPrice} />
          <Num label="الكمية — اتركه فارغاً لغير محدود" value={qty} onChange={setQty} />
          <Num label="كلفة الشراء (د.ع) — لا تظهر للزبون" value={cost} onChange={setCost} />
          <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 16 }}>
            <TouchableOpacity
              disabled={!valid || busy}
              onPress={() => onSave({
                asking_price: p,
                // '' means "untracked", which is different from 0 ("none
                // left"). Sending 0 for a blank field would silently take
                // every unlimited item out of stock.
                stock_qty: qty.trim() === '' ? null : Number(qty.replace(/\D/g, '')),
                cost_price: cost.trim() === '' ? null : Number(cost.replace(/\D/g, '')),
              })}
              style={{
                flex: 1, paddingVertical: 13, borderRadius: radius.lg,
                backgroundColor: theme.accent, alignItems: 'center', opacity: valid && !busy ? 1 : 0.45,
              }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: '#fff' }}>حفظ</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{
              flex: 1, paddingVertical: 13, borderRadius: radius.lg,
              borderWidth: 1.5, borderColor: theme.line, alignItems: 'center',
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.subtle }}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginBottom: 5 }}>
        {label}
      </Text>
      <TextInput
        value={value ? Number(value.replace(/\D/g, '')).toLocaleString('en-US') : ''}
        onChangeText={(t) => onChange(t.replace(/\D/g, ''))}
        keyboardType="phone-pad"
        placeholder="—"
        placeholderTextColor={theme.faint}
        style={{
          backgroundColor: theme.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
          paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, fontWeight: '700',
          color: theme.ink, textAlign: 'center',
        }}
      />
    </View>
  );
}

// ─── التجهيز ─────────────────────────────────────────────────────────
function Fulfilment({ bottom }: { bottom: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Order | null>(null);

  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['store-fulfil'],
    queryFn: () => api<{ orders: Order[] }>('/admin/orders?status=confirmed'),
  });

  const save = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      api(`/admin/orders/${id}/fulfilment`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-fulfil'] }),
    onError: () => Alert.alert('تعذّر الحفظ', 'لم يتم حفظ بيانات التوصيل.'),
  });

  const rows = data?.orders || [];

  return (
    <>
      <FlatList
        data={rows}
        keyExtractor={(o) => String(o.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError ? error : false}
            empty={!isLoading && !isError} emptyText="لا طلبات مؤكّدة بانتظار التجهيز." onRetry={refetch} />
        }
        renderItem={({ item: o }) => (
          <Card>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 12.5, color: theme.subtle }}>{o.code}</Text>
              <Text style={{ flex: 1, textAlign: 'left', fontSize: 14.5, fontWeight: '700', color: theme.ink }}>
                {iqd(o.total)} <Text style={{ fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
              </Text>
            </View>
            <View style={{ marginTop: 8 }}>
              <Title>{o.customer_name}</Title>
              <Meta>{o.governorate} — {o.address}</Meta>
              <Meta>
                {o.courier ? `المندوب: ${o.courier}` : 'لم يُسنَد لمندوب'}
                {o.delivery_cost != null ? ` · كلفة ${iqd(o.delivery_cost)} د.ع` : ''}
              </Meta>
            </View>
            <ActionRow>
              <Action label="اتصال" tone="ok" onPress={() => Linking.openURL(`tel:${o.customer_phone}`).catch(() => {})} />
              <Action label="بيانات التوصيل" tone="primary" onPress={() => setEditing(o)} busy={save.isPending} />
            </ActionRow>
          </Card>
        )}
      />
      <FulfilEditor
        order={editing}
        busy={save.isPending}
        onClose={() => setEditing(null)}
        onSave={(body) => { if (editing) save.mutate({ id: editing.id, body }); setEditing(null); }}
      />
    </>
  );
}

function FulfilEditor({ order, busy, onClose, onSave }: {
  order: Order | null; busy: boolean; onClose: () => void; onSave: (body: any) => void;
}) {
  const [courier, setCourier] = useState('');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  React.useEffect(() => {
    setCourier(order?.courier || '');
    setNote(order?.tracking_note || '');
    setCost(order?.delivery_cost != null ? String(order.delivery_cost) : '');
  }, [order?.id]);

  return (
    <Modal visible={!!order} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: radius.xl, padding: 20 }}>
          <Text style={{ fontFamily: fonts.arBold, fontSize: 16, color: theme.ink, textAlign: 'right' }}>
            بيانات التوصيل · {order?.code}
          </Text>
          <Txt label="المندوب" value={courier} onChange={setCourier} placeholder="اسم المندوب أو الشركة" />
          <Txt label="ملاحظة التتبّع" value={note} onChange={setNote} placeholder="رقم البوليصة أو ملاحظة" />
          <Num label="كلفة التوصيل (د.ع)" value={cost} onChange={setCost} />
          <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 16 }}>
            <TouchableOpacity
              disabled={busy}
              onPress={() => onSave({
                courier: courier.trim() || null,
                tracking_note: note.trim() || null,
                delivery_cost: cost.trim() === '' ? null : Number(cost.replace(/\D/g, '')),
              })}
              style={{
                flex: 1, paddingVertical: 13, borderRadius: radius.lg,
                backgroundColor: theme.accent, alignItems: 'center', opacity: busy ? 0.5 : 1,
              }}
            >
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: '#fff' }}>حفظ</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{
              flex: 1, paddingVertical: 13, borderRadius: radius.lg,
              borderWidth: 1.5, borderColor: theme.line, alignItems: 'center',
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.subtle }}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Txt({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginBottom: 5 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.faint}
        style={{
          backgroundColor: theme.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
          paddingHorizontal: 14, paddingVertical: 12, fontSize: 14.5, color: theme.ink, textAlign: 'right',
        }}
      />
    </View>
  );
}

// ─── الزبائن ─────────────────────────────────────────────────────────
function Customers({ shopId, bottom }: { shopId: number; bottom: number }) {
  const [q, setQ] = useState('');
  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['store-customers', shopId, q],
    queryFn: () => api<{ total: number; customers: Customer[] }>(
      `/admin/store/${shopId}/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    ),
  });
  const rows = data?.customers || [];

  return (
    <>
      <SearchBar value={q} onChangeText={setQ} placeholder="ابحث برقم الهاتف أو الاسم…" />
      <FlatList
        data={rows}
        keyExtractor={(c) => c.phone}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 90 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
        ListEmptyComponent={
          <ListState loading={isLoading} error={isError ? error : false}
            empty={!isLoading && !isError} emptyText="لا زبائن." onRetry={refetch} />
        }
        renderItem={({ item: c }) => {
          // Three or more refusals is the shop's own risk signal — it is the
          // difference between a customer and a delivery that costs money
          // every time it goes out.
          const risky = c.cancelled >= 3;
          return (
            <Card>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                {risky ? (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: theme.danger }}>
                    <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#fff' }}>مخاطرة</Text>
                  </View>
                ) : null}
                <Text style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: '700', color: theme.ink }}>
                  {iqd(c.delivered_value)} <Text style={{ fontSize: 10.5, color: theme.subtle }}>د.ع</Text>
                </Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <Title>{c.name || 'بدون اسم'}</Title>
                <Meta>{c.phone}{c.governorate ? ` · ${c.governorate}` : ''}</Meta>
                <Meta>{c.orders} طلب · {c.delivered} مُسلَّم · {c.cancelled} ملغي{c.returned ? ` · ${c.returned} مرتجع` : ''}</Meta>
              </View>
              <ActionRow>
                <Action label="اتصال" tone="ok" onPress={() => Linking.openURL(`tel:${c.phone}`).catch(() => {})} />
              </ActionRow>
            </Card>
          );
        }}
      />
    </>
  );
}

// ─── الأداء ──────────────────────────────────────────────────────────
function Stats({ shopId, bottom }: { shopId: number; bottom: number }) {
  const { data, isLoading, isRefetching, refetch, isError, error } = useQuery({
    queryKey: ['store-stats', shopId],
    queryFn: () => api<any>(`/admin/store/${shopId}/stats?days=30`),
  });

  if (isLoading || isError) {
    return <ListState loading={isLoading} error={isError ? error : false} emptyText="" onRetry={refetch} />;
  }

  const d = data || {};
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 90 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.subtle} />}
    >
      <Group label="اليوم">
        <Stat label="طلبات" value={String(d.today?.orders ?? 0)} />
        <Stat label="قيمة" value={`${iqd(d.today?.value)} د.ع`} />
      </Group>

      <Group label={`آخر ${d.window_days ?? 30} يوم`}>
        <Stat label="مطلوبة" value={`${d.placed?.orders ?? 0} · ${iqd(d.placed?.value)} د.ع`} />
        <Stat label="مُسلَّمة" value={`${d.delivered?.orders ?? 0} · ${iqd(d.delivered?.value)} د.ع`} tone={theme.ok} />
        <Stat label="ملغاة" value={String(d.cancelled?.orders ?? 0)} tone={theme.danger} />
        <Stat label="مرتجعة" value={String(d.returned?.orders ?? 0)} tone={theme.warn} />
        {/* Deliberately from delivered orders only — an average over placed
            orders flatters itself with everything that got refused. */}
        <Stat label="متوسط الطلب" value={`${iqd(d.aov)} د.ع`} />
      </Group>

      {d.margin ? (
        <Group label="هامش الربح">
          <Stat label="النسبة" value={`${d.margin.pct ?? 0}%`} tone={theme.ok} />
          <Stat label="الإيراد" value={`${iqd(d.margin.revenue)} د.ع`} />
          <Stat label="الكلفة" value={`${iqd(d.margin.cost)} د.ع`} />
          {/* Without this the number can't be read honestly: a margin from two
              priced lines out of fifty is not the shop's margin. */}
          <Stat label="محسوب على" value={`${d.margin.covered_pct ?? 0}% من الإيراد`} />
        </Group>
      ) : null}

      <Group label="مفتوح الآن">
        <Stat label="قيد التنفيذ" value={String(d.open?.orders ?? 0)} />
        <Stat label="بانتظار التأكيد" value={String(d.pending?.orders ?? 0)} tone={theme.urgent} />
      </Group>
    </ScrollView>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.faint, textAlign: 'right', marginBottom: 8 }}>
        {label}
      </Text>
      <View style={{
        backgroundColor: theme.surface, borderRadius: radius.xl,
        borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
      }}>
        {children}
      </View>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center',
      paddingHorizontal: 15, paddingVertical: 12,
      borderTopWidth: 1, borderTopColor: theme.line,
    }}>
      <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle, textAlign: 'right' }}>
        {label}
      </Text>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, fontWeight: '700', color: tone || theme.ink }}>
        {value}
      </Text>
    </View>
  );
}
