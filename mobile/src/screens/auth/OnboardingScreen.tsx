// Onboarding — single-track redesign (Unified Account model).
//
// The previous version had two parallel cards (buyer / seller tracks) that
// implicitly asked the user to declare a side before signing up. The
// unified-account redesign removes that fork: one app, one identity, both
// sides live in the same account.
//
// Layout, top → bottom:
//   1. iQ logo + "بثقة · محلي" eyebrow
//   2. Hero copy: "سوق الموبايلات. محلي · صادق · بحساب واحد."
//   3. Subhead acknowledging there's no type to pick
//   4. "Four Moves" card — تصفح / انشر / تواصل / رقمك محمي
//   5. Trust micro-strip — عراقي 100% · حساب واحد
//   6. Pinned CTAs — primary "ابدأ التصفح", secondary "تسجيل الدخول"
//
// Used as both the first-launch gate (with onDone) and as a re-viewable
// stack screen reachable from Profile (with navigation).

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from '../../lib/secureStore';
import { theme, fonts, radius, shadowAccent } from '../../theme';
import { Btn } from '../../components/ui';
import {
  IconArrowLeft, IconSearch, IconCamera, IconChat, IconStar, IconPin,
} from '../../components/icons';
import { detectGovernorate } from '../../lib/locateGov';
import { GOV_AR_LIST, GOV_AR_TO_EN } from '../../lib/governorates';
import { Auth } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';

// Bumping the suffix re-runs onboarding once for existing installs since
// the screen content has changed materially.
export const ONBOARDED_KEY = 'iq2_onboarded_v3';

export default function OnboardingScreen({ onDone, navigation }: { onDone?: () => void; navigation?: any }) {
  const insets = useSafeAreaInsets();
  const isRevisit = !onDone;
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  // When location is denied / undetectable we force a manual governorate
  // pick before the user can enter the app (obligatory — no skip path).
  const [govPickerOpen, setGovPickerOpen] = useState(false);

  // First-launch gate: ask for location → if granted, reverse-geocode →
  // patch the user's governorate so Browse + Post default to their actual
  // province. Skipping (denied / failed) leaves the default 'Baghdad' the
  // server assigned at guest-signup time.
  // Primary action: auto-detect the governorate from location. On success we
  // set it and enter the app. If the user denies the permission (or we can't
  // resolve it) we no longer fall back to the default — we open an obligatory
  // manual picker (govPickerOpen) the user must answer before continuing.
  // The busy-lock guards every entry point so a double-tap can't fire two
  // parallel onDone() invocations (which would race the SecureStore write
  // and double-mount RootNav's main subtree).
  async function start() {
    if (busy) return;
    if (!onDone) { navigation?.goBack(); return; }
    setBusy(true);
    try {
      const detected = await detectGovernorate();
      if (detected) {
        try {
          await Auth.patchMe({ governorate: detected.governorate, city: detected.city || undefined });
          await refresh();
        } catch {}
        try { await SecureStore.setItem(ONBOARDED_KEY, '1'); } catch {}
        onDone();
      } else {
        // Denied / undetectable → require a manual selection to continue.
        setGovPickerOpen(true);
      }
    } catch {
      setGovPickerOpen(true);
    } finally { setBusy(false); }
  }

  // Secondary action: skip location and pick by hand. Still obligatory —
  // there's no "decide later" path now.
  function selectManually() {
    if (busy) return;
    if (!onDone) { navigation?.goBack(); return; }
    setGovPickerOpen(true);
  }

  // Commit a hand-picked governorate (Arabic label → English value), then
  // enter the app.
  async function pickGovernorate(govAr: string) {
    if (busy) return;
    setBusy(true);
    try {
      const govEn = GOV_AR_TO_EN[govAr];
      if (govEn) {
        try { await Auth.patchMe({ governorate: govEn }); await refresh(); } catch {}
      }
      try { await SecureStore.setItem(ONBOARDED_KEY, '1'); } catch {}
      setGovPickerOpen(false);
      onDone?.();
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* ambient decorations */}
      <View pointerEvents="none" style={{
        position: 'absolute', top: -40, right: -60, width: 240, height: 240, borderRadius: 999,
        backgroundColor: theme.accent, opacity: 0.10,
      }} />
      <View pointerEvents="none" style={{
        position: 'absolute', bottom: 80, left: -100, width: 220, height: 220, borderRadius: 999,
        backgroundColor: theme.ink, opacity: 0.04,
      }} />

      {/* re-visit back button (top-right) — only when revisiting from Profile */}
      {isRevisit ? (
        <TouchableOpacity
          onPress={() => navigation?.goBack()}
          activeOpacity={0.7}
          style={{
            position: 'absolute', zIndex: 10,
            top: insets.top + 14, right: 14,
            width: 38, height: 38, borderRadius: 999,
            backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <IconArrowLeft size={20} color={theme.ink} sw={1.7} />
          </View>
        </TouchableOpacity>
      ) : null}

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 18,
          paddingHorizontal: 22,
          minHeight: '100%',
          gap: 14,
        }}
      >
        {/* logo + eyebrow */}
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
          <View style={[{
            width: 36, height: 36, borderRadius: 10, backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center',
          }, shadowAccent]}>
            <Text style={{ color: '#fff', fontFamily: fonts.ltrBold, fontWeight: '700', fontSize: 14, letterSpacing: -0.5 }}>iQ</Text>
          </View>
          <View>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink }}>IQ Mobile</Text>
            <Text style={{
              marginTop: 2, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4,
              textTransform: 'uppercase', color: theme.subtle,
            }}>
              بثقة · محلي
            </Text>
          </View>
        </View>

        {/* hero copy */}
        <View style={{ marginTop: 4 }}>
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 28,
            letterSpacing: -0.6, lineHeight: 34, color: theme.ink, textAlign: 'right' }}>
            سوق الموبايلات.{'\n'}
            <Text style={{ color: theme.accent }}>محلي · صادق · بحساب واحد.</Text>
          </Text>
          <Text style={{
            marginTop: 12, fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
            lineHeight: 22, textAlign: 'right',
          }}>
            تشتري وتبيع من نفس المكان. ما تحتاج تختار نوع الحساب — كل المستخدمين متساوون.
          </Text>
        </View>

        {/* Four Moves card */}
        <View style={{
          marginTop: 4,
          backgroundColor: theme.surface,
          borderColor: theme.line, borderWidth: 1, borderRadius: 18,
          padding: 4,
          shadowColor: '#261C0E', shadowOpacity: 0.05, shadowRadius: 32, shadowOffset: { width: 0, height: 14 },
          elevation: 2,
        }}>
          <Move icon={<IconSearch size={16} color={theme.ink} sw={1.7} />}
            title="تصفح" sub="آلاف الإعلانات بحسب الماركة والمحافظة" />
          <Move icon={<IconCamera size={16} color={theme.ink} sw={1.7} />}
            title="انشر" sub="صور هاتفك وأضف السعر بسرعة" divider />
          <Move icon={<IconChat size={16} color={theme.ink} sw={1.7} />}
            title="تواصل" sub="اتصال أو واتساب مباشرة من الإعلان" divider />
          <Move icon={<IconStar size={16} color={theme.ink} sw={1.7} />}
            title="بدون حساب" sub="ابدأ التصفح والنشر مباشرة، بلا تسجيل" divider />
        </View>

        {/* Trust micro-strip */}
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingVertical: 12,
          borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(27,26,24,0.14)',
          borderRadius: 12,
        }}>
          <TrustChip>عراقي 100%</TrustChip>
          <Dot />
          <TrustChip>حساب واحد</TrustChip>
        </View>

        {/* CTAs pinned to bottom. The primary action requests location so
            we can auto-fill the user's governorate before they hit Browse;
            "تخطي" lets them skip in case they decline the OS prompt. */}
        <View style={{ marginTop: 'auto', gap: 8 }}>
          {!isRevisit ? (
            <>
              <Btn kind="accent" full onPress={start} busy={busy}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                  <IconPin size={14} color="#fff" sw={1.7} />
                  <Text style={{ color: '#fff', fontFamily: fonts.arBold, fontSize: 14 }}>
                    حدد محافظتي وابدأ
                  </Text>
                </View>
              </Btn>
              <Btn kind="ghost" full onPress={selectManually} busy={busy}>أختر محافظتي يدوياً</Btn>
            </>
          ) : (
            <Btn kind="accent" full onPress={start}>تم</Btn>
          )}
        </View>
      </ScrollView>

      {/* Obligatory governorate picker — shown when location is denied or the
          user chooses to pick by hand. Non-dismissible: there's no close
          button and Android back is a no-op, so the only way forward is to
          select a governorate. */}
      <Modal visible={govPickerOpen} animationType="slide" transparent onRequestClose={() => { /* obligatory */ }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: theme.bg,
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            paddingTop: 16, paddingBottom: insets.bottom + 16, maxHeight: '80%',
          }}>
            <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 18, color: theme.ink, textAlign: 'right' }}>
                حدد محافظتك
              </Text>
              <Text style={{ marginTop: 4, fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right', lineHeight: 21 }}>
                لم نتمكن من تحديد موقعك. اختر محافظتك للمتابعة — ستظهر لك الإعلانات القريبة منك.
              </Text>
            </View>
            <FlatList
              data={GOV_AR_LIST}
              keyExtractor={(g) => g}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.line, marginHorizontal: 20 }} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => pickGovernorate(item)}
                  activeOpacity={0.7}
                  disabled={busy}
                  style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 14 }}
                >
                  <IconPin size={15} color={theme.accent} sw={1.7} />
                  <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 15, color: theme.ink, textAlign: 'right' }}>
                    {item}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Move({ icon, title, sub, divider }: {
  icon: React.ReactNode; title: string; sub: string; divider?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
      paddingVertical: 12, paddingHorizontal: 12,
      borderTopWidth: divider ? 1 : 0, borderColor: theme.line,
    }}>
      <View style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        backgroundColor: theme.chipBg,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right' }}>
          {title}
        </Text>
        <Text style={{ marginTop: 1, fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, lineHeight: 18, textAlign: 'right' }}>
          {sub}
        </Text>
      </View>
    </View>
  );
}

function TrustChip({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: fonts.arBold, fontSize: 11.5, color: theme.ink, textAlign: 'center' }}>
      {children}
    </Text>
  );
}
function Dot() {
  return <View style={{ width: 4, height: 4, borderRadius: 999, backgroundColor: 'rgba(27,26,24,0.14)' }} />;
}
