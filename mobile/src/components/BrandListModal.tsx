// Brand picker sheet — a plain vertical list, no search box.
//
// Replaces the wrapping pill rows this used to be. Pills had two problems:
// as a single horizontal rail the later brands sat off-screen with no hint
// they existed, and once wrapped they sprawled over two or three lines. A
// list shows every brand at a glance and scrolls naturally.
//
// `counts` is optional: the shop page passes its own per-brand tallies so a
// row reads "Xiaomi 42", while the post-listing form passes none.

import React from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList } from 'react-native';
import { theme, fonts } from '../theme';
import { IconClose, IconCheck } from './icons';

export type BrandRow = { name: string; label?: string; count?: number };

export function BrandListModal({
  visible, title = 'اختر العلامة التجارية', brands, value, onClose, onSelect,
}: {
  visible: boolean;
  title?: string;
  brands: BrandRow[];
  value?: string | null;
  onClose: () => void;
  onSelect: (name: string | null) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: theme.bg,
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          paddingTop: 12, paddingBottom: 24, maxHeight: '80%',
        }}>
          <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: theme.line, marginBottom: 10 }} />
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center',
            justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 10,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink }}>
              {title}
            </Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <IconClose size={20} color={theme.subtle} sw={1.7} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={brands}
            keyExtractor={(b) => b.name || '__all__'}
            ItemSeparatorComponent={() => (
              <View style={{ height: 1, backgroundColor: theme.line, marginHorizontal: 18 }} />
            )}
            renderItem={({ item }) => {
              const active = (value ?? null) === (item.name || null);
              return (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => { onSelect(item.name || null); onClose(); }}
                  style={{
                    flexDirection: 'row-reverse', alignItems: 'center',
                    paddingHorizontal: 18, paddingVertical: 15, gap: 8,
                  }}
                >
                  <Text style={{
                    flex: 1, textAlign: 'right',
                    fontFamily: active ? fonts.arBold : fonts.ar,
                    fontSize: 15, fontWeight: active ? '700' : '500',
                    color: active ? theme.accentDeep : theme.ink,
                  }}>
                    {item.label || item.name}
                  </Text>
                  {typeof item.count === 'number' ? (
                    <Text style={{ fontFamily: fonts.ltr, fontSize: 12.5, color: theme.subtle }}>
                      {item.count}
                    </Text>
                  ) : null}
                  {active ? <IconCheck size={17} color={theme.accentDeep} sw={2} /> : null}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}
