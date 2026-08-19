import React from 'react';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

interface IP {
  size?: number;
  color?: string;
  sw?: number;
}

const Stroke = ({ size = 24, color = 'currentColor', sw = 1.6, children }: IP & { children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </Svg>
);

export const IconBolt = (p: IP) => (
  <Stroke {...p}><Path d="M13.5 2.5L4.5 13.5h6L9 21.5l9.5-11.5h-6l1-7.5z" /></Stroke>
);
export const IconBell = (p: IP) => (
  <Stroke {...p}>
    <Path d="M6 16V11a6 6 0 1112 0v5l1.5 2.5h-15L6 16z" />
    <Path d="M10 21a2 2 0 004 0" />
  </Stroke>
);
export const IconPin = (p: IP) => (
  <Stroke {...p}>
    <Path d="M12 21.5s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z" />
    <Circle cx="12" cy="9.5" r="2.5" />
  </Stroke>
);
export const IconCheck = (p: IP) => (
  <Stroke {...p}><Path d="M5 12.5l4.5 4.5L19 7.5" /></Stroke>
);
export const IconPhoneIcon = (p: IP) => (
  <Stroke {...p}>
    <Rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <Path d="M10 5.5h4" />
    <Circle cx="12" cy="18.5" r="0.6" fill={p.color || 'currentColor'} stroke="none" />
  </Stroke>
);
export const IconSpark = (p: IP) => (
  <Stroke {...p}>
    <Path d="M12 3v6" />
    <Path d="M12 15v6" />
    <Path d="M3 12h6" />
    <Path d="M15 12h6" />
    <Path d="M6 6l3 3" />
    <Path d="M15 15l3 3" />
    <Path d="M18 6l-3 3" />
    <Path d="M9 15l-3 3" />
  </Stroke>
);
export const IconClose = (p: IP) => (
  <Stroke {...p}><Path d="M6 6l12 12M18 6L6 18" /></Stroke>
);
export const IconCompare = (p: IP) => (
  <Stroke {...p}>
    <Path d="M12 3v18" />
    <Path d="M5 6.5h14" />
    <Path d="M8.5 6.5L5 13.5h7L8.5 6.5z" />
    <Path d="M15.5 6.5L12 13.5h7L15.5 6.5z" />
  </Stroke>
);
export const IconBox = (p: IP) => (
  <Stroke {...p}>
    <Path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
    <Path d="M3.5 7.5L12 12l8.5-4.5" />
    <Path d="M12 12v9" />
  </Stroke>
);
export const IconBag = (p: IP) => (
  <Stroke {...p}>
    <Path d="M5 8h14l-1 12H6L5 8z" />
    <Path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </Stroke>
);
export const IconID = (p: IP) => (
  <Stroke {...p}>
    <Rect x="3" y="5" width="18" height="14" rx="2.5" />
    <Circle cx="9" cy="11.5" r="2.2" />
    <Path d="M5.5 17.5c.6-1.6 2-2.6 3.5-2.6s2.9 1 3.5 2.6" />
    <Path d="M14.5 9.5h4.5" />
    <Path d="M14.5 12.5h4" />
    <Path d="M14.5 15.5h3" />
  </Stroke>
);
export const IconShield = (p: IP) => (
  <Stroke {...p}>
    <Path d="M12 3l8 3v6c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6l8-3z" />
    <Path d="M8.5 12l2.5 2.5L16 9.5" />
  </Stroke>
);
export const IconArrowLeft = (p: IP) => (
  <Stroke {...p}>
    <Path d="M5 12h14" />
    <Path d="M11 18l-6-6 6-6" />
  </Stroke>
);
export const IconChevronLeft = (p: IP) => (
  <Stroke {...p} sw={p.sw ?? 2}><Path d="M15 6l-6 6 6 6" /></Stroke>
);
export const IconChevronRight = (p: IP) => (
  <Stroke {...p} sw={p.sw ?? 2}><Path d="M9 6l6 6-6 6" /></Stroke>
);
export const IconStar = ({ size = 24, color = '#D9583A', filled = true, sw = 1.6 }: IP & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'transparent'} stroke={color} strokeWidth={sw} strokeLinejoin="round">
    <Path d="M12 2.5l3 6.5 7 1-5.2 4.7L18 21.5 12 18l-6 3.5 1.2-6.8L2 10l7-1z" />
  </Svg>
);
export const IconShops = (p: IP) => (
  <Stroke {...p}>
    <Path d="M3.5 9.5l1-4h15l1 4" />
    <Path d="M3.5 9.5a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" />
    <Path d="M5 9.8V20.5h14V9.8" />
    <Path d="M10 20.5v-5h4v5" />
  </Stroke>
);
export const IconStore = (p: IP) => (
  <Stroke {...p}>
    <Path d="M3.5 9.5l1.2-4.5h14.6l1.2 4.5" />
    <Path d="M3.5 9.5a2.8 2.8 0 005.6 0 2.8 2.8 0 005.6 0 2.8 2.8 0 005.8 0" />
    <Path d="M5 10.2V20.5h14V10.2" />
    <Path d="M9.5 20.5v-5.5h5v5.5" />
    <Path d="M3 20.5h18" />
  </Stroke>
);
export const IconTag = (p: IP) => (
  <Stroke {...p}>
    <Path d="M3.5 12.5L12 21l8.5-8.5V4H12L3.5 12.5z" />
    <Circle cx="15.5" cy="8.5" r="1.4" />
  </Stroke>
);
export const IconChevronDown = (p: IP) => (
  <Stroke {...p} sw={p.sw ?? 2}><Path d="M6 9l6 6 6-6" /></Stroke>
);
// Generic "message + call" — not WhatsApp's branded green logo. A round
// chat bubble with three message dots and a small handset notch, used on
// the secondary WhatsApp-deeplink CTA. Drawn fresh, currentColor.
export const IconMsgCall = ({ size = 18, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M21 12a8.5 8.5 0 01-12.4 7.6L4 21l1.4-4.6A8.5 8.5 0 1121 12z" />
    <Circle cx="9" cy="12" r="0.6" fill={color} stroke="none" />
    <Circle cx="12" cy="12" r="0.6" fill={color} stroke="none" />
    <Circle cx="15" cy="12" r="0.6" fill={color} stroke="none" />
  </Svg>
);

export const IconLock = ({ size = 16, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Rect x="5" y="11" width="14" height="9" rx="2" />
    <Path d="M8 11V8a4 4 0 018 0v3" />
  </Svg>
);
export const IconUnlock = ({ size = 16, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Rect x="5" y="11" width="14" height="9" rx="2" />
    <Path d="M8 11V8a4 4 0 017.4-2" />
  </Svg>
);
export const IconShare = ({ size = 18, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="6" cy="12" r="2.5" />
    <Circle cx="18" cy="6" r="2.5" />
    <Circle cx="18" cy="18" r="2.5" />
    <Path d="M8 11l8-4M8 13l8 4" />
  </Svg>
);
export const IconFlag = ({ size = 14, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M5 21V4h12l-2 4 2 4H5" />
  </Svg>
);
export const IconSearch = ({ size = 18, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="11" cy="11" r="7" />
    <Path d="M20 20l-3.5-3.5" />
  </Svg>
);
export const IconFilter = ({ size = 18, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M3 5h18" />
    <Path d="M6 12h12" />
    <Path d="M10 19h4" />
  </Svg>
);
// Storefront silhouette — used for the "shop" seller type pill / avatar.
export const IconStore2 = ({ size = 14, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M3 8l1.5-4h15L21 8" />
    <Path d="M3 8v2a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0V8" />
    <Path d="M5 12v8h14v-8" />
    <Path d="M10 20v-5h4v5" />
  </Svg>
);
export const IconCamera = ({ size = 18, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M3 8h4l2-3h6l2 3h4v11H3z" />
    <Circle cx="12" cy="13" r="3.5" />
  </Svg>
);
export const IconHome = ({ size = 22, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-7h-6v7H5a1 1 0 01-1-1z" />
  </Svg>
);
export const IconChat = ({ size = 20, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M4 5.5h16v11H10l-4 3.5v-3.5H4z" />
  </Svg>
);
export const IconMinus = ({ size = 16, color = 'currentColor', sw = 2.2 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M5 12h14" />
  </Svg>
);
export const IconPlus = ({ size = 20, color = 'currentColor', sw = 2 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconBookmark = ({ size = 18, color = 'currentColor', sw = 1.7, filled = false }: IP & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M6 4h12v17l-6-4-6 4z" />
  </Svg>
);

// Single-person silhouette — used for the "individual" seller type pill.
export const IconPerson = ({ size = 14, color = 'currentColor', sw = 1.7 }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="8" r="3.5" />
    <Path d="M5 20c1-3.5 4-5.5 7-5.5s6 2 7 5.5" />
  </Svg>
);

// Official Qi Card mark (qi.iq) — single-path yellow logo, viewBox 62×61.
// Rendered on a dark roundel in the feature-payment screen.
export const IconQiCard = ({ size = 24, color = '#F3CD00' }: IP) => (
  <Svg width={size} height={size} viewBox="0 0 62 61" fill="none">
    <Path d="M30.9248 50.4682C19.8723 50.4682 10.9291 41.5373 10.9291 30.5C10.9291 19.4627 19.8723 10.5318 30.9248 10.5318C41.9773 10.5318 50.9205 19.4627 50.9205 30.5C50.9205 33.2804 50.3299 35.9765 49.3175 38.3356L57.0795 46.087C59.8638 41.5373 61.3824 36.145 61.3824 30.4157C61.4668 13.6492 47.7988 0 30.9248 0C14.0508 0 0.382812 13.6492 0.382812 30.5C0.382812 47.3508 14.0508 61 30.9248 61C36.662 61 42.0617 59.3992 46.6176 56.703L38.7712 48.8674C36.4089 49.8785 33.709 50.4682 30.9248 50.4682ZM25.0189 30.5C25.0189 33.7859 27.6344 36.3978 30.9248 36.3978C34.2152 36.3978 36.8307 33.7859 36.8307 30.5C36.8307 27.2141 34.2152 24.6022 30.9248 24.6022C27.6344 24.6022 25.0189 27.2141 25.0189 30.5ZM59.8638 51.9848C61.8886 54.0069 61.8886 57.3771 59.8638 59.3992C57.8389 61.4213 54.4641 61.4213 52.4392 59.3992L36.9995 43.9807C34.9746 41.9586 34.9746 38.5884 36.9995 36.5663C39.0243 34.5442 42.3991 34.5442 44.424 36.5663L59.8638 51.9848Z" fill={color} />
  </Svg>
);
