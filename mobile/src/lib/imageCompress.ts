// Compress an image picked from expo-image-picker to fit under MAX_BYTES.
// Strategy: resize longest dim to MAX_DIM, then re-encode JPEG at progressively
// lower quality until size fits. expo-image-manipulator works on native + web.
import * as ImageManipulator from 'expo-image-manipulator';

// Marketplace photos: aim for ~600KB on the wire, max 1280px on the long edge.
// This keeps uploads snappy on Iraqi mobile data plans and stays well under
// the 5MB server cap. Phones display these at <600px wide anyway.
const MAX_BYTES = 800 * 1024;        // 800 KB target
const MAX_DIM = 1280;                 // long-edge cap

async function fileSize(uri: string): Promise<number> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blob.size;
  } catch {
    return 0;
  }
}

export async function compressForChat(uri: string): Promise<string> {
  // 1) Resize first (fastest big win on most photos).
  let result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_DIM } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
  );

  let size = await fileSize(result.uri);
  if (size === 0 || size <= MAX_BYTES) return result.uri;

  // 2) If still too big, re-encode at lower qualities until it fits.
  for (const q of [0.65, 0.5, 0.4, 0.3]) {
    result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_DIM } }],
      { compress: q, format: ImageManipulator.SaveFormat.JPEG },
    );
    size = await fileSize(result.uri);
    if (size <= MAX_BYTES) return result.uri;
  }

  // 3) Last resort: shrink dimensions further at quality 0.4.
  for (const w of [1280, 1024, 800, 640]) {
    result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: w } }],
      { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG },
    );
    size = await fileSize(result.uri);
    if (size <= MAX_BYTES) return result.uri;
  }
  // give up — return whatever we have; server will reject if over cap
  return result.uri;
}
