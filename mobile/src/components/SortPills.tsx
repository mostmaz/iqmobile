// How the results are ordered — one definition, used by every screen that
// lists devices.
//
// The server has had these four orders since the beginning (SORTS in
// routes/listings.js) and no screen ever sent one, so every buyer read the
// feed in posting order and worked out the cheapest by scrolling it. The
// labels live here rather than in each screen because "الأرخص أولاً" on the
// home filter and "الأقل سعراً" in search would read as two features.
//
// There is deliberately no "الأنسب"/relevance order: the search is a plain
// token AND-match with no score behind it, so a relevance sort would be
// recency wearing a different name.
import React, { useRef } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pill } from './ui';
import { theme, fonts } from '../theme';
import type { BrowseSort } from '../api/endpoints';

export const SORT_OPTIONS: Array<{ key: BrowseSort; label: string }> = [
  { key: 'new', label: 'الأحدث' },
  { key: 'price_asc', label: 'الأرخص أولاً' },
  { key: 'price_desc', label: 'الأغلى أولاً' },
  { key: 'viewed', label: 'الأكثر مشاهدة' },
];

export function SortPills({ value, onChange, label = 'الترتيب' }: {
  /** undefined means the default order, same as 'new'. */
  value?: BrowseSort;
  onChange: (v: BrowseSort | undefined) => void;
  /** Omit to render the rail with no heading. */
  label?: string | null;
}) {
  const ref = useRef<ScrollView>(null);
  const active = value || 'new';
  return (
    <View style={{ marginBottom: 8 }}>
      {label ? (
        <Text style={{
          fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle,
          marginBottom: 6, textAlign: 'right',
        }}>
          {label}
        </Text>
      ) : null}
      {/* row-reverse lays the first option out at the content's RIGHT edge,
          but a ScrollView opens at offset 0 — its LEFT — so without this the
          rail would open on "الأكثر مشاهدة" instead of the default order.
          Same fix the brand rails use. */}
      <ScrollView
        ref={ref}
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 2 }}
        onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })}
      >
        {SORT_OPTIONS.map((o) => (
          <Pill
            key={o.key}
            active={active === o.key}
            // 'new' is the server's default, so it is sent as nothing at all
            // — that keeps the query key (and the saved search) identical to
            // what it was before a buyer ever touched the control.
            onPress={() => onChange(o.key === 'new' ? undefined : o.key)}
          >
            {o.label}
          </Pill>
        ))}
      </ScrollView>
    </View>
  );
}
