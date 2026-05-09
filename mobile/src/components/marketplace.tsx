// Shared visual building blocks specific to the marketplace UI — the bits
// that appear in both the chat and the listing detail (locked / unlocked
// phone state, deal banner, masked-warn) plus a few small primitives used
// across screens (Stamp, ChipTag, SpecRow, StepDots).
//
// These mirror the design tokens 1:1: same paddings, radii, colors, and
// shadow choices.

import React from 'react';
import { View, Text, TouchableOpacity, StyleProp, ViewStyle, Linking } from 'react-native';
import { theme, fonts, radius } from '../theme';
import { IconCheck, IconLock, IconUnlock, IconShield, IconPhoneIcon, IconMsgCall } from './icons';
import { fmtIQD } from './ui';
import { callPhone, openWhatsApp } from '../lib/contact';

// ─── Verified stamp ──────────────────────────────────────────────────
export function Stamp({ children, icon, sm }: { children: React.ReactNode; icon?: React.ReactNode; sm?: boolean }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
      backgroundColor: theme.successSoft,
      paddingHorizontal: sm ? 7 : 8, paddingVertical: sm ? 2 : 3,
      borderRadius: 999,
    }}>
      {icon || <IconCheck size={sm ? 9 : 11} color={theme.success} sw={2} />}
      <Text style={{ fontFamily: fonts.arBold, fontSize: sm ? 10 : 11, color: theme.success, fontWeight: '700' }}>
        {children}
      </Text>
    </View>
  );
}

// ─── Chip (small, on listing cards / spec rows) ──────────────────────
export function ChipTag({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 3, backgroundColor: theme.chipBg, borderRadius: 999 }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.chipInk, fontWeight: '500' }}>{children}</Text>
    </View>
  );
}

// ─── Spec row (label · value) ────────────────────────────────────────
export function SpecRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', justifyContent: 'space-between',
      paddingVertical: 9,
      borderBottomWidth: last ? 0 : 1, borderColor: theme.line,
    }}>
      <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}>{label}</Text>
      <Text style={{ fontFamily: fonts.ltrBold, fontSize: 13, color: theme.ink, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

// ─── Step dots (post wizard progress) ────────────────────────────────
export function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row-reverse', gap: 4 }}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{
          height: 4, flex: 1, borderRadius: 999,
          backgroundColor: i < current ? theme.ink : i === current ? theme.accent : 'rgba(27,26,24,0.14)',
        }} />
      ))}
    </View>
  );
}

// ─── Masked-warn (chat bubble footnote when a number was masked) ────
export function MaskedWarn({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      marginTop: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8,
      backgroundColor: theme.dangerSoft,
      flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
    }}>
      <IconLock size={11} color={theme.danger} sw={2} />
      <Text style={{ fontFamily: fonts.ar, fontSize: 11, color: theme.danger, flex: 1, textAlign: 'right' }}>
        {children}
      </Text>
    </View>
  );
}

// ─── Locked phone card with 4-step mini-flow ────────────────────────
const STEPS_AR = ['البائع يقترح السعر', 'المشتري يوافق', 'البائع يؤكد', 'كشف الرقم'];

export function LockedCard({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(217,88,58,0.45)',
      backgroundColor: theme.accentSoft, borderRadius: radius.xl, padding: 14,
    }, style]}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
        <IconLock size={15} color={theme.accentDeep} sw={1.7} />
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.accentDeep, fontWeight: '600' }}>
          الرقم مقفل
        </Text>
      </View>
      <Text style={{ marginTop: 8, fontFamily: fonts.ar, fontSize: 13, color: theme.accentDeep, lineHeight: 20, textAlign: 'right' }}>
        {message}
      </Text>
      <View style={{ marginTop: 12, flexDirection: 'row-reverse', alignItems: 'center', gap: 0 }}>
        {STEPS_AR.map((step, i) => (
          <React.Fragment key={i}>
            <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View style={{
                width: 22, height: 22, borderRadius: 999,
                backgroundColor: i === 3 ? theme.accent : 'rgba(217,88,58,0.2)',
                borderWidth: i === 3 ? 0 : 1, borderColor: theme.accent,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {i === 3 ? <IconUnlock size={11} color="#fff" sw={2} />
                  : <Text style={{ color: theme.accentDeep, fontFamily: fonts.ltrBold, fontSize: 10, fontWeight: '700' }}>{i + 1}</Text>}
              </View>
              <Text style={{ fontFamily: fonts.ar, fontSize: 9, color: theme.accentDeep, textAlign: 'center', lineHeight: 12, fontWeight: '600', maxWidth: 64 }}>
                {step}
              </Text>
            </View>
            {i < 3 ? <View style={{ height: 1, flex: 0.4, backgroundColor: theme.accent, opacity: 0.4, marginBottom: 14 }} /> : null}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

// ─── Unlocked phone card (Call + WhatsApp) ──────────────────────────
export function UnlockedCard({ phone, eyebrow, style }: { phone: string; eyebrow?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{
      backgroundColor: theme.successSoft,
      borderColor: theme.success, borderWidth: 1.5, borderRadius: radius.xxl,
      padding: 14,
    }, style]}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
          <IconUnlock size={16} color={theme.success} sw={1.8} />
          <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.success, fontWeight: '700' }}>
            {eyebrow || 'صفقة مؤكدة'}
          </Text>
        </View>
        <Stamp icon={<IconShield size={11} color={theme.success} sw={2} />} sm>موثق</Stamp>
      </View>

      <View style={{
        marginTop: 10,
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 12, paddingVertical: 10,
        backgroundColor: theme.surface, borderRadius: 12,
        borderWidth: 1, borderColor: theme.success,
      }}>
        <Text style={{ fontFamily: fonts.ltrBold, fontSize: 17, color: theme.ink, fontWeight: '700', letterSpacing: 0.3, textAlign: 'left', writingDirection: 'ltr' }}>
          {phone}
        </Text>
        <IconPhoneIcon size={16} color={theme.success} sw={1.7} />
      </View>

      <View style={{ marginTop: 8, flexDirection: 'row-reverse', gap: 8 }}>
        <TouchableOpacity onPress={() => callPhone(phone)} activeOpacity={0.85} style={{
          flex: 1, backgroundColor: theme.success, borderRadius: radius.lg,
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
          paddingVertical: 12, minHeight: 44,
        }}>
          <IconPhoneIcon size={15} color="#fff" sw={1.8} />
          <Text style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 14, color: '#fff' }}>اتصال</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openWhatsApp(phone)} activeOpacity={0.85} style={{
          flex: 1, backgroundColor: theme.successSoft, borderRadius: radius.lg, borderWidth: 1.5, borderColor: theme.success,
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
          paddingVertical: 12, minHeight: 44,
        }}>
          <IconMsgCall size={15} color={theme.success} sw={1.8} />
          <Text style={{ fontFamily: fonts.arBold, fontWeight: '700', fontSize: 14, color: theme.success }}>واتساب</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Deal banner (in-chat negotiation card) ─────────────────────────
export function DealBanner({
  eyebrow, finalPrice, askingPrice, children,
}: {
  eyebrow: string;
  finalPrice: number;
  askingPrice?: number;
  children?: React.ReactNode;
}) {
  return (
    <View style={{
      marginHorizontal: 12, marginBottom: 8,
      paddingVertical: 14, paddingHorizontal: 14,
      backgroundColor: theme.accentSoft, borderColor: theme.accent, borderWidth: 1.5,
      borderRadius: radius.xl, overflow: 'hidden',
    }}>
      <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.accentDeep, fontWeight: '600', textAlign: 'right' }}>
        {eyebrow}
      </Text>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
        <Text style={{ fontFamily: fonts.ltrBold, fontSize: 26, color: theme.accentDeep, fontWeight: '700' }}>
          {fmtIQD(finalPrice)}
        </Text>
        <Text style={{ fontFamily: fonts.ar, fontSize: 12, color: theme.accentDeep, opacity: 0.75 }}>د.ع</Text>
        {askingPrice && askingPrice !== finalPrice ? (
          <Text style={{ marginStart: 'auto', fontFamily: fonts.ltr, fontSize: 11, color: theme.accentDeep, opacity: 0.7, textDecorationLine: 'line-through' }}>
            {fmtIQD(askingPrice)} د.ع
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
