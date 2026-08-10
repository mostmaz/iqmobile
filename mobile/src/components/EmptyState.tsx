// One empty state, so they stop arriving in three quality tiers.
//
// The app had: Wishlist with an icon, a headline, a line of copy and a CTA;
// Saved Searches with icon, headline and copy; and Favorites, My Listings
// and search results with a single line of grey text. My Listings was the
// worst of it — the screen whose whole purpose is "you have no listings"
// offered no way to create one.
//
// An empty state is the only screen a new user is guaranteed to see, so
// every one of them gets the same three parts and, where there is an
// obvious next step, a button to take it.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius } from '../theme';

export function EmptyState({
  icon, title, body, actionLabel, onAction,
}: {
  /** A 30px icon element, e.g. <IconBell size={30} color={theme.subtle} sw={1.5} />. */
  icon?: React.ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ paddingVertical: 44, paddingHorizontal: 32, alignItems: 'center' }}>
      {icon}
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 15, color: theme.ink,
        marginTop: icon ? 12 : 0, textAlign: 'center',
      }}>
        {title}
      </Text>
      {body ? (
        <Text style={{
          fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle,
          marginTop: 6, textAlign: 'center', lineHeight: 20,
        }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          onPress={onAction}
          activeOpacity={0.85}
          accessibilityRole="button"
          style={{
            marginTop: 16, paddingHorizontal: 20, paddingVertical: 12,
            borderRadius: radius.pill, backgroundColor: theme.ink,
          }}
        >
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk }}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
