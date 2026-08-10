// Searchable brand→device picker sheet. Shared by the post-listing form and
// the filter-based Search screen so a seller and a buyer pick the SAME device
// name from `device_catalog`. Devices are fetched per brand and filtered
// server-side (a brand can have 500+ models).
//
// allowManual: when the seller's device isn't in the list, let them use the
// text they typed anyway (the listing keeps that free-text model, and the
// caller files a device-suggestion for admin review). The Search screen
// leaves this off — you can only search for devices that exist.

import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TextInput, TouchableOpacity, FlatList, ActivityIndicator,
  Keyboard, Platform,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { theme, fonts, radius } from '../theme';
import { IconSearch, IconClose, IconCheck, IconPlus } from './icons';
import { DeviceCatalog, type DeviceType } from '../api/endpoints';

export function DevicePickerModal({
  visible, brand, type = 'phone', value, allowManual = false, onClose, onSelect,
}: {
  visible: boolean;
  brand: string;
  type?: DeviceType;
  value?: string;
  allowManual?: boolean;
  onClose: () => void;
  onSelect: (model: string, meta: { fromCatalog: boolean }) => void;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');

  // Reset the search each time the sheet opens so a stale query from a
  // previous brand doesn't linger.
  useEffect(() => { if (visible) { setText(''); setQ(''); } }, [visible, brand]);

  // Debounce so Arabic IME keystrokes don't fire a request each.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  // Lift the sheet above the keyboard ourselves rather than relying on the
  // platform. This sheet is bottom-anchored, so its height follows its
  // content: with a full device list it is tall enough that the top rows stay
  // visible, but once a search narrows it to one or two results the whole
  // sheet is short and sits entirely inside the keyboard's area. Android's
  // windowSoftInputMode=adjustResize does not apply to a transparent Modal,
  // and KeyboardAvoidingView is unreliable inside one, so measure directly.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    // iOS reports the frame before the animation so the sheet travels with the
    // keyboard instead of jumping after it; Android only has the Did events.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e: any) => setKbHeight(e?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // Drop back to 0 between openings, so a sheet opened without focus doesn't
  // start floating on a stale measurement.
  useEffect(() => { if (!visible) setKbHeight(0); }, [visible]);

  const { data, isLoading } = useQuery({
    queryKey: ['device-catalog', type, brand, q],
    queryFn: () => DeviceCatalog.devices(brand, q, type),
    enabled: visible && !!brand,
    staleTime: 5 * 60 * 1000,
  });
  const devices = data || [];

  // Offer "use what I typed" only when manual entry is allowed, the user has
  // typed something, and it isn't already an exact catalog match.
  const typed = text.trim();
  const exact = devices.some((d) => d.model.toLowerCase() === typed.toLowerCase());
  const showManual = allowManual && typed.length >= 2 && !exact;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: theme.bg,
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          paddingTop: 12, paddingBottom: 24,
          // Sit on top of the keyboard rather than behind it, and give up the
          // space it takes so a long list still scrolls within what's visible.
          marginBottom: kbHeight,
          maxHeight: kbHeight ? '58%' : '82%',
        }}>
          <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: theme.line, marginBottom: 10 }} />
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 10 }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 17, fontWeight: '700', color: theme.ink }}>
              {brand ? `اختر جهاز ${brand}` : 'اختر الجهاز'}
            </Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <IconClose size={20} color={theme.subtle} sw={1.7} />
            </TouchableOpacity>
          </View>

          {/* Search box */}
          <View style={{ paddingHorizontal: 18, paddingBottom: 8 }}>
            <View style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
              backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
              borderWidth: 1, borderColor: theme.line,
            }}>
              <IconSearch size={17} color={theme.subtle} sw={1.7} />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="ابحث عن الموديل…"
                placeholderTextColor={theme.subtle}
                autoFocus
                style={{ flex: 1, fontFamily: fonts.ar, fontSize: 14, color: theme.ink, textAlign: 'right', padding: 0 }}
              />
              {text ? (
                <TouchableOpacity onPress={() => setText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <IconClose size={15} color={theme.subtle} sw={1.7} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* "Use what I typed" is the escape hatch, not the happy path. The
              catalogue search now understands Arabic, so a seller typing
              "ايفون 13 برو ماكس" gets real devices back — and offering a
              free-text button in accent colour right above them is what
              filled a third of live listings with typed Arabic model names.
              It stays prominent only when the catalogue genuinely has
              nothing; otherwise it drops below the suggestions, quietly. */}
          {showManual && !devices.length ? (
            <TouchableOpacity
              onPress={() => onSelect(typed, { fromCatalog: false })}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                marginHorizontal: 18, marginBottom: 6, paddingVertical: 12, paddingHorizontal: 14,
                borderRadius: radius.lg, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.accentSoft,
              }}
            >
              <IconPlus size={15} color={theme.accent} sw={2.2} />
              <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 13.5, color: theme.accentDeep, fontWeight: '600', textAlign: 'right' }}>
                استخدم «{typed}» — جهازي غير موجود بالقائمة
              </Text>
            </TouchableOpacity>
          ) : null}

          {showManual && devices.length ? (
            <Text style={{
              paddingHorizontal: 18, paddingBottom: 6,
              fontFamily: fonts.ar, fontSize: 12, color: theme.subtle, textAlign: 'right',
            }}>
              هل تقصد أحد هذه الأجهزة؟
            </Text>
          ) : null}

          {isLoading ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
          ) : (
            <FlatList
              data={devices}
              keyExtractor={(d) => String(d.id)}
              keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.line, marginHorizontal: 18 }} />}
              renderItem={({ item }) => {
                const active = !!value && item.model.toLowerCase() === value.toLowerCase();
                return (
                  <TouchableOpacity
                    onPress={() => onSelect(item.model, { fromCatalog: true })}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row-reverse', alignItems: 'center',
                      paddingHorizontal: 18, paddingVertical: 13,
                      backgroundColor: active ? theme.accentSoft : 'transparent',
                    }}
                  >
                    <Text style={{ flex: 1, fontFamily: active ? fonts.arBold : fonts.ar, fontSize: 14.5, fontWeight: active ? '700' : '500', color: active ? theme.accentDeep : theme.ink, textAlign: 'right', writingDirection: 'ltr' }}>
                      {item.model}
                    </Text>
                    {active ? <IconCheck size={16} color={theme.accent} sw={2.2} /> : null}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ padding: 30, alignItems: 'center' }}>
                  <Text style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'center' }}>
                    {q ? 'لا يوجد جهاز مطابق' : 'لا توجد أجهزة لهذه الماركة'}
                  </Text>
                </View>
              }
              // Still reachable when none of the suggestions fit — just no
              // longer the first thing the eye lands on.
              ListFooterComponent={showManual && devices.length ? (
                <TouchableOpacity
                  onPress={() => onSelect(typed, { fromCatalog: false })}
                  activeOpacity={0.8}
                  style={{
                    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                    marginHorizontal: 18, marginTop: 10, paddingVertical: 11, paddingHorizontal: 14,
                    borderRadius: radius.lg, borderWidth: 1, borderColor: theme.line,
                  }}
                >
                  <IconPlus size={14} color={theme.subtle} sw={2} />
                  <Text style={{
                    flex: 1, fontFamily: fonts.ar, fontSize: 12.5,
                    color: theme.subtle, textAlign: 'right',
                  }}>
                    لا شيء مما فوق؟ استخدم «{typed}»
                  </Text>
                </TouchableOpacity>
              ) : null}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
