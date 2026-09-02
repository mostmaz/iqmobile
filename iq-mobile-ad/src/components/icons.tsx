import React from "react";
import { colors } from "../theme";

// Every icon is drawn as vector paths — no icon font, no raster.

export const IconCamera: React.FC<{ size: number; color?: string }> = ({
  size,
  color = colors.ink,
}) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="3" y="9" width="26" height="18" rx="4" stroke={color} strokeWidth="2.6" />
    <path d="M11 9l2-3h6l2 3" stroke={color} strokeWidth="2.6" strokeLinejoin="round" />
    <circle cx="16" cy="18" r="5" stroke={color} strokeWidth="2.6" />
  </svg>
);

export const IconPriceTag: React.FC<{ size: number; color?: string }> = ({
  size,
  color = colors.ink,
}) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <path
      d="M17 3H27v10L14 26 4 16 17 3z"
      stroke={color}
      strokeWidth="2.6"
      strokeLinejoin="round"
    />
    <circle cx="22" cy="8" r="2.4" fill={color} />
  </svg>
);

export const IconBell: React.FC<{ size: number; color?: string }> = ({
  size,
  color = colors.ink,
}) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <path
      d="M16 4a8 8 0 0 0-8 8c0 7-3 9-3 9h22s-3-2-3-9a8 8 0 0 0-8-8z"
      stroke={color}
      strokeWidth="2.6"
      strokeLinejoin="round"
    />
    <path d="M13.5 25a3 3 0 0 0 5 0" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
  </svg>
);

export const IconCheck: React.FC<{ size: number; color?: string }> = ({
  size,
  color = colors.white,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M5 13l4.5 4.5L19 7"
      stroke={color}
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconPin: React.FC<{ size: number; color?: string }> = ({
  size,
  color = colors.accent,
}) => (
  <svg width={size} height={size * 1.24} viewBox="0 0 24 30" fill="none">
    <path
      d="M12 1C6.9 1 3 4.9 3 10c0 6.8 8 19 9 19s9-12.2 9-19c0-5.1-3.9-9-9-9z"
      fill={color}
    />
    <circle cx="12" cy="10" r="3.6" fill={colors.surface} />
  </svg>
);

export const IconWhatsApp: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <path
      d="M24 5C13.5 5 5 13.5 5 24c0 3.4.9 6.6 2.5 9.4L5 43l9.9-2.4c2.7 1.5 5.8 2.3 9.1 2.3 10.5 0 19-8.5 19-19S34.5 5 24 5z"
      fill={colors.green}
    />
    <path
      d="M17.5 15.5c-.5 0-1.2.2-1.8.9-.6.7-2.3 2.3-2.3 5.5s2.4 6.4 2.7 6.8c.3.4 4.6 7.4 11.4 10 5.6 2.2 6.8 1.7 8 1.6 1.2-.1 3.9-1.6 4.5-3.2.6-1.6.6-2.9.4-3.2-.2-.3-.6-.5-1.3-.8-.7-.4-3.9-1.9-4.5-2.1-.6-.2-1-.3-1.5.3-.4.7-1.6 2.1-2 2.5-.4.4-.7.5-1.4.2-.7-.4-2.8-1.1-5.4-3.4-2-1.8-3.3-4-3.7-4.7-.4-.7 0-1 .3-1.4.3-.3.7-.8 1-1.2.3-.4.4-.7.6-1.1.2-.4.1-.8 0-1.2-.2-.3-1.5-3.6-2-4.9-.5-1.3-1-1.1-1.4-1.1h-1.3z"
      fill={colors.white}
    />
  </svg>
);

export const IconChatBubble: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <path
      d="M9 8h30a5 5 0 0 1 5 5v18a5 5 0 0 1-5 5H22l-10 7v-7H9a5 5 0 0 1-5-5V13a5 5 0 0 1 5-5z"
      fill={colors.accent}
    />
    <circle cx="17" cy="22" r="3" fill={colors.white} />
    <circle cx="24" cy="22" r="3" fill={colors.white} />
    <circle cx="31" cy="22" r="3" fill={colors.white} />
  </svg>
);

export const IconCall: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" fill={colors.ink} />
    <path
      d="M18 14c-.9 0-1.8.4-2.4 1.1-1 1.1-2.6 3-2.2 6 .5 3.6 3 8.3 6.7 12s8.4 6.2 12 6.7c3 .4 4.9-1.2 6-2.2.7-.6 1.1-1.5 1.1-2.4 0-.6-.3-1.2-.8-1.6l-4.2-3c-.8-.6-1.9-.5-2.6.2l-1.9 1.9c-.4.4-1 .5-1.5.3-1.4-.7-3.1-1.9-4.6-3.4s-2.7-3.2-3.4-4.6c-.2-.5-.1-1.1.3-1.5l1.9-1.9c.7-.7.8-1.8.2-2.6l-3-4.2c-.4-.5-1-.8-1.6-.8z"
      fill={colors.white}
    />
  </svg>
);

export const IconArrowDown: React.FC<{ size: number; color?: string }> = ({
  size,
  color = colors.red,
}) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <path
      d="M16 4v22m0 0l-8-8m8 8l8-8"
      stroke={color}
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The IQ Mobile mark — the one logo asset, drawn as vector. */
export const LogoMark: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <rect width="100" height="100" rx="27" fill={colors.accent} />
    <text
      x="50"
      y="50"
      textAnchor="middle"
      dominantBaseline="central"
      fill={colors.white}
      fontFamily="system-ui, sans-serif"
      fontWeight="800"
      fontSize="46"
    >
      iQ
    </text>
  </svg>
);
