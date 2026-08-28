// The shortlist, parked above the tab bar while the buyer keeps browsing.
//
// Without it the shortlist is invisible: a buyer adds a phone, scrolls on,
// and has no way to see what is in it or to get to the comparison. The tray
// shows the picks as thumbnails with the empty slots still drawn, so "you
// can add one more" is visible rather than something you have to know.
//
// It appears only once something is in it (design 2b: nothing picked, no
// tray at all), and its action stays disabled at one device — a comparison
// needs two, and a button that opens an empty table would be a lie.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Img } from './Img';
import { IconClose, IconCompare } from './icons';
import { fullImageUrl } from '../api/upload';
import { useCompare, COMPARE_MAX, type CompareEntry } from '../lib/compare';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';

export function CompareTray({ onOpen, bottomInset = 0 }: {
  onOpen: () => void;
  /** Height of whatever sits below (a tab bar, a buy bar) in points. */
  bottomInset?: number;
}) {
  const insets = useSafeAreaInsets();
  const { entries, remove } = useCompare();
  if (!entries.length) return null;

  const ready = entries.length >= 2;
  const slots: Array<CompareEntry | null> = [...entries];
  while (slots.length < COMPARE_MAX) slots.push(null);

  return (
    <View style={{
      position: 'absolute', left: 0, right: 0,
      bottom: bottomInset + insets.bottom,
      backgroundColor: theme.surface,
      borderTopWidth: 1, borderTopColor: theme.line,
      paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
      flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
    }}>
      <View style={{ flexDirection: 'row-reverse', gap: 6 }}>
        {slots.map((e, i) => (e ? (
          <View key={e.id}>
            <View style={{
              width: 44, height: 44, borderRadius: radius.md,
              backgroundColor: theme.chipBg, overflow: 'hidden',
            }}>
              {e.image_path ? (
                <Img source={{ uri: fullImageUrl(e.image_path) }} style={{ width: '100%', height: '100%' }} />
              ) : null}
            </View>
            {/* Removing from the tray itself, so the buyer never has to go
                back to a listing page to drop it. */}
            <TouchableOpacity
              onPress={() => remove(e.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                position: 'absolute', top: -5, left: -5,
                width: 18, height: 18, borderRadius: 999,
                backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <IconClose size={9} color={theme.buttonInk} sw={2.6} />
            </TouchableOpacity>
          </View>
        ) : (
          <View
            key={`slot-${i}`}
            style={{
              width: 44, height: 44, borderRadius: radius.md,
              borderWidth: 1, borderStyle: 'dashed', borderColor: theme.line,
            }}
          />
        )))}
      </View>

      <TouchableOpacity
        onPress={ready ? onOpen : undefined}
        disabled={!ready}
        activeOpacity={0.88}
        style={{
          flex: 1, paddingVertical: 12, borderRadius: radius.lg,
          backgroundColor: ready ? theme.ink : theme.chipBg,
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}
      >
        <IconCompare size={15} color={ready ? theme.buttonInk : theme.subtle} sw={1.8} />
        <Text
          maxFontSizeMultiplier={FONT_SCALE_TIGHT}
          style={{
            fontFamily: fonts.arBold, fontSize: 13.5,
            color: ready ? theme.buttonInk : theme.subtle,
          }}
        >
          {ready ? 'قارن' : 'أضف جهاز ثاني'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
