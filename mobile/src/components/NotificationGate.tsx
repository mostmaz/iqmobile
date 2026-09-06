// The "turn on notifications" surface, in one component so onboarding, chat
// and the last step of posting a listing all make the same promise in the
// same words.
//
// Two things it has to get right:
//
//   1. Say what the user GETS, not what we want. The reasons below are the
//      four things that actually go silent without this permission, phrased
//      as consequences to him.
//   2. Survive a denial. iOS gives one shot at the system prompt; after that
//      the only route is Settings. So when `canAskAgain` is false the CTA
//      changes to «افتح الإعدادات» and the copy stops pretending a tap here
//      will do anything. useNotificationPermission re-reads on foreground,
//      so coming back from Settings updates this in place.

import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { theme, fonts, radius } from '../theme';
import { Btn } from './ui';
import { IconBell, IconChat, IconRequest, IconTag, IconSpark } from './icons';
import { useNotificationPermission } from '../push/permission';

type Reason = { Icon: any; title: string; body: string };

const REASONS: Reason[] = [
  {
    Icon: IconChat,
    title: 'رسائل المشترين والبائعين',
    body: 'أهم سبب: من دون الإشعارات لن تعرف أن أحدهم راسلك، فتذهب الصفقة إلى غيرك.',
  },
  {
    Icon: IconRequest,
    title: 'العروض على طلباتك',
    body: 'تنشر طلب جهاز، فترد عليك المتاجر بعروضها — ويصلك إشعار بأول عرض.',
  },
  {
    Icon: IconTag,
    title: 'مشترٍ يبحث عن جهازك',
    body: 'إذا طلب أحدهم جهازاً لديك، ننبّهك فوراً لتكون أول من يرد.',
  },
  {
    Icon: IconSpark,
    title: 'انخفاض الأسعار',
    body: 'إذا انخفض سعر جهاز تتابعه، يصلك التنبيه قبل غيرك.',
  },
];

export function NotificationGate({
  title = 'فعّل الإشعارات',
  intro,
  required = false,
  onGranted,
  onSkip,
  skipLabel = 'لاحقاً',
  compactReasons = false,
}: {
  title?: string;
  intro?: string;
  /** Required gates never show a skip, and say plainly that this step is needed. */
  required?: boolean;
  onGranted?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  compactReasons?: boolean;
}) {
  const perm = useNotificationPermission();
  const [busy, setBusy] = React.useState(false);

  // A gate that is already satisfied should get out of the way immediately.
  React.useEffect(() => {
    if (!perm.loading && perm.granted) onGranted?.();
  }, [perm.loading, perm.granted]);

  const reasons = compactReasons ? REASONS.slice(0, 2) : REASONS;
  const blocked = !perm.canAskAgain && !perm.granted;

  async function enable() {
    if (busy) return;
    setBusy(true);
    try {
      if (blocked) { perm.openSettings(); return; }
      const ok = await perm.request();
      if (ok) onGranted?.();
      // If the OS said no, `perm` has already refreshed and `blocked` flips
      // this screen to the Settings route on the next render — no alert
      // needed, the button itself changes.
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 12, flexGrow: 1, justifyContent: 'center' }}>
        <View style={{
          alignSelf: 'center', width: 68, height: 68, borderRadius: 22,
          backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center',
          marginBottom: 18,
        }}>
          <IconBell size={32} color={theme.accent} sw={1.7} />
        </View>

        <Text style={{
          fontFamily: fonts.arBold, fontSize: 22, color: theme.ink,
          textAlign: 'center', marginBottom: 8, lineHeight: 32,
        }}>
          {title}
        </Text>

        <Text style={{
          fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
          textAlign: 'center', lineHeight: 22, marginBottom: 22,
        }}>
          {intro || 'الإشعارات هي وسيلتنا الوحيدة للوصول إليك. من دونها ستفوتك رسائل وعروض.'}
        </Text>

        <View style={{ gap: 10, marginBottom: 22 }}>
          {reasons.map((r) => (
            <View key={r.title} style={{
              flexDirection: 'row-reverse', gap: 11, alignItems: 'flex-start',
              backgroundColor: theme.surface, borderRadius: radius.xxl,
              borderWidth: 1, borderColor: theme.line, padding: 13,
            }}>
              <View style={{
                width: 34, height: 34, borderRadius: 11, backgroundColor: theme.chipBg,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <r.Icon size={16} color={theme.ink} sw={1.7} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}>
                  {r.title}
                </Text>
                <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', lineHeight: 19, marginTop: 3 }}>
                  {r.body}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {blocked ? (
          <View style={{
            backgroundColor: theme.accentSoft, borderRadius: radius.lg, padding: 12, marginBottom: 14,
          }}>
            <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.ink, textAlign: 'center', lineHeight: 20 }}>
              سبق أن رفضت الإشعارات، ولا يمكننا طلبها مرة أخرى من داخل التطبيق.
              {'\n'}افتح الإعدادات وفعّل «الإشعارات»، ثم عُد — وسيفتح تلقائياً.
            </Text>
          </View>
        ) : null}

        {/* Wrapped, not bare. `full` sets flex:1 on the button, which in a
            ROW distributes it evenly with siblings but in this COLUMN made
            it swallow every leftover pixel the centred content container
            had — rendering the CTA as a black slab a third of the screen
            tall. The wrapper's height is its content, so the button gets
            its natural size and still spans the width. */}
        <View>
          <Btn kind="primary" full busy={busy} onPress={enable}>
            {blocked ? 'افتح الإعدادات' : 'تفعيل الإشعارات'}
          </Btn>
        </View>

        {!required && onSkip ? (
          <View style={{ marginTop: 8 }}>
            <Btn kind="ghost" full onPress={onSkip}>{skipLabel}</Btn>
          </View>
        ) : null}

        {required ? (
          <Text style={{
            fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle,
            textAlign: 'center', marginTop: 12, lineHeight: 18,
          }}>
            يمكنك إيقافها في أي وقت من إعدادات جهازك.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
