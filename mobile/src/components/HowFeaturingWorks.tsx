// What featuring actually does, in the seller's language.
//
// The old copy promised «اظهر في أعلى النتائج وبِع أسرع» and «سيظل في أعلى
// القائمة حتى {date}». The mechanism cannot deliver either:
//
//   - There are FEATURED_CAP (2) pinned slots at the top of a view, not a
//     place for everyone who paid.
//   - The two are drawn from the pool by `seed % pool.length`, so with ten
//     featured listings in Baghdad yours holds a slot on roughly two
//     refreshes in ten.
//   - Slots apply only to the default «الأحدث» sort and only to page one.
//     Price sorts, most-viewed and search ranking get no pinning at all.
//   - Losing the draw is DEMOTION into the normal recency stream, not hiding.
//
// Every one of those is good news badly told. "Sometimes at the very top,
// always in the feed" is a fair deal; "always at the top" is a promise that
// breaks on the seller's second refresh, and a seller who feels misled about
// 2,000 IQD does not buy the 10,000 one.
//
// The cap comes from the server (`/features/tiers`). When an older server
// omits it we describe the rotation WITHOUT a number rather than printing a
// hardcoded 2 that may since have drifted.

import React from 'react';
import { View, Text } from 'react-native';
import { theme, fonts, radius } from '../theme';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const n = (v: number) => String(v).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

export function HowFeaturingWorks({ cap }: { cap?: number | null }) {
  const lines = [
    cap && cap > 0
      ? `يظهر ${n(cap)} إعلانات مميّزة في أعلى التصفّح، وتتبدّل بين الإعلانات المميّزة مع كل تحديث.`
      : 'تظهر الإعلانات المميّزة في مواضع محدودة أعلى التصفّح، وتتبدّل بينها مع كل تحديث.',
    'إذا لم يظهر إعلانك في الأعلى بتحديث معيّن، يبقى ظاهراً في التصفّح بمكانه الطبيعي — لا يُخفى أبداً.',
    'المواضع المميّزة تخصّ ترتيب «الأحدث» والصفحة الأولى فقط؛ الترتيب حسب السعر أو الأكثر مشاهدة لا يتأثر.',
  ];

  return (
    <View style={{
      backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
      borderRadius: radius.lg, padding: 12, gap: 6, marginTop: 12,
    }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink, textAlign: 'right' }}>
        كيف يعمل التمييز؟
      </Text>
      {lines.map((l, i) => (
        <Text key={i} style={{
          fontFamily: fonts.ar, fontSize: 11.5, color: theme.subtle,
          textAlign: 'right', lineHeight: 18,
        }}>
          • {l}
        </Text>
      ))}
      {/* Said plainly, because it is the thing a seller will otherwise
          conclude on their own and resent. */}
      <Text style={{
        fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle,
        textAlign: 'right', lineHeight: 16, marginTop: 2,
      }}>
        التمييز يزيد فرص الظهور، ولا يضمن البيع.
      </Text>
    </View>
  );
}
