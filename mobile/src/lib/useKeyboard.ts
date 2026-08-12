// Keyboard height, because Android can no longer be trusted to move the view.
//
// The app is edge-to-edge (`edgeToEdgeEnabled=true`, required from Android
// 15). Under edge-to-edge the window is NOT resized when the IME opens, so
// `android:windowSoftInputMode="adjustResize"` — which is set, and which used
// to be enough — stops moving anything. Content keeps its full-screen height
// and the keyboard is drawn over the bottom of it, which is why a chat
// composer ends up underneath the keys.
//
// KeyboardAvoidingView with `behavior={undefined}` (the old Android branch)
// is a no-op, so it never compensated. Rather than trust that component's
// per-platform behaviour, measure the keyboard directly and let callers pad
// by the exact amount.

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS gets the Will* events, which are animated and land before the
    // keyboard moves; Android only reliably emits the Did* pair.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvt, (e) => {
      setHeight(e.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return height;
}

/**
 * Bottom padding for a bar pinned to the bottom of the screen.
 *
 * While the keyboard is closed this is the safe-area inset, so the bar clears
 * the gesture pill. While it is open the inset is WRONG — the keyboard
 * already covers that strip, and adding both leaves a visible gap of dead
 * space between the composer and the keys.
 */
export function bottomBarPadding(keyboardHeight: number, safeBottom: number, base = 8): number {
  return keyboardHeight > 0 ? base : base + safeBottom;
}
