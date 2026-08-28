// The device's specs, under the seller's description, as two chip groups.
//
// The split is the point (design 1a/2a): «حالة هذا الجهاز» is what the
// SELLER typed about this particular unit — condition, capacity, colour,
// battery health, warranty — while «مواصفات الموديل» is what the model is,
// the same for every unit of it and sourced from GSMArena. Merged into one
// list, a buyer cannot tell which numbers a seller could have got wrong.
//
// Two kinds of value live here and they are NOT formatted the same:
// quantities a shopper reads ("٦.٧ بوصة") get Arabic-Indic digits, while
// product names ("Snapdragon 8 Gen 3") stay Latin and left-to-right —
// transliterating a chipset would make it unrecognisable to the person
// comparing two phones.
//
// Every field is optional, and a group with nothing in it does not render.
import React from 'react';
import { View, Text } from 'react-native';
import { theme, fonts, radius, FONT_SCALE_TIGHT } from '../theme';

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n: number | string) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

export type Specs = {
  device?: string | null;
  display_inches?: number | null;
  display_type?: string | null;
  display_resolution?: string | null;
  chipset?: string | null;
  cpu?: string | null;
  ram_gb?: string | null;
  storage_options?: string | null;
  battery_mah?: number | null;
  charge_w?: number | null;
  charge_w_wireless?: number | null;
  camera_main_mp?: number | null;
  camera_main?: string | null;
  camera_selfie_mp?: number | null;
  camera_selfie?: string | null;
  os?: string | null;
  announced?: string | null;
  source?: string | null;
};

/** What the seller declared about this unit, as opposed to the model. */
export type SellerFacts = {
  condition?: string | null;
  storage?: string | null;
  color?: string | null;
  battery_health?: number | null;
  warranty_status?: string | null;
};

type Chip = { label: string; value: string; ltr?: boolean; good?: boolean };

/** A pill: quiet label, loud value. */
function SpecChip({ chip }: { chip: Chip }) {
  return (
    <View style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
      paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.pill,
      backgroundColor: chip.good ? theme.successSoft : theme.chipBg,
    }}>
      <Text
        maxFontSizeMultiplier={FONT_SCALE_TIGHT}
        style={{
          fontFamily: fonts.ar, fontSize: 11,
          color: chip.good ? theme.success : theme.subtle,
        }}
      >
        {chip.label}
      </Text>
      <Text
        maxFontSizeMultiplier={FONT_SCALE_TIGHT}
        style={{
          fontFamily: chip.ltr ? fonts.ltr : fonts.arBold, fontSize: 12.5,
          color: chip.good ? theme.success : theme.chipInk,
          writingDirection: chip.ltr ? 'ltr' : 'rtl',
        }}
      >
        {chip.value}
      </Text>
    </View>
  );
}

function Group({ title, chips, footnote }: { title: string; chips: Chip[]; footnote?: string | null }) {
  if (!chips.length) return null;
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle,
        textAlign: 'right', marginBottom: 8,
      }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 }}>
        {chips.map((c) => <SpecChip key={c.label + c.value} chip={c} />)}
      </View>
      {footnote ? (
        <Text style={{
          fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle,
          textAlign: 'left', marginTop: 7, opacity: 0.85,
        }}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

export function DeviceSpecs({ specs, seller, conditionLabel }: {
  specs?: Specs | null;
  seller?: SellerFacts | null;
  /** Arabic label for the condition code, from the caller's dictionary. */
  conditionLabel?: string | null;
}) {
  // What the seller says about this unit.
  const own: Chip[] = [];
  if (conditionLabel) own.push({ label: 'الحالة', value: conditionLabel });
  if (seller?.storage) own.push({ label: 'السعة', value: seller.storage, ltr: true });
  if (seller?.color) own.push({ label: 'اللون', value: seller.color });
  if (seller?.warranty_status) own.push({ label: 'الضمان', value: seller.warranty_status });
  // Battery health is the one number a used-phone buyer asks for first, so
  // it reads as a positive when it is one.
  if (seller?.battery_health) {
    own.push({
      label: 'صحة البطارية',
      value: `${arNum(seller.battery_health)}٪`,
      good: seller.battery_health >= 85,
    });
  }

  // What the model is.
  const model: Chip[] = [];
  if (specs?.display_inches) model.push({ label: 'الشاشة', value: `${arNum(specs.display_inches)} بوصة` });
  if (specs?.chipset) {
    // "Qualcomm SM6450 Snapdragon 6 Gen 1 (4 nm)" — the part number and the
    // process node are for spec sheets, not for someone choosing a phone.
    const chip = specs.chipset
      .replace(/\s*\([^)]*nm[^)]*\)\s*$/, '')
      .replace(/^Qualcomm\s+SM\d+\s+/, '');
    model.push({ label: 'المعالج', value: chip, ltr: true });
  }
  if (specs?.ram_gb) model.push({ label: 'الرام', value: `${arNum(specs.ram_gb.replace('/', '/'))} جيجا` });
  if (specs?.battery_mah) model.push({ label: 'البطارية', value: `${arNum(specs.battery_mah)} mAh`, ltr: false });
  // Wired watts only. An iPhone's 15W is its MagSafe pad, and printing that
  // as "الشحن" would read as the speed of the plug in the box.
  if (specs?.charge_w) model.push({ label: 'الشحن', value: `${arNum(specs.charge_w)} واط` });
  if (specs?.camera_main_mp) {
    model.push({ label: 'الكاميرا', value: `${arNum(specs.camera_main_mp)} ميجابكسل` });
  }

  if (!own.length && !model.length) return null;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
      <Group title="حالة هذا الجهاز" chips={own} />
      <Group
        title="مواصفات الموديل"
        chips={model}
        // Whose numbers these are. A buyer comparing two listings of the
        // same phone should see the specs weren't typed by either seller.
        footnote={specs?.source ? `من ${specs.source}` : null}
      />
    </View>
  );
}
