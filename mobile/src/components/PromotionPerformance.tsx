// What happened while the listing was promoted.
//
// The one rule: report the window, never claim the promotion caused it.
//
// The default feed orders by created_at DESC, so a listing's view rate decays
// with age whether or not anyone paid. "After beat before" would therefore
// look like a win for a listing nobody promoted — which is exactly why the
// server sends no lift and this component computes none. `before` renders as
// context, in the same muted weight, with the reason stated underneath.
//
// Saying "we can't attribute this" costs a seller nothing and buys the number
// its credibility. A fabricated +300% sells one promotion and burns the screen.

import React from 'react';
import { View, Text } from 'react-native';
import { theme, fonts, radius } from '../theme';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const n = (v: number) => String(v).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

export interface PromotionData {
  pending: boolean;
  from: number;
  until: number;
  active: boolean;
  days?: number;
  during?: { views: number; contacts: number };
  before?: { views: number; contacts: number } | null;
  caveats?: string[];
}

export function PromotionPerformance({ promotion }: { promotion?: PromotionData | null }) {
  if (!promotion) return null;

  if (promotion.pending) {
    // "0 views" on a promotion bought this morning is a refund request
    // waiting to happen, and hours of data are noise anyway.
    return (
      <Card>
        <Text style={title}>الترويج قيد التشغيل</Text>
        <Text style={body}>نعرض النتائج بعد مرور يوم كامل.</Text>
      </Card>
    );
  }

  const d = promotion.during!;
  const b = promotion.before;

  return (
    <Card>
      <Text style={title}>
        {promotion.active ? 'خلال فترة الترويج' : 'نتائج فترة الترويج'}
      </Text>
      <Text style={body}>
        {`${n(d.views)} مشاهدة و${n(d.contacts)} تواصل خلال ${n(promotion.days || 1)} ${(promotion.days || 1) === 1 ? 'يوم' : 'أيام'}.`}
      </Text>
      {b ? (
        <Text style={body}>
          {`في نفس المدة قبل الترويج: ${n(b.views)} مشاهدة و${n(b.contacts)} تواصل.`}
        </Text>
      ) : null}
      {/* The caveat is not fine print — it is the reason the number above is
          worth believing. */}
      <Text style={note}>
        المشاهدات تقلّ طبيعياً كلما قدُم الإعلان، لذا لا يمكن نسب الفرق إلى
        الترويج وحده.
      </Text>
      {promotion.caveats?.includes('saves_undercount') ? (
        <Text style={note}>لا تشمل الأرقام من حفظ الإعلان ثم ألغى الحفظ.</Text>
      ) : null}
    </Card>
  );
}

const title = {
  fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink, textAlign: 'right',
} as const;
const body = {
  fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', lineHeight: 19,
} as const;
const note = {
  fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle, textAlign: 'right', lineHeight: 16,
} as const;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
      borderRadius: radius.lg, padding: 12, gap: 5,
    }}>
      {children}
    </View>
  );
}
