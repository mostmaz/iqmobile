// A confirmation dialog that belongs to this app.
//
// Alert.alert renders the platform's own dialog: on Android that is a dark
// grey Material sheet with square corners and cyan text buttons, dropped
// into an app that is otherwise cream, black and terracotta with heavily
// rounded shapes. The cyan appears nowhere else in the product.
//
// It also gets the RTL button order wrong for a destructive choice. Alert
// lays buttons out left-to-right, so in an RTL reading order the DESTRUCTIVE
// option lands where the eye arrives first, styled identically to the safe
// one. Here the safe choice is the filled, prominent button and the
// destructive one is plain text in the danger colour — the standard
// weighting, applied the right way round for Arabic.

import React from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity } from 'react-native';
import { theme, fonts, radius } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ConfirmSheet({
  visible, title, body, confirmText, cancelText = 'إلغاء',
  destructive, onConfirm, onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmText: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* Tapping the scrim cancels — the safe action, never the destructive
          one, so a stray tap can't discard anything. */}
      <Pressable
        onPress={onCancel}
        style={{ flex: 1, backgroundColor: 'rgba(20,19,17,0.45)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: theme.bg,
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            paddingHorizontal: 20, paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
          }}
        >
          <View style={{
            alignSelf: 'center', width: 38, height: 4, borderRadius: 999,
            backgroundColor: theme.line, marginBottom: 16,
          }} />
          <Text style={{
            fontFamily: fonts.arBold, fontSize: 17,
            color: theme.ink, textAlign: 'right' }}>
            {title}
          </Text>
          {body ? (
            <Text style={{
              fontFamily: fonts.ar, fontSize: 13.5, color: theme.subtle,
              textAlign: 'right', lineHeight: 21, marginTop: 8,
            }}>
              {body}
            </Text>
          ) : null}

          {/* Keep going is the filled button; the destructive path is
              deliberately the quieter of the two. */}
          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.85}
            style={{
              marginTop: 20, borderRadius: radius.lg, paddingVertical: 15,
              backgroundColor: theme.ink, alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.bg }}>
              {cancelText}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onConfirm}
            activeOpacity={0.7}
            style={{ marginTop: 6, borderRadius: radius.lg, paddingVertical: 15, alignItems: 'center' }}
          >
            <Text style={{
              fontFamily: fonts.arBold, fontSize: 14.5,
              color: destructive ? theme.danger : theme.ink }}>
              {confirmText}
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
