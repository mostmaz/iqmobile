// A form driven by a field spec, so "every field the server accepts" is a
// list rather than sixteen hand-written inputs per screen.
//
// The web dashboard edits listings across 16 fields and shops across 17.
// Writing those twice by hand guarantees drift — the app would silently
// support a subset, and nobody would notice which until a shop needed a
// field that only exists on the desktop.

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Switch, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, fonts, radius } from '../theme';

export type FieldSpec = {
  key: string;
  label: string;
  type: 'text' | 'multiline' | 'number' | 'money' | 'bool' | 'select' | 'phone';
  options?: { value: string; label: string }[];
  hint?: string;
  /** Shown but not editable — context the operator needs while deciding. */
  readOnly?: boolean;
};

export function RecordEditor({
  visible, title, subtitle, specs, initial, busy, onClose, onSave, extra,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  specs: FieldSpec[];
  initial: Record<string, any>;
  busy?: boolean;
  onClose: () => void;
  onSave: (patch: Record<string, any>) => void;
  /** Anything that isn't a plain field — images, specs lists, actions. */
  extra?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [vals, setVals] = useState<Record<string, any>>({});

  // Re-seed whenever the record changes, or the form keeps the previous
  // record's values and a blind Save writes them onto this one.
  useEffect(() => {
    if (!visible) return;
    const next: Record<string, any> = {};
    for (const s of specs) next[s.key] = initial?.[s.key] ?? (s.type === 'bool' ? false : '');
    setVals(next);
  }, [visible, initial, specs]);

  const set = (k: string, v: any) => setVals((p) => ({ ...p, [k]: v }));

  function save() {
    // Send only what actually changed. A full-object PATCH would rewrite
    // fields the operator never looked at, which on a shared record is how
    // one person's edit quietly reverts another's.
    const patch: Record<string, any> = {};
    for (const s of specs) {
      if (s.readOnly) continue;
      const before = initial?.[s.key];
      const after = vals[s.key];
      if (s.type === 'bool') {
        if (!!before !== !!after) patch[s.key] = !!after;
        continue;
      }
      if (s.type === 'number' || s.type === 'money') {
        const n = String(after ?? '').trim() === '' ? null : Number(String(after).replace(/\D/g, ''));
        if (n !== (before ?? null)) patch[s.key] = n;
        continue;
      }
      const a = String(after ?? '').trim();
      const b = String(before ?? '').trim();
      if (a !== b) patch[s.key] = a === '' ? null : a;
    }
    onSave(patch);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
          paddingHorizontal: 16, paddingVertical: 12,
          borderBottomWidth: 1, borderBottomColor: theme.line,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink, textAlign: 'right' }}>
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right', marginTop: 2 }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="إغلاق"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 22, color: theme.subtle }}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 110 }}
          keyboardShouldPersistTaps="handled"
        >
          {specs.map((s) => (
            <Field key={s.key} spec={s} value={vals[s.key]} onChange={(v) => set(s.key, v)} />
          ))}
          {extra}
        </ScrollView>

        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: 16, paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 12),
          backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.line,
          flexDirection: 'row-reverse', gap: 8,
        }}>
          <TouchableOpacity
            disabled={busy}
            onPress={save}
            activeOpacity={0.85}
            style={{
              flex: 1.4, paddingVertical: 14, borderRadius: radius.lg,
              backgroundColor: theme.accent, alignItems: 'center', opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: '#fff' }}>حفظ</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} activeOpacity={0.85} style={{
            flex: 1, paddingVertical: 14, borderRadius: radius.lg,
            borderWidth: 1.5, borderColor: theme.line, alignItems: 'center',
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 14.5, color: theme.subtle }}>إلغاء</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Field({ spec, value, onChange }: {
  spec: FieldSpec; value: any; onChange: (v: any) => void;
}) {
  const label = (
    <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: theme.subtle, textAlign: 'right', marginBottom: 6 }}>
      {spec.label}
    </Text>
  );
  const hint = spec.hint ? (
    <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.faint, textAlign: 'right', marginTop: 4, lineHeight: 17 }}>
      {spec.hint}
    </Text>
  ) : null;

  if (spec.type === 'bool') {
    return (
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
        backgroundColor: theme.surface, borderRadius: radius.lg,
        borderWidth: 1, borderColor: theme.line,
        paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right' }}>{spec.label}</Text>
          {hint}
        </View>
        <Switch
          value={!!value}
          onValueChange={onChange}
          disabled={spec.readOnly}
          trackColor={{ true: theme.accent, false: theme.surfaceAlt }}
          thumbColor="#fff"
        />
      </View>
    );
  }

  if (spec.type === 'select') {
    return (
      <View style={{ marginBottom: 12 }}>
        {label}
        <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
          {(spec.options || []).map((o) => {
            const active = String(value ?? '') === o.value;
            return (
              <TouchableOpacity
                key={o.value}
                disabled={spec.readOnly}
                onPress={() => onChange(o.value)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
                style={{
                  paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill,
                  backgroundColor: active ? theme.accent : theme.surface,
                  borderWidth: 1, borderColor: active ? theme.accent : theme.line,
                  opacity: spec.readOnly ? 0.5 : 1,
                }}
              >
                <Text style={{ fontFamily: fonts.ar, fontSize: 12.5, color: active ? '#fff' : theme.subtle }}>
                  {o.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {hint}
      </View>
    );
  }

  const numeric = spec.type === 'number' || spec.type === 'money' || spec.type === 'phone';
  const display = spec.type === 'money' && value
    ? Number(String(value).replace(/\D/g, '')).toLocaleString('en-US')
    : String(value ?? '');

  return (
    <View style={{ marginBottom: 12 }}>
      {label}
      <TextInput
        value={display}
        editable={!spec.readOnly}
        onChangeText={(t) => onChange(numeric && spec.type !== 'phone' ? t.replace(/\D/g, '') : t)}
        keyboardType={numeric ? 'phone-pad' : 'default'}
        multiline={spec.type === 'multiline'}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={theme.faint}
        placeholder="—"
        style={{
          backgroundColor: spec.readOnly ? theme.surfaceAlt : theme.surface,
          borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
          paddingHorizontal: 14, paddingVertical: 12,
          minHeight: spec.type === 'multiline' ? 90 : undefined,
          textAlignVertical: spec.type === 'multiline' ? 'top' : 'center',
          fontSize: 14.5, color: spec.readOnly ? theme.subtle : theme.ink,
          textAlign: spec.type === 'phone' || spec.type === 'money' ? 'left' : 'right',
        }}
      />
      {hint}
    </View>
  );
}
