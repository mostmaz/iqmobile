// «فحص سريع للجهاز» — the four condition questions, as one thing.
//
// They used to be four identical rows of pills, visually indistinguishable
// from «السعة» and «اللون» directly above them, so they read as more form to
// fill rather than as the questions that shorten a buyer's first three
// messages. One bordered card with a counter says they belong together and
// says how many are left.
//
// An answered row COLLAPSES to a single line. The step therefore gets shorter
// as the seller works, which is the opposite of what a form usually does, and
// it is the reason someone reaches the fourth question at all.
//
// Nothing here is a gate. Leaving a question blank still publishes; what the
// answers buy is the prose nags standing down and a listing page that answers
// the buyer without a paragraph.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';
import { Pill } from './ui';
import { IconCheck } from './icons';
import { fieldsFor, labelFor, type ConditionDetails } from '../lib/conditionDetails';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ar = (n: number) => String(Math.max(0, Math.floor(n))).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

export function InspectionCard({ condition, value, onChange }: {
  condition: string;
  value: ConditionDetails;
  onChange: (next: ConditionDetails) => void;
}) {
  const fields = fieldsFor(condition);
  // Which rows the seller has deliberately reopened. An answered row that
  // could not be reopened would make «تغيير» a lie.
  const [reopened, setReopened] = React.useState<Record<string, boolean>>({});

  // A sealed phone has no repair history to ask about, and asking anyway
  // teaches sellers the form is not paying attention.
  if (fields.length === 0) {
    return (
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
        paddingVertical: 13, paddingHorizontal: 14, marginBottom: 12,
        backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line,
        borderRadius: radius.xl,
      }}>
        <IconCheck size={16} color={theme.success} />
        <Text style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13, lineHeight: 20, color: theme.ink, textAlign: 'right' }}>
          جهاز جديد — لا أسئلة فحص. انتقل مباشرة إلى السعة واللون.
        </Text>
      </View>
    );
  }

  const answered = fields.filter((f) => value[f.id]).length;
  const pct = Math.round((answered / fields.length) * 100);

  return (
    <View style={{
      marginBottom: 12, backgroundColor: theme.surface,
      borderWidth: 1.5, borderColor: 'rgba(27,26,24,0.12)',
      borderRadius: radius.xxl, overflow: 'hidden',
    }}>
      <View style={{
        paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12,
        flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10,
        borderBottomWidth: 1, borderBottomColor: theme.line,
      }}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 14, color: theme.ink, textAlign: 'right' }}>
            فحص سريع للجهاز
          </Text>
          <Text style={{ marginTop: 3, fontFamily: fonts.ar, fontSize: 11.5, lineHeight: 18, color: theme.subtle, textAlign: 'right' }}>
            أربعة أسئلة تختصر أول ثلاث رسائل من المشتري. «غير معروف» جواب مقبول.
          </Text>
        </View>
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
          backgroundColor: answered === fields.length ? theme.successSoft : theme.chipBg,
        }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{
            fontFamily: fonts.ltrBold, fontSize: 11,
            color: answered === fields.length ? theme.success : theme.subtle,
          }}>
            {answered} / {fields.length}
          </Text>
        </View>
      </View>

      <View style={{ height: 4, backgroundColor: theme.chipBg }}>
        <View style={{ width: `${pct}%`, height: 4, backgroundColor: answered === fields.length ? theme.success : theme.accent }} />
      </View>

      {fields.map((f, i) => {
        const picked = value[f.id];
        const collapsed = !!picked && !reopened[f.id];
        return (
          <View
            key={f.id}
            style={{
              paddingHorizontal: 14, paddingVertical: 12,
              borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.line,
            }}
          >
            {collapsed ? (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setReopened((p) => ({ ...p, [f.id]: true }))}
                accessibilityRole="button"
                style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}
              >
                <View style={{
                  width: 20, height: 20, borderRadius: 10, backgroundColor: theme.success,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <IconCheck size={12} color="#fff" />
                </View>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ar, fontSize: 13, color: theme.subtle, textAlign: 'right' }}>
                  {f.question}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.arBold, fontSize: 13, color: theme.ink }}>
                  {labelFor(f.id, picked) || picked}
                </Text>
                <Text style={{ fontFamily: fonts.arBold, fontSize: 12, color: theme.accent }}>تغيير</Text>
              </TouchableOpacity>
            ) : (
              <>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 10,
                    backgroundColor: theme.chipBg, alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text maxFontSizeMultiplier={FONT_SCALE_TIGHT} style={{ fontFamily: fonts.arBold, fontSize: 11, color: theme.chipInk }}>
                      {ar(i + 1)}
                    </Text>
                  </View>
                  <Text style={{ flex: 1, fontFamily: fonts.arBold, fontSize: 13.5, color: theme.ink, textAlign: 'right' }}>
                    {f.question}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, paddingRight: 30 }}>
                  {f.options.map((o) => (
                    <Pill
                      key={o.value}
                      small
                      active={picked === o.value}
                      onPress={() => {
                        // Tapping the chosen answer again clears it: an answer
                        // given by accident must be retractable, and «غير
                        // معروف» is a different statement from saying nothing.
                        if (picked === o.value) {
                          const next = { ...value };
                          delete next[f.id];
                          onChange(next);
                          return;
                        }
                        onChange({ ...value, [f.id]: o.value });
                        setReopened((p) => ({ ...p, [f.id]: false }));
                      }}
                    >
                      {o.label}
                    </Pill>
                  ))}
                </View>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}
