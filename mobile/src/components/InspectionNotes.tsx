// What the photo check saw, told to the seller.
//
// `evidence` has been generated since inspections shipped as "one short
// Arabic sentence a seller would understand" — written for a seller-facing
// surface that never got built. Until now the only feedback was silent
// removal: the ad disappeared and nothing said why.
//
// Renders NOTHING when there is no verdict. Both inspection switches default
// off, so on most installs there is nothing to say, and an empty "we checked
// your photos" card would be worse than silence.
//
// It reports, it does not accuse. `source` (description vs image) is left on
// the server deliberately — telling a seller "we saw this in your photo"
// reads as a challenge, and the useful half is the sentence either way.

import React from 'react';
import { View, Text } from 'react-native';
import { theme, fonts, radius } from '../theme';

export interface InspectionData {
  verdict: string;
  confidence: string;
  notes: { kind: string; evidence: string }[];
}

export function InspectionNotes({ inspection }: { inspection?: InspectionData | null }) {
  const notes = inspection?.notes ?? [];
  if (!notes.length) return null;

  // A low-confidence read is a hint, not a finding, and saying so stops the
  // seller arguing with a machine that is itself unsure.
  const unsure = inspection?.confidence === 'low';

  return (
    <View style={{
      backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.line,
      borderRadius: radius.lg, padding: 12, gap: 6,
    }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 12.5, color: theme.ink, textAlign: 'right' }}>
        {unsure ? 'ملاحظات محتملة على الصور' : 'ملاحظات على صور الإعلان'}
      </Text>
      {notes.map((n, i) => (
        <Text key={`${n.kind}-${i}`} style={{
          fontFamily: fonts.ar, fontSize: 12, color: theme.subtle,
          textAlign: 'right', lineHeight: 19,
        }}>
          • {n.evidence}
        </Text>
      ))}
      <Text style={{
        fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle,
        textAlign: 'right', marginTop: 2,
      }}>
        {unsure
          ? 'فحص آلي غير مؤكد. إذا كان الوصف صحيحاً فلا حاجة لأي تغيير.'
          : 'فحص آلي للصور والوصف. أضف صوراً أوضح أو عدّل الوصف إذا كانت الملاحظة غير دقيقة.'}
      </Text>
    </View>
  );
}
