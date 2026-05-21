// Image compression for upload.
//
// Goal: ship the smallest acceptable file from the user's photo gallery
// to our server. On Iraqi mobile data plans every kilobyte matters — a
// 6MB photo from a new iPhone is a 30-second upload on a typical
// connection, vs. ~3 seconds for the same image compressed to 400KB.
//
// Strategy per preset:
//   1. Resize the long edge to the preset's `maxDim` (single biggest win
//      — a 4032×3024 source compresses to under 1MB just from this).
//   2. Try WebP first (≈25-35% smaller than JPEG at the same visual
//      quality on Android — iOS image-manipulator falls back to JPEG
//      internally, which is fine because expo-image decodes both).
//   3. If that's still over the byte budget, drop quality progressively
//      reusing the already-resized intermediate (no need to re-decode
//      the original from disk each iteration).
//   4. If quality 0.35 still doesn't fit, halve the dimensions and try
//      once more.
//
// Three sized presets keep avatar / chat / listing uploads in their
// natural size bucket — previously every image (including a 56×56
// avatar) shipped 800KB.

import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

type Preset = {
  maxDim: number;
  maxBytes: number;
  initialQuality: number;
};

const PRESETS: Record<'listing' | 'chat' | 'avatar', Preset> = {
  // Listing photos: rendered up to 320px tall in the gallery (≈800px on a
  // 3× device). 1280 long edge gives a crisp zoom and stays under 1MB.
  listing: { maxDim: 1280, maxBytes: 600 * 1024, initialQuality: 0.7 },
  // Chat photo bubble: renders at 200×200. 800px is overkill but matches
  // what users expect for "send a photo".
  chat:    { maxDim: 800,  maxBytes: 400 * 1024, initialQuality: 0.65 },
  // Profile + shop sign avatars: rendered at 56×56 and 140 tall. 400px
  // is generous — under 80KB at quality 0.7.
  avatar:  { maxDim: 400,  maxBytes: 100 * 1024, initialQuality: 0.7 },
};

async function fileSize(uri: string): Promise<number> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blob.size;
  } catch {
    return 0;
  }
}

// expo-image-manipulator's WebP support landed in SDK 51+. We still
// guard with a try/catch because the underlying native libs vary by
// device and a malformed source occasionally falls through to a
// runtime error rather than a graceful return.
const SUPPORTS_WEBP = Platform.OS === 'android';
const WEBP = (ImageManipulator as any).SaveFormat?.WEBP ?? 'webp';

async function compressOnce(uri: string, width: number, compress: number, format: any) {
  return ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width } }],
    { compress, format },
  );
}

export async function compressImage(uri: string, preset: keyof typeof PRESETS): Promise<string> {
  const p = PRESETS[preset];

  // 1. Resize + initial WebP (Android) or JPEG (iOS) encode.
  let result;
  if (SUPPORTS_WEBP) {
    try {
      result = await compressOnce(uri, p.maxDim, p.initialQuality, WEBP);
    } catch {
      result = await compressOnce(uri, p.maxDim, p.initialQuality, ImageManipulator.SaveFormat.JPEG);
    }
  } else {
    result = await compressOnce(uri, p.maxDim, p.initialQuality, ImageManipulator.SaveFormat.JPEG);
  }

  let size = await fileSize(result.uri);
  if (size === 0 || size <= p.maxBytes) return result.uri;

  // 2. Quality-only retries — reuse the already-resized intermediate so
  //    we don't re-decode the original from disk on every iteration.
  for (const q of [0.55, 0.45, 0.35]) {
    result = await compressOnce(result.uri, p.maxDim, q, ImageManipulator.SaveFormat.JPEG);
    size = await fileSize(result.uri);
    if (size <= p.maxBytes) return result.uri;
  }

  // 3. Last-resort: halve the dimensions and try once more.
  const halfWidth = Math.max(320, Math.floor(p.maxDim / 2));
  result = await compressOnce(result.uri, halfWidth, 0.45, ImageManipulator.SaveFormat.JPEG);
  return result.uri;
}

// Per-use-case helpers. Each call site picks the right preset (so an
// avatar doesn't go through the listing-photo pipeline and ship 800KB
// for what renders at 56px). All three are thin wrappers over the
// shared compressImage() so we can tune presets in one place.
export async function compressForListing(uri: string): Promise<string> {
  return compressImage(uri, 'listing');
}

export async function compressForAvatar(uri: string): Promise<string> {
  return compressImage(uri, 'avatar');
}

export async function compressForChatBubble(uri: string): Promise<string> {
  return compressImage(uri, 'chat');
}
