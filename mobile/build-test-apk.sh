#!/bin/bash
# Build a SIDE-BY-SIDE test APK of the customer app.
#
# The result installs next to the real IQ Mobile (different applicationId,
# different name, different icon label) and talks to a test API — so you can
# try unreleased features on your own phone without touching production or
# the build your users have.
#
# Usage:  ./build-test-apk.sh http://192.168.3.72:4400
#         ./build-test-apk.sh https://api.iqmobile.org      (prod data, test build)
#
# Every file it edits is restored on exit, including on failure.

set -euo pipefail
cd "$(dirname "$0")"

API_URL="${1:-}"
if [ -z "$API_URL" ]; then
  echo "usage: $0 <api-base-url>   e.g. $0 http://192.168.3.72:4400"
  exit 1
fi

SUFFIX=".test"
TEST_LABEL="iQ تجربة"

APP_JSON="app.json"
MANIFEST="android/app/src/main/AndroidManifest.xml"
GSERVICES="android/app/google-services.json"
GRADLE="android/app/build.gradle"
BACKUP_DIR=".test-build-backup"

restore() {
  echo "→ restoring original files"
  for f in "$APP_JSON" "$MANIFEST" "$GSERVICES" "$GRADLE"; do
    [ -f "$BACKUP_DIR/$(basename "$f")" ] && cp "$BACKUP_DIR/$(basename "$f")" "$f"
  done
  rm -rf "$BACKUP_DIR"
}
trap restore EXIT

mkdir -p "$BACKUP_DIR"
for f in "$APP_JSON" "$MANIFEST" "$GSERVICES" "$GRADLE"; do
  cp "$f" "$BACKUP_DIR/$(basename "$f")"
done

echo "→ pointing the app at $API_URL"
python3 - "$API_URL" <<'PY'
import json, sys
url = sys.argv[1]
d = json.load(open('app.json'))
# A release build reads extra.apiBaseUrl unconditionally (see api/client.ts),
# so this is the only knob that matters for a sideloaded test APK.
d['expo']['extra']['apiBaseUrl'] = url
d['expo'].pop('updates', None)  # never let a test build pull OTA updates
json.dump(d, open('app.json', 'w'), indent=2, ensure_ascii=False)
PY

echo "→ separate applicationId + name so it installs alongside the real app"
python3 - "$SUFFIX" "$TEST_LABEL" <<'PY'
import json, re, sys
suffix, label = sys.argv[1], sys.argv[2]

# 1. applicationIdSuffix + a distinct launcher label.
g = open('android/app/build.gradle').read()
g = g.replace(
    "        versionCode 48",
    f'        applicationIdSuffix "{suffix}"\n'
    f'        resValue "string", "app_name_test", "{label}"\n'
    "        versionCode 48", 1)
open('android/app/build.gradle', 'w').write(g)

# 2. Point the launcher label at the test string, and allow plain HTTP so a
#    LAN test server (http://192.168.x.x) is reachable — Android blocks
#    cleartext by default since API 28.
m = open('android/app/src/main/AndroidManifest.xml').read()
m = m.replace('android:label="@string/app_name"', 'android:label="@string/app_name_test"', 1)
m = m.replace('<application android:name=".MainApplication"',
              '<application android:usesCleartextTraffic="true" android:name=".MainApplication"', 1)
open('android/app/src/main/AndroidManifest.xml', 'w').write(m)

# 3. google-services.json is keyed on package name and the gradle plugin
#    hard-fails without a match. Clone the existing client under the test
#    package. FCM itself won't register for it (unknown to Firebase), which
#    the app already tolerates — push is simply dead in the test build.
gs = json.load(open('android/app/google-services.json'))
base = gs['client'][0]
clone = json.loads(json.dumps(base))
clone['client_info']['android_client_info']['package_name'] += suffix
gs['client'].append(clone)
json.dump(gs, open('android/app/google-services.json', 'w'), indent=2)
print('   package:', clone['client_info']['android_client_info']['package_name'])
PY

echo "→ building (this takes a few minutes)…"
cd android
SENTRY_DISABLE_AUTO_UPLOAD=true ./gradlew :app:assembleRelease -q
cd ..

OUT="$HOME/Downloads/iqmobile-test.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
echo
echo "✓ built: $OUT"
echo "  api:   $API_URL"
echo "  installs alongside the real app as \"$TEST_LABEL\""
