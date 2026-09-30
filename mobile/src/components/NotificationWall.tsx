// The app-wide "turn on notifications" wall.
//
// This is NOT a second gate screen — it is NotificationGate, the one that
// already serves onboarding, chat and the post-listing step, put behind a
// Modal so it covers the whole app. The reasons, the denial handling and the
// return-from-Settings refresh all live there and are not repeated here.
//
// ── Why a wall at all ──────────────────────────────────────────────────
//
// Measured on production on 30 Sep 2026: 1,542 of the 1,873 chats with
// activity in the previous 30 days never got a reply from the seller, 1,317
// sellers were sitting on a buyer message more than three days old, and 363
// of those had no push token at all — nothing we sent could ever have
// reached them. A seller who cannot hear the buyer has no marketplace.
//
// ── Android hard, iOS soft, deliberately ───────────────────────────────
//
// App Store guideline 4.5.4: push notifications must not be REQUIRED for an
// app to function. A wall with no way past it is a rejection risk on iOS, so
// iOS gets «لاحقاً» and Android does not. Both modes come from the server
// (`push_gate.android` / `push_gate.ios`), so if review objects anyway the
// answer is a dashboard toggle rather than a build and a re-review.
//
// ── Fails open ─────────────────────────────────────────────────────────
//
// Unreachable or malformed config → mode stays 'off' → nobody is walled.
// Locking a marketplace because a config request timed out is worse than the
// notifications it was protecting. Same stance as AppGate, which it sits by.
import React, { useEffect, useState } from 'react';
import { Modal, Platform } from 'react-native';
import { getBaseUrl } from '../api/client';
import { useNotificationPermission } from '../push/permission';
import { NotificationGate } from './NotificationGate';

type Mode = 'hard' | 'soft' | 'off';

export function NotificationWall() {
  const [mode, setMode] = useState<Mode>('off');
  const [skipped, setSkipped] = useState(false);
  const perm = useNotificationPermission();

  // Fetched once. A value that is a session stale is fine; a wall that
  // flickers with every network blip is not.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${getBaseUrl()}/app-config`);
        const json = await res.json();
        const mine = Platform.OS === 'ios' ? json?.push_gate?.ios : json?.push_gate?.android;
        if (alive && (mine === 'hard' || mine === 'soft' || mine === 'off')) setMode(mine);
      } catch { /* stays 'off' — nobody is walled by a failed request */ }
    })();
    return () => { alive = false; };
  }, []);

  // perm.loading matters: readPermission's failure path reports "not granted,
  // can still ask", and flashing a wall for a frame before the real answer
  // arrives would be the app's first impression on every cold start.
  if (mode === 'off' || perm.loading || perm.granted) return null;
  if (mode === 'soft' && skipped) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={() => { /* back must not dismiss a wall */ }}>
      <NotificationGate
        required={mode === 'hard'}
        title="فعّل الإشعارات للمتابعة"
        intro="iQ Mobile يوصلك خبر المشتري بالإشعارات. من دونها راح تفوتك رسائل وعروض على أجهزتك."
        onSkip={mode === 'soft' ? () => setSkipped(true) : undefined}
        skipLabel="لاحقاً"
      />
    </Modal>
  );
}
