#!/bin/bash
# Start the TEST API for on-device testing of unreleased features.
#
# Runs on port 4400 against a COPY of the local dev database, so nothing here
# can reach production (different machine, different DB file, different port).
# Your phone talks to it over Wi-Fi at http://<this-mac-lan-ip>:4400.
#
#   ./run-test-server.sh          start (foreground; Ctrl-C to stop)
#   ./run-test-server.sh --fresh  re-copy the DB first, discarding test data

set -euo pipefail
cd "$(dirname "$0")"

TEST_DB="./data/iqmobile-test.db"
SOURCE_DB="./data/iqmobile2.db"

if [ "${1:-}" = "--fresh" ] || [ ! -f "$TEST_DB" ]; then
  echo "→ copying $SOURCE_DB → $TEST_DB"
  cp "$SOURCE_DB" "$TEST_DB"
  # WAL sidecars belong to the original file; drop them so SQLite rebuilds.
  rm -f "$TEST_DB-wal" "$TEST_DB-shm"
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '?')
echo "→ test API on http://$IP:4400   (DB: $TEST_DB)"
echo "  build the phone APK against this with:"
echo "    cd ../mobile && ./build-test-apk.sh http://$IP:4400"
echo

DB_PATH="$TEST_DB" PORT=4400 NODE_ENV=development node src/index.js
