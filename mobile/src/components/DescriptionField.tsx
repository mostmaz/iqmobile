// «وصف حالة الجهاز» — the field, its counter, its note and its seeds.
//
// Three changes, all aimed at the same failure: the thirty-character minimum
// used to be invisible until the seller pressed «التالي» and was refused.
//
//   The counter makes the requirement visible BEFORE it blocks anything.
//   The note that listingQuality raises about the description now sits under
//     the description, and turns green the moment it is satisfied, instead
//     of in a card at the bottom of the step.
//   The seed phrases give a seller who does not know what to write something
//     to edit rather than a blank box. They are deliberately hedged — «غير
//     معروف» is one of them — because the goal is an honest description, not
//     a long one.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { Input } from './ui';
import { IconCheck } from './icons';

/** The minimum the wizard enforces. Kept here so the counter cannot drift. */
export const DESCRIPTION_MIN = 30;

/**
 * Starting phrases, not a template.
 *
 * Each is a complete, cautious sentence a seller can delete or edit. None of
 * them asserts anything flattering: two describe defects and one says the
 * information is unknown, because a seed that says "excellent condition"
 * would put words in the seller's mouth and a claim on the listing that
 * nobody checked.
 */
const SEEDS = [
  'الشاشة بلا خدوش ظاهرة.',
  'الهيكل فيه خدوش خفيفة على الحواف.',
  'لم يُصلَّح ولم تُبدَّل أي قطعة.',
  'تاريخ الإصلاح غير معروف.',
];

export function DescriptionField({ value, onChange, note }: {
  value: string;
  onChange: (next: string) => void;
  /** The listingQuality advice about the description, if it raised one. */
  note?: string | null;
}) {
  const len = value.trim().length;
  const met = len >= DESCRIPTION_MIN;
  /** Long enough AND nothing listingQuality still objects to. */
  const done = met && !note;

  const add = (phrase: string) => {
    if (value.includes(phrase)) return;
    const sep = value.trim() ? (/[.!؟\s]$/.test(value) ? ' ' : ' ') : '';
    onChange((value.trim() + sep + phrase).trim());
  };

  return (
    <View style={{ marginTop: 12 }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'baseline',
        justifyContent: 'space-between', marginBottom: 8,
      }}>
        {/* flexShrink: 0 is load-bearing. With the counter as a sibling in a
            space-between row, Android shrank this Text and dropped «الجهاز»
            entirely — Arabic loses a whole trailing token rather than
            ellipsising. Every label paired with a counter needs this. */}
        <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ flexShrink: 0, fontFamily: fonts.arBold, fontSize: 12, color: theme.subtle }}>
          وصف حالة الجهاز
        </Text>
        <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
          fontFamily: fonts.ltrBold, fontSize: 11.5,
          color: met ? theme.success : theme.subtle,
        }}>
          {len} / {DESCRIPTION_MIN}
        </Text>
      </View>

      <Input
        value={value}
        onChangeText={onChange}
        placeholder="حالة الشاشة والهيكل، أي إصلاح أو قطع مبدلة، والعيوب إن وجدت. اذكر ما لا تعرفه بوضوح."
        multiline
      />

      {/* Always on screen, and green ONLY when nothing is left to say.
          It used to render on `note || !met`, which is false in exactly the
          case the green state exists for — a long enough description that
          listingQuality is happy with — so the box vanished at the moment it
          was supposed to confirm. It also let `met` outrank an open note and
          print «الوصف كافٍ» over advice that still stood. */}
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 8,
        marginTop: 8, paddingVertical: 9, paddingHorizontal: 11,
        borderRadius: radius.md,
        backgroundColor: done ? theme.successSoft : theme.accentSoft,
      }}>
        {done ? (
          <IconCheck size={13} color={theme.success} />
        ) : (
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accent, marginTop: 5 }} />
        )}
        <Text style={{
          flex: 1, fontFamily: fonts.ar, fontSize: 12.5, lineHeight: 20, textAlign: 'right',
          color: done ? theme.success : theme.ink,
        }}>
          {done ? 'الوصف كافٍ — شكراً.' : (!met ? `اكتب ${DESCRIPTION_MIN} حرفاً على الأقل عن حالة الجهاز.` : note)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {SEEDS.map((p) => {
          const used = value.includes(p);
          return (
            <TouchableOpacity
              key={p}
              activeOpacity={0.8}
              disabled={used}
              onPress={() => add(p)}
              accessibilityRole="button"
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
                backgroundColor: used ? theme.chipBg : theme.surface,
                borderWidth: 1, borderColor: used ? theme.chipBg : theme.line,
                opacity: used ? 0.55 : 1,
              }}
            >
              <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.ar, fontSize: 11.5, color: theme.ink }}>
                {p}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={{ marginTop: 8, fontFamily: fonts.ar, fontSize: 11, lineHeight: 18, color: theme.subtle, textAlign: 'right' }}>
        اضغط عبارة لإضافتها، ثم عدّلها. لا تضف معلومة لا تعرفها.
      </Text>
    </View>
  );
}
