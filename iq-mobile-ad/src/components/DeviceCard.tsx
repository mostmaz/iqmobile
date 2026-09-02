import React from "react";
import { colors, radius } from "../theme";
import { useLayout } from "../layout";
import { useCairo } from "../font";
import { formatPrice, AD } from "../data";
import { IconPin } from "./icons";

// A rebuilt IQ Mobile listing card: image block, device name, capacity chip,
// governorate pin, price row. Modelled on the real card in the app, drawn
// entirely in vector.
export const DeviceCard: React.FC<{
  name: string;
  capacity: string;
  governorate: string;
  price: number;
  newPrice?: number;
  width: number;
  children?: React.ReactNode;
}> = ({ name, capacity, governorate, price, width, children }) => {
  const { u, font } = useLayout();
  const fontFamily = useCairo();

  return (
    <div
      dir="rtl"
      style={{
        width,
        backgroundColor: colors.surface,
        borderRadius: radius.card * u * 1.6,
        border: `${2 * u}px solid rgba(27,26,24,0.08)`,
        boxShadow: `0 ${28 * u}px ${64 * u}px rgba(27,26,24,0.16)`,
        overflow: "hidden",
      }}
    >
      {/* Image placeholder block — a phone silhouette, not a photo */}
      <div
        style={{
          height: width * 0.42,
          backgroundColor: colors.chip,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 24 * u,
        }}
      >
        <svg width={width * 0.13} height={width * 0.2} viewBox="0 0 40 62" fill="none">
          <rect x="2" y="2" width="36" height="58" rx="8" stroke={colors.ink} strokeWidth="3" opacity={0.5} />
          <rect x="14" y="7" width="12" height="3" rx="1.5" fill={colors.ink} opacity={0.5} />
        </svg>
        <div
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.pill,
            padding: `${10 * u}px ${24 * u}px`,
          }}
        >
          <span style={{ fontFamily, fontWeight: 700, fontSize: font(34), color: "#3A352D" }}>
            {capacity}
          </span>
        </div>
      </div>

      <div style={{ padding: `${28 * u}px ${32 * u}px ${32 * u}px` }}>
        {/* Name + governorate pin */}
        <div
          style={{
            display: "flex",
            flexDirection: "row-reverse",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20 * u,
          }}
        >
          <span style={{ fontFamily, fontWeight: 700, fontSize: font(48), color: colors.ink }}>
            {name}
          </span>
          <div style={{ display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: 8 * u }}>
            <IconPin size={22 * u} />
            <span style={{ fontFamily, fontWeight: 400, fontSize: font(34), color: colors.subtle }}>
              {governorate}
            </span>
          </div>
        </div>

        {/* Price rows (PriceCompare) render here */}
        {children ?? (
          <span style={{ fontFamily, fontWeight: 900, fontSize: font(72), color: colors.accent }}>
            {formatPrice(price)} <span style={{ fontSize: font(34), color: colors.subtle }}>{AD.currency}</span>
          </span>
        )}
      </div>
    </div>
  );
};
