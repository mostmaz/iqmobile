// Update wall + home overlay, both driven by GET /app-config.
//
// Two separate things share this component because they share a rule: at most
// one modal may ever be on screen, and the update wall always wins. Showing a
// sponsor promo on top of "your app no longer works" would be absurd, and two
// independent modals racing each other is how that happens.
//
// Everything fails open. If /app-config is unreachable, or malformed, or the
// version string is junk, the user gets the app — a marketplace that locks
// people out because a config request timed out is worse than one running an
// old build.

import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Linking, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Img } from './Img';
import { theme, fonts, radius } from '../theme';
import { getBaseUrl } from '../api/client';

const APP_VERSION: string = Constants.expoConfig?.version || '0';
const SEEN_KEY = 'iq_overlay_seen_version';

type Cfg = {
  update?: {
    min_supported_version?: string;
    nag_below_version?: string;
    android_url?: string;
    ios_url?: string;
  };
  overlay?: {
    version?: string;
    frequency?: 'once' | 'always';
    title?: string;
    body?: string;
    image?: string;
    cta_label?: string;
    cta_url?: string;
  } | null;
};

/** Numeric dotted compare — '0.1.10' is newer than '0.1.9'. */
function cmp(a = '0', b = '0') {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function AppGate() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [dismissedNag, setDismissedNag] = useState(false);
  const [overlaySeen, setOverlaySeen] = useState<string | null>(null);
  const [overlayClosed, setOverlayClosed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_KEY);
        if (alive) setOverlaySeen(seen);
      } catch { /* storage unavailable — treat as never seen */ }
      try {
        const res = await fetch(`${getBaseUrl()}/app-config`);
        const json = (await res.json()) as Cfg;
        if (alive) setCfg(json);
      } catch { /* fail open: no config, no gate */ }
    })();
    return () => { alive = false; };
  }, []);

  if (!cfg) return null;

  const storeUrl = Platform.OS === 'ios'
    ? (cfg.update?.ios_url || '')
    : (cfg.update?.android_url || '');
  const openStore = () => { if (storeUrl) Linking.openURL(storeUrl).catch(() => {}); };

  const min = cfg.update?.min_supported_version || '0';
  const nag = cfg.update?.nag_below_version || '0';
  const mustUpdate = cmp(APP_VERSION, min) < 0;
  const shouldNag = !mustUpdate && cmp(APP_VERSION, nag) < 0 && !dismissedNag;

  // The wall wins outright — it is not dismissible and nothing may sit above it.
  if (mustUpdate) {
    return (
      <Modal visible transparent animationType="fade">
        <View style={S.backdrop}>
          <View style={S.sheet}>
            <Text style={S.title}>حدّث التطبيق للمتابعة</Text>
            <Text style={S.body}>
              هذه النسخة من التطبيق لم تعد مدعومة. حدّثها من المتجر للاستمرار بالاستخدام.
            </Text>
            <Text style={S.version}>النسخة الحالية {APP_VERSION}</Text>
            <TouchableOpacity style={S.cta} onPress={openStore} activeOpacity={0.85}>
              <Text style={S.ctaText}>
                {Platform.OS === 'ios' ? 'تحديث من App Store' : 'تحديث من Google Play'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  if (shouldNag) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setDismissedNag(true)}>
        <View style={S.backdrop}>
          <View style={S.sheet}>
            <Text style={S.title}>يتوفّر تحديث جديد</Text>
            <Text style={S.body}>
              حدّث التطبيق للحصول على آخر التحسينات وأسرع أداء.
            </Text>
            <TouchableOpacity style={S.cta} onPress={openStore} activeOpacity={0.85}>
              <Text style={S.ctaText}>تحديث الآن</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDismissedNag(true)} activeOpacity={0.7}>
              <Text style={S.later}>لاحقاً</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ── overlay ──
  const ov = cfg.overlay;
  if (!ov || overlayClosed) return null;
  // 'once' means once per overlay VERSION, not once ever: bumping the version
  // in the dashboard is how a new promo reaches people who dismissed the last.
  if (ov.frequency !== 'always' && overlaySeen === (ov.version || '1')) return null;

  const close = () => {
    setOverlayClosed(true);
    if (ov.frequency !== 'always') {
      AsyncStorage.setItem(SEEN_KEY, ov.version || '1').catch(() => {});
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={S.backdrop}>
        <View style={S.sheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {ov.image ? (
              <Img
                source={{ uri: ov.image }}
                style={{ width: '100%', aspectRatio: 5 / 2, borderRadius: radius.lg, marginBottom: 14 }}
              />
            ) : null}
            {ov.title ? <Text style={S.title}>{ov.title}</Text> : null}
            {ov.body ? <Text style={S.body}>{ov.body}</Text> : null}
          </ScrollView>
          {ov.cta_label && ov.cta_url ? (
            <TouchableOpacity
              style={S.cta}
              activeOpacity={0.85}
              onPress={() => { Linking.openURL(ov.cta_url!).catch(() => {}); close(); }}
            >
              <Text style={S.ctaText}>{ov.cta_label}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={close} activeOpacity={0.7}>
            <Text style={S.later}>إغلاق</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const S = {
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  sheet: {
    width: '100%', maxWidth: 420, maxHeight: '84%', backgroundColor: theme.bg,
    borderRadius: radius.xxl, padding: 22,
  },
  title: {
    fontFamily: fonts.arBold, fontSize: 19,
    color: theme.ink, textAlign: 'center', marginBottom: 8 },
  body: {
    fontFamily: fonts.ar, fontSize: 14.5, lineHeight: 23,
    color: theme.subtle, textAlign: 'center', marginBottom: 8,
  },
  version: {
    fontFamily: fonts.ltr, fontSize: 12, color: theme.subtle,
    textAlign: 'center', marginBottom: 16,
  },
  cta: {
    backgroundColor: theme.accent, borderRadius: radius.lg,
    paddingVertical: 14, alignItems: 'center', marginTop: 10,
  },
  ctaText: { fontFamily: fonts.arBold, fontSize: 15, color: '#fff' },
  later: {
    fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
    textAlign: 'center', paddingVertical: 14,
  },
} as const;
