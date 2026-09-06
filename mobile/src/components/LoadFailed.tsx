// "We couldn't load this" — with a way out.
//
// Three screens needed this and only SearchScreen had it, so Browse and the
// listing page each failed in their own worse way: Browse rendered «لا توجد
// إعلانات», telling the user the marketplace was empty when their phone was
// offline, and the listing page shimmered forever because `!data` and "failed"
// were the same branch. Both are the same mistake — treating an error as an
// absence — and both are fixed by having one component that says which it is.
//
// The timeout/error split comes from client.ts, which sets `isTimeout` on an
// abort it caused and `isNetwork` on a transport failure. A stalled connection
// and a dead one call for different words: "this is taking too long" invites
// waiting, "we can't reach the server" invites checking the connection.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius } from '../theme';

export function LoadFailed({
  error,
  onRetry,
  retrying,
  title,
  compact,
}: {
  error?: unknown;
  onRetry: () => void;
  retrying?: boolean;
  /** Overrides the headline; the body and button stay. */
  title?: string;
  compact?: boolean;
}) {
  const isTimeout = !!(error as any)?.isTimeout;
  const headline = title ?? (isTimeout ? 'الاتصال بطيء' : 'تعذّر تحميل المحتوى');
  const body = isTimeout
    ? 'استغرق التحميل وقتاً أطول من المعتاد. حاول مرة أخرى.'
    : 'تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.';

  return (
    <View style={{ paddingVertical: compact ? 28 : 40, paddingHorizontal: 32, alignItems: 'center', gap: 10 }}>
      <Text style={{ fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'center' }}>
        {headline}
      </Text>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center', lineHeight: 20 }}>
        {body}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        disabled={retrying}
        activeOpacity={0.85}
        accessibilityRole="button"
        style={{
          marginTop: 4, paddingHorizontal: 22, paddingVertical: 11,
          borderRadius: radius.pill, backgroundColor: theme.ink,
          opacity: retrying ? 0.6 : 1,
        }}
      >
        <Text style={{ fontFamily: fonts.arBold, fontSize: 13.5, color: theme.buttonInk }}>
          {retrying ? 'جاري المحاولة…' : 'إعادة المحاولة'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
