// Client-side video compression for listing uploads.
//
// react-native-compressor is a NATIVE module: it exists only in builds made
// after it entered package.json. The require is guarded so older dev builds
// (and any platform where the module fails to load) degrade to uploading
// the original file instead of crashing the wizard — the server's 50MB cap
// is the backstop for that path.
//
// Target: ~720p H.264. A 30–60s phone clip lands between 5 and 20MB, which
// is what "uploadable on Iraqi mobile data" means in practice.

export async function compressVideo(
  uri: string,
  onProgress?: (fraction: number) => void,
): Promise<{ uri: string; compressed: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Video } = require('react-native-compressor');
    const out: string = await Video.compress(
      uri,
      { compressionMethod: 'auto', maxSize: 1280 },
      (p: number) => onProgress?.(p),
    );
    return { uri: out, compressed: true };
  } catch {
    return { uri, compressed: false };
  }
}
