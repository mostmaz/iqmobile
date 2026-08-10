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

// Sentinel used internally to represent the "all governorates" choice
// when `allowAll` is on. It travels through the list rendering but the
// onChangeAr callback receives `''` (empty string) so the parent can
// distinguish "no filter" from a real gov name.
const ALL_VALUE = '__ALL__';

export function GovPicker({
  valueAr, onChangeAr, label,
  allowAll = false,
  allLabel = 'كل المحافظات',
  compact = false,
}: {
  valueAr: string;
  // When allowAll=true and "all" is chosen, this is called with `''`.
  onChangeAr: (g: string) => void;
  label?: string;
  // Surface a "كل المحافظات" entry at the top of the picker. Use this for
  // filter sheets where "no filter" is a real choice; leave off for the
  // post-listing wizard where the seller must pick a real gov.
  allowAll?: boolean;
  // Override the "all" label (e.g. "كل العراق").
  allLabel?: string;
  // Slimmer row for inline use above the brand rail — no separate label
  // line, smaller pin chip, single-row layout.
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Display text on the trigger row. When the picker is in allowAll mode
  // and the parent passed an empty value, show the all-label instead of
  // the (empty) Arabic name.
  const displayValue = valueAr ? valueAr : allLabel;

  // Data passed to the modal list. In allowAll mode the special sentinel
  // sits at index 0 and renders as the all-label.
  const data = allowAll ? [ALL_VALUE, ...GOV_AR_LIST] : GOV_AR_LIST;

  if (compact) {
    return (
      <>
        <TouchableOpacity
          onPress={() => setOpen(true)}
          activeOpacity={0.85}
          style={{
            flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
            paddingHorizontal: 12, paddingVertical: 8,
            backgroundColor: theme.surface, borderRadius: 999,
            borderWidth: 1, borderColor: theme.line,
          }}
        >
          <IconPin size={13} color={theme.accent} sw={1.8} />
          <Text style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink, textAlign: 'right' }}>
            {displayValue}
          </Text>
          <IconChevronDown size={13} color={theme.subtle} sw={2} />
        </TouchableOpacity>
        <PickerModal
          open={open} setOpen={setOpen}
          data={data} valueAr={valueAr}
          allowAll={allowAll} allLabel={allLabel}
          onChangeAr={onChangeAr}
        />
      </>
    );
  }

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
          <Text style={{ marginTop: label ? 2 : 0, fontFamily: fonts.arBold, fontSize: 15, color: theme.ink, textAlign: 'right' }}>
            {displayValue}
          </Text>
        </View>
        <IconChevronDown size={16} color={theme.subtle} sw={2} />
      </TouchableOpacity>
      <PickerModal
        open={open} setOpen={setOpen}
        data={data} valueAr={valueAr}
        allowAll={allowAll} allLabel={allLabel}
        onChangeAr={onChangeAr}
      />
    </>
  );
}

// Shared bottom-sheet modal used by both the full and compact triggers
// above. Pulled out so the two trigger surfaces stay in sync without
// duplicating ~40 lines of JSX.
function PickerModal({
  open, setOpen, data, valueAr, allowAll, allLabel, onChangeAr,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  data: string[];
  valueAr: string;
  allowAll: boolean;
  allLabel: string;
  onChangeAr: (g: string) => void;
}) {
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: theme.bg,
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          paddingTop: 12, paddingBottom: 24,
          maxHeight: '70%',
        }}>
          <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: theme.line, marginBottom: 10 }} />
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 18, paddingBottom: 10,
          }}>
            <Text style={{ fontFamily: fonts.arBold, fontSize: 17, color: theme.ink }}>
              المحافظة
            </Text>
            <TouchableOpacity onPress={() => setOpen(false)} activeOpacity={0.7}>
              <IconClose size={20} color={theme.subtle} sw={1.7} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={data}
            keyExtractor={(g) => g}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.line, marginHorizontal: 18 }} />}
            renderItem={({ item }) => {
              const isAllRow = allowAll && item === ALL_VALUE;
              // The "all" row is active when the parent passed an empty
              // value AND the picker is in allowAll mode. Regular rows
              // match by Arabic name.
              const active = isAllRow ? !valueAr : item === valueAr;
              const labelText = isAllRow ? allLabel : item;
              return (
                <TouchableOpacity
                  onPress={() => {
                    onChangeAr(isAllRow ? '' : item);
                    setOpen(false);
                  }}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row-reverse', alignItems: 'center',
                    paddingHorizontal: 18, paddingVertical: 13,
                    backgroundColor: active ? theme.accentSoft : 'transparent',
                  }}
                >
                  <Text style={{ flex: 1, fontFamily: active ? fonts.arBold : fonts.ar, fontSize: 14.5, fontWeight: active ? '700' : '500', color: active ? theme.accentDeep : theme.ink, textAlign: 'right' }}>
                    {labelText}
                  </Text>
                  {active ? <IconCheck size={16} color={theme.accent} sw={2.2} /> : null}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}
