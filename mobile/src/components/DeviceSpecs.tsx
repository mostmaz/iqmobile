// The device's own spec sheet, under the seller's description.
//
// Two kinds of value live side by side here and they are NOT formatted the
// same: quantities a shopper reads ("٦.٧ بوصة", "٥٠٠٠ مللي أمبير") get
// Arabic-Indic digits, while product names ("Snapdragon 8 Gen 3") stay
// Latin and left-to-right — transliterating a chipset name would make it
// unsearchable and unrecognisable to the person comparing two phones.
//
// Every field is optional. A device we know the screen and battery of but
// not the charge speed shows four rows, not four rows and a blank.
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

type Row = { label: string; value: string; ltr?: boolean };

/** The rows worth showing, in the order a buyer asks about them. */
function rowsOf(s: Specs): Row[] {
  const out: Row[] = [];
  if (s.display_inches) {
    out.push({ label: 'الشاشة', value: `${arNum(s.display_inches)} بوصة` });
  }
  if (s.chipset) {
    // "Qualcomm SM6450 Snapdragon 6 Gen 1 (4 nm)" — the part number and the
    // process node are for spec sheets, not for a buyer choosing a phone.
    const chip = s.chipset.replace(/\s*\([^)]*nm[^)]*\)\s*$/, '').replace(/^Qualcomm\s+SM\d+\s+/, '');
    out.push({ label: 'المعالج', value: chip, ltr: true });
  }
  if (s.ram_gb) {
    out.push({ label: 'الرام', value: `${arNum(s.ram_gb.replace('/', ' / '))} جيجا` });
  }
  if (s.battery_mah) {
    out.push({ label: 'البطارية', value: `${arNum(s.battery_mah)} mAh`, ltr: false });
  }
  // Wired watts only. An iPhone's 15W is its MagSafe pad, and printing that
  // as "الشحن" would read as the speed of the plug in the box.
  if (s.charge_w) {
    out.push({ label: 'سرعة الشحن', value: `${arNum(s.charge_w)} واط` });
  }
  if (s.camera_main_mp) {
    const front = s.camera_selfie_mp ? ` · أمامية ${arNum(s.camera_selfie_mp)}` : '';
    out.push({ label: 'الكاميرا', value: `${arNum(s.camera_main_mp)} ميجابكسل${front}` });
  }
  return out;
}

export function DeviceSpecs({ specs }: { specs?: Specs | null }) {
  if (!specs) return null;
  const rows = rowsOf(specs);
  if (rows.length < 2) return null;      // one lonely row isn't a spec sheet

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
      <Text style={{
        fontFamily: fonts.arBold, fontSize: 11.5, color: theme.subtle,
        textAlign: 'right', marginBottom: 8,
      }}>
        مواصفات الجهاز
      </Text>

      <View style={{
        backgroundColor: theme.surface, borderRadius: radius.xl,
        borderWidth: 1, borderColor: theme.line, overflow: 'hidden',
      }}>
        {rows.map((r, i) => (
          <View
            key={r.label}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
              paddingHorizontal: 14, paddingVertical: 11,
              borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.line,
            }}
          >
            <Text
              maxFontSizeMultiplier={FONT_SCALE_TIGHT}
              style={{ fontFamily: fonts.ar, fontSize: 13, color: theme.subtle }}
            >
              {r.label}
            </Text>
            <Text
              maxFontSizeMultiplier={FONT_SCALE_TIGHT}
              numberOfLines={2}
              style={{
                flex: 1,
                fontFamily: r.ltr ? fonts.ltr : fonts.arBold,
                fontSize: 13.5, color: theme.ink,
                textAlign: 'left',
                writingDirection: r.ltr ? 'ltr' : 'rtl',
              }}
            >
              {r.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Where the numbers come from. A shopper comparing two listings of the
          same phone should be able to see the specs weren't typed by either
          seller. */}
      {specs.source ? (
        <Text style={{
          fontFamily: fonts.ar, fontSize: 10.5, color: theme.subtle,
          textAlign: 'right', marginTop: 6, opacity: 0.85,
        }}>
          {`المواصفات من ${specs.source}${specs.device ? ` · ${specs.device}` : ''}`}
        </Text>
      ) : null}
    </View>
  );
}
