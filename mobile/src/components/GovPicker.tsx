// Governorate picker — tappable row that opens a modal list. Used wherever
// the user picks a province (post wizard, edit profile). Designed to read
// as a "current location" surface so the auto-detected default is obvious:
// the chosen governorate appears prominently at the top with a pin icon,
// tapping anywhere on the row opens the picker sheet.

import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList } from 'react-native';
import { theme, fonts, radius } from '../theme';
import { IconPin, IconChevronDown, IconCheck, IconClose } from './icons';
import { GOV_AR_LIST } from '../lib/governorates';

export function GovPicker({
  valueAr, onChangeAr, label,
}: {
  valueAr: string;
  onChangeAr: (g: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
          paddingHorizontal: 14, paddingVertical: 12,
          backgroundColor: theme.surface, borderRadius: radius.lg,
          borderWidth: 1, borderColor: theme.line,
        }}
      >
        <View style={{
          width: 32, height: 32, borderRadius: 999,
          backgroundColor: theme.accentSoft,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <IconPin size={15} color={theme.accent} sw={1.7} />
        </View>
        <View style={{ flex: 1 }}>
          {label ? (
            <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: theme.subtle, textAlign: 'right' }}>
              {label}
            </Text>
          ) : null}
          <Text style={{ marginTop: label ? 2 : 0, fontFamily: fonts.arBold, fontSize: 15, fontWeight: '700', color: theme.ink, textAlign: 'right' }}>
            {valueAr}
          </Text>
        </View>
        <IconChevronDown size={16} color={theme.subtle} sw={2} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: theme.bg,
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            paddingTop: 12, paddingBottom: 24,
            maxHeight: '70%',
          }}>
            {/* drag handle */}
            <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: theme.line, marginBottom: 10 }} />
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 18, paddingBottom: 10,
            }}>
              <Text style={{ fontFamily: fonts.arBold, fontSize: 17, fontWeight: '700', color: theme.ink }}>
                المحافظة
              </Text>
              <TouchableOpacity onPress={() => setOpen(false)} activeOpacity={0.7}>
                <IconClose size={20} color={theme.subtle} sw={1.7} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={GOV_AR_LIST}
              keyExtractor={(g) => g}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.line, marginHorizontal: 18 }} />}
              renderItem={({ item }) => {
                const active = item === valueAr;
                return (
                  <TouchableOpacity
                    onPress={() => { onChangeAr(item); setOpen(false); }}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row-reverse', alignItems: 'center',
                      paddingHorizontal: 18, paddingVertical: 13,
                      backgroundColor: active ? theme.accentSoft : 'transparent',
                    }}
                  >
                    <Text style={{ flex: 1, fontFamily: active ? fonts.arBold : fonts.ar, fontSize: 14.5, fontWeight: active ? '700' : '500', color: active ? theme.accentDeep : theme.ink, textAlign: 'right' }}>
                      {item}
                    </Text>
                    {active ? <IconCheck size={16} color={theme.accent} sw={2.2} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
