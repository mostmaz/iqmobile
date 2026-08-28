// The shortlist, parked above the tab bar while the buyer keeps browsing.
//
// Without it the shortlist is invisible: a buyer adds a phone, scrolls on,
// and has no way to see what is in it or to get to the comparison. The tray
// shows the picks as thumbnails with the empty slots still drawn, so "you
// can add one more" is visible rather than something you have to know.
//
// It appears only once something is in it (design 2b: nothing picked, no
// tray at all). At one device the action is not disabled — a dead button is
// a dead end — it becomes "go find the second one", which is what the buyer
// has to do next anyway.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Img } from './Img';
import { IconClose, IconCompare } from './icons';
import { fullImageUrl } from '../api/upload';
import { useCompare, COMPARE_MAX, type CompareEntry } from '../lib/compare';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';

export function CompareTray({ onOpen, onFindMore }: {
  onOpen: () => void;
  /** Where "add a second one" goes — back to browsing. */
  onFindMore: () => void;
}) {
  const { entries, remove } = useCompare();
  if (!entries.length) return null;

  const ready = entries.length >= 2;
  const slots: Array<CompareEntry | null> = [...entries];
  while (slots.length < COMPARE_MAX) slots.push(null);

  return (
    <View style={{
      // bottom: 0 — this screen's viewport already ends above the tab bar,
      // so adding the bar's height (and the home-indicator inset it already
      // carries) floated the tray a bar-and-a-half up the screen.
      position: 'absolute', left: 0, right: 0, bottom: 0,
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
        onPress={ready ? onOpen : onFindMore}
        activeOpacity={0.88}
        style={{
          flex: 1, paddingVertical: 12, borderRadius: radius.lg,
          backgroundColor: ready ? theme.ink : theme.chipBg,
          borderWidth: ready ? 0 : 1, borderColor: theme.line,
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}
      >
        <IconCompare size={15} color={ready ? theme.buttonInk : theme.chipInk} sw={1.8} />
        <Text
          maxFontSizeMultiplier={FONT_SCALE_TIGHT}
          style={{
            fontFamily: fonts.arBold, fontSize: 13.5,
            color: ready ? theme.buttonInk : theme.chipInk,
          }}
        >
          {ready ? 'قارن' : 'دوّر على جهاز ثاني'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
