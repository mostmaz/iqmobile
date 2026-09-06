// What a listing's numbers mean, and the one thing to do about it.
//
// `advice` is a REQUIRED prop, and it is the only way a metric reaches the
// screen. That is deliberate and copied from the operator dashboard, where
// DeviceDiagnostic takes `reason` as a required prop for the same reason:
// it makes "12 views" with no explanation impossible to render by accident.
// The server decides the verdict; this file only knows how to say it.
//
// One card, one action. A seller handed four things to fix does none.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius } from '../theme';
import type { ListingAdviceData } from '../api/endpoints';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Counts read as Arabic-Indic in prose; prices stay Western via fmtIQD. */
const n = (v: number) => String(v).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

/** Headline + advice for each verdict. Server picks the id; wording lives here. */
function copyFor(a: ListingAdviceData): { title: string; advice: string; cta?: string } | null {
  const m: any = a.metric || {};
  switch (a.id) {
    case 'unanswered_inquiries':
      return {
        title: m.unanswered === 1
          ? 'مشترٍ ينتظر ردّك'
          : `${n(m.unanswered)} مشترين ينتظرون ردّك`,
        advice: m.waiting_days != null && m.waiting_days > 0
          ? `أقدم رسالة من ${n(m.waiting_days)} ${m.waiting_days === 1 ? 'يوم' : 'أيام'}. الردّ السريع هو أكثر ما يقرّر من يبيع.`
          : 'الردّ السريع هو أكثر ما يقرّر من يبيع.',
        cta: 'افتح المحادثات',
      };

    case 'low_views':
      return a.reason === 'few_photos'
        ? {
          title: `${n(m.views)} مشاهدة خلال ${n(m.window_days)} يوماً`,
          advice: `إعلانك فيه ${n(m.photos)} ${m.photos === 1 ? 'صورة' : 'صور'}. الإعلانات ذات الصور الأوضح تظهر أكثر ويفتحها المشترون أكثر.`,
          cta: 'أضف صوراً',
        }
        : {
          title: `${n(m.views)} مشاهدة خلال ${n(m.window_days)} يوماً`,
          advice: 'قلّة المشاهدات تعني أن المشترين لا يصلون إلى إعلانك. تأكّد من صحة الماركة والموديل والمحافظة، وأضف وصفاً أوضح.',
          cta: 'عدّل الإعلان',
        };

    case 'views_no_inquiry':
      if (a.reason === 'price_high') {
        return {
          title: `${n(m.views)} مشاهدة، بلا تواصل`,
          advice: `سعرك أعلى بـ ${n(m.price_delta_pct)}٪ من أجهزة مماثلة في السوق. المشترون يشوفون الإعلان ثم يقارنون.`,
          cta: 'راجع السعر',
        };
      }
      return a.reason === 'few_photos'
        ? {
          title: `${n(m.views)} مشاهدة، بلا تواصل`,
          advice: `المشترون يفتحون الإعلان ولا يتواصلون. عندك ${n(m.photos)} ${m.photos === 1 ? 'صورة' : 'صور'} — صور أوضح للواجهة والظهر والجوانب تبني الثقة.`,
          cta: 'أضف صوراً',
        }
        : {
          title: `${n(m.views)} مشاهدة، بلا تواصل`,
          advice: 'المشترون يفتحون الإعلان ولا يتواصلون. راجع السعر والصور والوصف — غالباً أحدها هو السبب.',
          cta: 'عدّل الإعلان',
        };

    case 'ok':
      return {
        title: 'إعلانك يشتغل تمام',
        advice: `${n(m.views)} مشاهدة و${n(m.inquiries)} تواصل خلال ${n(m.window_days)} يوماً.`,
      };

    default:
      return null;
  }
}

const TONE = {
  urgent: { bg: theme.accentSoft, border: theme.accent, ink: theme.accent },
  warn: { bg: theme.surface, border: theme.line, ink: theme.ink },
  ok: { bg: theme.surface, border: theme.line, ink: theme.subtle },
} as const;

export function ListingAdvice({
  advice,
  onAct,
  compact,
}: {
  /** Required — a metric never reaches the screen without its reason. */
  advice: ListingAdviceData;
  onAct?: (action: string) => void;
  compact?: boolean;
}) {
  const copy = copyFor(advice);
  if (!copy) return null;
  const tone = TONE[advice.severity] ?? TONE.warn;

  return (
    <View style={{
      backgroundColor: tone.bg,
      borderWidth: 1,
      borderColor: tone.border,
      borderRadius: radius.lg,
      padding: compact ? 10 : 13,
      gap: 5,
    }}>
      <Text style={{
        fontFamily: fonts.arBold, fontSize: compact ? 12.5 : 13.5,
        color: tone.ink, textAlign: 'right',
      }}>
        {copy.title}
      </Text>
      <Text style={{
        fontFamily: fonts.ar, fontSize: compact ? 11.5 : 12.5,
        color: theme.subtle, textAlign: 'right', lineHeight: compact ? 18 : 20,
      }}>
        {copy.advice}
      </Text>
      {copy.cta && onAct && advice.action ? (
        <TouchableOpacity
          onPress={() => onAct(advice.action!)}
          accessibilityRole="button"
          style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
        >
          <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.accent }}>
            {copy.cta}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
