// Project-wide image component. Wraps expo-image (way faster decode +
// proper disk-and-memory cache than RN's built-in <Image>) with sensible
// defaults so every render site doesn't have to repeat the same props.
//
// Why bother:
//   - RN's <Image> on Android decodes synchronously on the JS thread,
//     stutters the FlatList while a 50KB JPEG is mid-decode, and has no
//     persistent disk cache across cold starts.
//   - expo-image uses native SDWebImage (iOS) / Glide (Android), keeps
//     a hashed disk cache, decodes off the main thread, and supports
//     a smooth fade-in transition that hides the brief blank frame.
//
// API:
//   - Drop-in: <Img source={{ uri }} style={{...}} /> behaves like RN Image.
//   - `resizeMode` is accepted as an alias for `contentFit` so we don't
//     have to rewrite every existing call site at once.
//   - cachePolicy='memory-disk' and a short transition fade are the
//     defaults; pass `transition={0}` or different cachePolicy to override.

import React from 'react';
import { Image, type ImageProps, type ImageContentFit } from 'expo-image';

type LegacyResizeMode = 'cover' | 'contain' | 'stretch' | 'center';

type Props = Omit<ImageProps, 'contentFit'> & {
  resizeMode?: LegacyResizeMode;
  contentFit?: ImageContentFit;
};

export function Img({ resizeMode, contentFit, transition, cachePolicy, ...rest }: Props) {
  return (
    <Image
      contentFit={contentFit ?? (resizeMode as ImageContentFit | undefined) ?? 'cover'}
      transition={transition ?? 150}
      cachePolicy={cachePolicy ?? 'memory-disk'}
      {...rest}
    />
  );
}
