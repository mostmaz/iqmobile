// Client-side image compressor, shared by every dashboard upload form.
//
// It exists because the server deliberately does not re-encode: multer
// validates the MIME type and writes the bytes to disk untouched. That is
// fine for a listing photo the mobile app already shrank, and it was NOT
// fine for banners — the banner form was the one upload path with no
// compression, so a 3264x1312 PNG exported from a design tool landed on
// disk at 4.7 MB and took ~25s to reach a phone. The carousel renders a
// banner at roughly 1290 device pixels on the densest handset, so nearly
// all of that was bytes no screen could use.

export interface CompressResult {
  blob: Blob;
  /** Filename to hand FormData — the server picks the stored extension from it. */
  filename: string;
  width: number;
  height: number;
}

/**
 * Downscale to `maxDim` on the long edge and re-encode.
 *
 * Format: WebP when the browser can encode it, JPEG otherwise. WebP matters
 * here beyond raw size — it keeps the alpha channel. Banner art is routinely
 * exported as PNG-with-transparency, and flattening that to JPEG turns every
 * transparent pixel black. The app already serves .webp listing images, so
 * nothing downstream needs to change.
 *
 * An image already smaller than `maxDim` is still re-encoded: the win on a
 * 4.7 MB PNG is the format, not the pixel count.
 */
export async function compressImage(
  file: File,
  { maxDim = 1600, quality = 0.85 }: { maxDim?: number; quality?: number } = {},
): Promise<CompressResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('decode_failed'));
      i.src = url;
    });

    let { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unsupported');
    ctx.drawImage(img, 0, 0, width, height);

    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

    // toBlob falls back to PNG when it doesn't know the type, so check what
    // actually came back rather than trusting the request.
    let blob = await encode('image/webp');
    let filename = 'upload.webp';
    if (!blob || blob.type !== 'image/webp') {
      blob = await encode('image/jpeg');
      filename = 'upload.jpg';
    }
    if (!blob) throw new Error('encode_failed');

    return { blob, filename, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "4.7 MB" / "75 KB" — for showing the operator what the shrink achieved. */
export function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
