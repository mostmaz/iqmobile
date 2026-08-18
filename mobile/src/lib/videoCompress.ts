// Client-side video compression for listing uploads.
//
// react-native-compressor is a NATIVE module: it exists only in builds made
// after it entered package.json. Requiring the package when the native side
// is missing is NOT safe even inside try/catch — its Video module constructs
// a NativeEventEmitter at module scope, and Metro reports a runtime module-
// factory error as fatal (redbox/crash) before our catch runs. So we probe
// for the native module first and only require the package when it's there;
// otherwise we upload the original file and the server's 50MB cap is the
// backstop.
//
// Target: ~720p H.264. A 30–60s phone clip lands between 5 and 20MB, which
// is what "uploadable on Iraqi mobile data" means in practice.

export async function compressVideo(
  uri: string,
  onProgress?: (fraction: number) => void,
): Promise<{ uri: string; compressed: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = require('react-native');
    const hasNative =
      rn.NativeModules?.Compressor != null ||
      rn.TurboModuleRegistry?.get?.('Compressor') != null;
    if (!hasNative) return { uri, compressed: false };
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
