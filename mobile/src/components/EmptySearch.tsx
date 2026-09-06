// Zero results, with somewhere to go.
//
// The contract, inherited from the spelling suggestions next door and stated
// in docs/asking-price-guidance.md: nothing here changes a filter. Each
// option is a labelled, counted, tappable alternative — the tap is what
// applies it, and the count comes from the server having actually run that
// query, so the number on the chip is the number the buyer lands on.
//
// The one thing this says unprompted is that the governorate filter may not
// have been the buyer's idea: Browse auto-applies the user's own province on
// first mount, so a great many dead ends are location-scoped by a filter
// nobody chose. Saying so is the difference between "there are no iPhones"
// and "there are no iPhones *in Mosul*".

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../theme';
import { Listings, type BrowseFilters } from '../api/endpoints';
import { arOf } from '../lib/governorates';
import { fmtIQD } from './ui';
import { ar } from '../i18n/ar';

/** Mirrors the server's `label_key`; the wording lives here, not there. */
function labelFor(a: any): string {
  const n = a.count;
  switch (a.label_key) {
    case 'other_storage':
      return `${a.value} — ${n} إعلان`;
    case 'nearby_governorate':
      return `${arOf(a.value)} — ${n} إعلان`;
    case 'wider_budget':
      return `حتى ${fmtIQD(a.value)} د.ع — ${n} إعلان`;
    case 'all_governorates':
      return `كل المحافظات — ${n} إعلان`;
    default:
      return `${n} إعلان`;
  }
}

function headingFor(kind: string): string {
  switch (kind) {
    case 'storage': return 'سعة أخرى';
    case 'governorate': return 'محافظات مجاورة';
    case 'budget': return 'ميزانية أوسع قليلاً';
    default: return 'وسّع البحث';
  }
}

export function EmptySearch({
  filters,
  govWasAutoApplied,
  onApply,
}: {
  filters: BrowseFilters;
  govWasAutoApplied?: boolean;
  onApply: (patch: Partial<BrowseFilters>) => void;
}) {
  const hasFilters = Object.keys(filters).some(
    (k) => !['sort', 'seed', 'limit', 'offset'].includes(k) && (filters as any)[k] != null,
  );

  const { data } = useQuery({
    queryKey: ['search-alternatives', filters],
    queryFn: () => Listings.searchAlternatives(filters),
    // Only ask once the search has genuinely settled on nothing. Asking while
    // a result set still might arrive would put "try Babil instead" under a
    // list that is about to fill in.
    enabled: hasFilters,
    staleTime: 60_000,
    retry: 1,
  });

  const alternatives = data?.alternatives ?? [];
  // Group so the buyer reads "somewhere else / a different size / a bit more
  // money" rather than a flat pile of chips.
  const groups: { kind: string; items: any[] }[] = [];
  for (const a of alternatives) {
    const key = a.kind === 'all_governorates' ? 'governorate' : a.kind;
    const g = groups.find((x) => x.kind === key);
    if (g) g.items.push(a);
    else groups.push({ kind: key, items: [a] });
  }

  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 36, alignItems: 'center' }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'center' }}>
        {ar.browse.none}
      </Text>

      {filters.governorate ? (
        <Text style={{
          fontFamily: fonts.ar, fontSize: 13, color: theme.subtle,
          textAlign: 'center', lineHeight: 21, marginTop: 8,
        }}>
          {govWasAutoApplied
            ? `البحث محصور بمحافظة ${arOf(filters.governorate)} — اخترناها لك تلقائياً.`
            : `لا توجد نتائج في محافظة ${arOf(filters.governorate)}.`}
        </Text>
      ) : null}

      {groups.length > 0 ? (
        <View style={{ width: '100%', marginTop: 20, gap: 16 }}>
          {groups.map((g) => (
            <View key={g.kind} style={{ gap: 8 }}>
              <Text style={{
                fontFamily: fonts.arBold, fontSize: 12, color: theme.subtle, textAlign: 'right',
              }}>
                {headingFor(g.kind)}
              </Text>
              <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
                {g.items.map((a) => (
                  <TouchableOpacity
                    key={`${a.kind}:${a.value ?? 'all'}`}
                    onPress={() => onApply(a.apply)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    style={{
                      paddingHorizontal: 14, paddingVertical: 9,
                      borderRadius: radius.pill,
                      backgroundColor: theme.surface,
                      borderWidth: 1, borderColor: theme.line,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink }}>
                      {labelFor(a)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
          <Text style={{
            fontFamily: fonts.ar, fontSize: 11, color: theme.subtle,
            textAlign: 'right', lineHeight: 17, marginTop: 2,
          }}>
            لن يتغيّر بحثك إلا إذا اخترت أحد الخيارات أعلاه.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
