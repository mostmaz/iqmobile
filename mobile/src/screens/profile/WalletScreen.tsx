// The seller's wallet: the balance, and every row that explains it.
//
// A bare number invites "where did that come from?" — especially for credit
// the seller did not pay for — so the history is the screen, not a detail
// hidden behind it.
import React from 'react';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../../theme';
import { Header, fmtIQD } from '../../components/ui';
import { IconSpark, IconTag } from '../../components/icons';
import { Wallet, type WalletEntry } from '../../api/endpoints';
import { useTabBarClearance } from '../../lib/tabBarClearance';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${arNum(d.getDate())}/${arNum(d.getMonth() + 1)}/${arNum(d.getFullYear())}`;
}

// Arabic for each ledger reason. An unknown reason falls back to the note the
// server stored rather than showing a raw key.
function reasonLabel(e: WalletEntry): string {
  switch (e.reason) {
    case 'promo_bonus': return 'رصيد هدية من العرض';
    case 'feature_spend': return 'تمييز إعلان';
    case 'admin_adjust': return 'تعديل من الإدارة';
    default: return e.note || e.reason;
  }
}

export default function WalletScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const pad = useTabBarClearance();
  const { data, isLoading } = useQuery({ queryKey: ['wallet'], queryFn: () => Wallet.get() });
  const balance = data?.balance ?? 0;
  const entries = data?.entries ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="رصيدي" onBack={() => navigation.goBack()} />

      <FlatList
        data={entries}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: pad + insets.bottom + 24 }}
        ListHeaderComponent={
          <View style={{
            backgroundColor: theme.ink, borderRadius: radius.xxl,
            padding: 20, alignItems: 'center', marginBottom: 18,
          }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
              الرصيد المتاح
            </Text>
            <Text style={{ fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 34, color: '#fff', marginTop: 4 }}>
              {fmtIQD(balance)}
            </Text>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
              دينار عراقي
            </Text>
            <Text style={{
              fontFamily: fonts.ar, fontSize: 12.5, color: 'rgba(255,255,255,0.75)',
              marginTop: 12, textAlign: 'center', lineHeight: 20,
            }}>
              يُستعمل الرصيد لتمييز إعلاناتك — يُخصم فوراً بدون تحويل رصيد.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const credit = item.delta > 0;
          return (
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
              backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
              borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8,
            }}>
              <View style={{
                width: 36, height: 36, borderRadius: 999,
                backgroundColor: credit ? theme.successSoft : theme.chipBg,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {credit
                  ? <IconSpark size={17} color={theme.success} />
                  : <IconTag size={17} color={theme.subtle} sw={1.7} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right' }}>
                  {reasonLabel(item)}
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                  {fmtDate(item.created_at)}
                </Text>
              </View>
              <Text style={{
                fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 15,
                color: credit ? theme.success : theme.ink, writingDirection: 'ltr',
              }}>
                {credit ? '+' : '−'}{fmtIQD(Math.abs(item.delta))}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink }}>ماكو حركات بعد</Text>
            <Text style={{
              fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
              marginTop: 6, textAlign: 'center', lineHeight: 21,
            }}>
              ميّز إعلانك بالعرض الخاص وينضاف رصيد إلى حسابك.
            </Text>
          </View>
        )}
      />
    </View>
  );
}
