import React from "react";
import { C, cairo, arPrice } from "./kit";

// Simplified vector recreations of the app's UI. Deliberately NOT the real
// screens — these are the app's shapes and palette reduced to what reads in
// half a second on a phone-sized feed post.

export const PhoneFrame: React.FC<{
  children: React.ReactNode;
  width?: number;
}> = ({ children, width = 430 }) => {
  const height = width * 2.06;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: width * 0.115,
        backgroundColor: C.ink,
        padding: width * 0.028,
        boxShadow: "0 40px 90px rgba(27,26,24,0.28)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: width * 0.09,
          backgroundColor: C.bg,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** A listing card: image block, title bar, price. The app's card, abstracted. */
export const DeviceCard: React.FC<{
  w?: number;
  title?: string;
  price?: number;
  used?: boolean;
}> = ({ w = 180, title, price, used = true }) => (
  <div
    style={{
      width: w,
      backgroundColor: C.surface,
      borderRadius: w * 0.1,
      border: `2px solid ${C.line}`,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}
  >
    <div
      style={{
        height: w * 0.62,
        backgroundColor: "#E2DBCB",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PhoneGlyph size={w * 0.4} />
    </div>
    <div style={{ padding: w * 0.075, display: "flex", flexDirection: "column", gap: w * 0.05 }}>
      {title ? (
        <span
          style={{
            fontFamily: cairo,
            fontWeight: 700,
            fontSize: w * 0.115,
            color: C.ink,
            direction: "rtl",
            textAlign: "right",
          }}
        >
          {title}
        </span>
      ) : (
        <div style={{ height: w * 0.075, width: "78%", borderRadius: 99, backgroundColor: "#E2DBCB", alignSelf: "flex-end" }} />
      )}
      {price ? (
        <span
          style={{
            fontFamily: cairo,
            fontWeight: 800,
            fontSize: w * 0.135,
            color: C.deep,
            direction: "rtl",
            textAlign: "right",
          }}
        >
          {arPrice(price)}
        </span>
      ) : (
        <div style={{ height: w * 0.09, width: "52%", borderRadius: 99, backgroundColor: C.accent, opacity: 0.85, alignSelf: "flex-end" }} />
      )}
      {used ? (
        <div
          style={{
            alignSelf: "flex-end",
            backgroundColor: "#E2DBCB",
            borderRadius: 99,
            padding: `${w * 0.022}px ${w * 0.06}px`,
          }}
        >
          <span style={{ fontFamily: cairo, fontWeight: 700, fontSize: w * 0.075, color: C.chipInk }}>
            مستعمل
          </span>
        </div>
      ) : null}
    </div>
  </div>
);

/** Minimal phone silhouette used inside card image blocks. */
export const PhoneGlyph: React.FC<{ size?: number; color?: string }> = ({
  size = 60,
  color = C.subtle,
}) => (
  <svg width={size} height={size * 1.55} viewBox="0 0 40 62" fill="none">
    <rect x="2" y="2" width="36" height="58" rx="8" stroke={color} strokeWidth="3.4" opacity={0.55} />
    <rect x="14" y="7" width="12" height="3" rx="1.5" fill={color} opacity={0.55} />
  </svg>
);

/** Location pin with a governorate name — used in the map beat. */
export const GovPin: React.FC<{ label: string; scale?: number }> = ({
  label,
  scale = 1,
}) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 * scale }}>
    <svg width={54 * scale} height={68 * scale} viewBox="0 0 54 68" fill="none">
      <path
        d="M27 2C14.3 2 4 12.3 4 25c0 16.5 20 39 23 39s23-22.5 23-39C50 12.3 39.7 2 27 2z"
        fill={C.accent}
      />
      <circle cx="27" cy="24" r="9" fill={C.surface} />
    </svg>
    <div
      style={{
        backgroundColor: C.ink,
        borderRadius: 99,
        padding: `${7 * scale}px ${16 * scale}px`,
      }}
    >
      <span
        style={{
          fontFamily: cairo,
          fontWeight: 700,
          fontSize: 26 * scale,
          color: C.surface,
          direction: "rtl",
          display: "block",
        }}
      >
        {label}
      </span>
    </div>
  </div>
);

/** The iQ logo mark. */
export const Logo: React.FC<{ size?: number }> = ({ size = 160 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.27,
      backgroundColor: C.accent,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <span
      style={{
        fontFamily: cairo,
        fontWeight: 800,
        fontSize: size * 0.46,
        color: "#fff",
        letterSpacing: -size * 0.01,
      }}
    >
      iQ
    </span>
  </div>
);

// ── Contact icons ────────────────────────────────────────────────────
export const IconWhatsApp: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <path
      d="M24 5C13.5 5 5 13.5 5 24c0 3.4.9 6.6 2.5 9.4L5 43l9.9-2.4c2.7 1.5 5.8 2.3 9.1 2.3 10.5 0 19-8.5 19-19S34.5 5 24 5z"
      fill={C.green}
    />
    <path
      d="M17.5 15.5c-.5 0-1.2.2-1.8.9-.6.7-2.3 2.3-2.3 5.5s2.4 6.4 2.7 6.8c.3.4 4.6 7.4 11.4 10 5.6 2.2 6.8 1.7 8 1.6 1.2-.1 3.9-1.6 4.5-3.2.6-1.6.6-2.9.4-3.2-.2-.3-.6-.5-1.3-.8-.7-.4-3.9-1.9-4.5-2.1-.6-.2-1-.3-1.5.3-.4.7-1.6 2.1-2 2.5-.4.4-.7.5-1.4.2-.7-.4-2.8-1.1-5.4-3.4-2-1.8-3.3-4-3.7-4.7-.4-.7 0-1 .3-1.4.3-.3.7-.8 1-1.2.3-.4.4-.7.6-1.1.2-.4.1-.8 0-1.2-.2-.3-1.5-3.6-2-4.9-.5-1.3-1-1.1-1.4-1.1h-1.3z"
      fill="#fff"
    />
  </svg>
);

export const IconChat: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <path
      d="M9 8h30a5 5 0 0 1 5 5v18a5 5 0 0 1-5 5H22l-10 7v-7H9a5 5 0 0 1-5-5V13a5 5 0 0 1 5-5z"
      fill={C.accent}
    />
    <circle cx="17" cy="22" r="3" fill="#fff" />
    <circle cx="24" cy="22" r="3" fill="#fff" />
    <circle cx="31" cy="22" r="3" fill="#fff" />
  </svg>
);

export const IconPhone: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" fill={C.ink} />
    <path
      d="M18 14c-.9 0-1.8.4-2.4 1.1-1 1.1-2.6 3-2.2 6 .5 3.6 3 8.3 6.7 12s8.4 6.2 12 6.7c3 .4 4.9-1.2 6-2.2.7-.6 1.1-1.5 1.1-2.4 0-.6-.3-1.2-.8-1.6l-4.2-3c-.8-.6-1.9-.5-2.6.2l-1.9 1.9c-.4.4-1 .5-1.5.3-1.4-.7-3.1-1.9-4.6-3.4s-2.7-3.2-3.4-4.6c-.2-.5-.1-1.1.3-1.5l1.9-1.9c.7-.7.8-1.8.2-2.6l-3-4.2c-.4-.5-1-.8-1.6-.8z"
      fill="#fff"
    />
  </svg>
);
