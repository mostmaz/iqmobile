// «قوة الإعلان» — the checklist, moved to where it gets read.
//
// It used to render as a card beneath each step's content. On a 390pt screen
// that is below the fold, so a seller could complete the whole wizard and
// press publish having never once seen a note. Same notes, same logic; the
// change is that this sits directly under the step dots and cannot be
// scrolled past.
//
// Collapsed it is one number. Open it is the list, each row naming the fix
// and offering to go there. Notes never block publishing — that is stated on
// the review step, and nothing here changes it.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { IconCheck, IconChevronDown } from './icons';
import { listingStrength, strengthChipLabel, type StrengthNote } from '../lib/listingStrength';

export function ListingStrengthRail({ issues, totalChecks, onEdit }: {
  issues: StrengthNote[];
  totalChecks: number;
  onEdit: (step: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const s = listingStrength(issues, totalChecks);
  const done = s.notes.length === 0;
  const tint = done ? theme.success : s.band === 'ok' ? theme.accent : theme.accentDeep;

  return (
    <View style={{ marginTop: 12 }}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`قوة الإعلان ${s.score} بالمئة`}
        style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
          paddingVertical: 11, paddingHorizontal: 13,
          borderRadius: radius.xl, backgroundColor: theme.surface,
          borderWidth: 1, borderColor: theme.line,
        }}
      >
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 8 }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink }}>
              قوة الإعلان
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.ltrBold, fontSize: 13, color: tint }}>
              {s.score}%
            </Text>
          </View>
          {/* The bar is the whole point of the collapsed state: a number
              alone does not say "nearly there" at a glance. */}
          <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: theme.chipBg, overflow: 'hidden' }}>
            <View style={{ width: `${s.score}%`, height: 6, borderRadius: radius.pill, backgroundColor: tint }} />
          </View>
        </View>

        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
          paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill,
          backgroundColor: done ? theme.successSoft : theme.accentSoft,
        }}>
          {done ? <IconCheck size={11} color={theme.success} /> : null}
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
            fontFamily: fonts.arBold, fontSize: 10.5,
            color: done ? theme.success : theme.accentDeep,
          }}>
            {strengthChipLabel(s.notes.length)}
          </Text>
        </View>

        {done ? null : (
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <IconChevronDown size={14} color={theme.subtle} />
          </View>
        )}
      </TouchableOpacity>

      {open && !done ? (
        <View style={{
          marginTop: 10, backgroundColor: theme.surface,
          borderWidth: 1, borderColor: theme.line, borderRadius: radius.lg,
          paddingHorizontal: 14,
        }}>
          {s.notes.map((n, i) => (
            <View
              key={n.id}
              style={{
                flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10,
                paddingVertical: 12,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.line,
              }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accent, marginTop: 6 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
                  {n.title}
                </Text>
                {(n.hint || n.advice) ? (
                  <Text style={{ marginTop: 2, fontFamily: fonts.ar, fontSize: 11.5, lineHeight: 18, color: theme.subtle, textAlign: 'right' }}>
                    {n.hint || n.advice}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => { setOpen(false); onEdit(n.step); }} hitSlop={8} accessibilityRole="button">
                <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.accent }}>تعديل</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
