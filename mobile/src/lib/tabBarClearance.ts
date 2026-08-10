// How much bottom padding a scrolling screen needs to clear the tab bar.
//
// The tab bar floats over the bottom of every screen inside the tabs, so a
// list whose content ends at 0 has its last row sliced in half. Screens were
// each guessing — Browse used 100, the listing detail used insets.bottom + 24
// (about 48, nowhere near enough), and the detail page's primary CTA sat
// under the bar at rest as a result.
//
// React Navigation measures the real rendered tab bar and publishes it on
// BottomTabBarHeightContext, so use that instead of a constant that silently
// goes stale the next time the bar's padding changes. We read the CONTEXT
// rather than call useBottomTabBarHeight(), because the hook throws outside a
// tab navigator and some of these screens are also reachable from modal
// stacks.
//
// The extra allowance covers the Sell pill, which is pulled 8pt above the
// bar's own top edge, plus a little breathing room so content stops short of
// the bar rather than kissing it.

import { useContext } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Sell button overhang (8) + visual breathing room (16). */
const EXTRA = 24;

/** Fallback used only when the context is missing (screen outside the tabs). */
const FALLBACK_BAR = 68;

export function useTabBarClearance(extra = EXTRA): number {
  const measured = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  const bar = measured ?? FALLBACK_BAR + insets.bottom;
  return bar + extra;
}
